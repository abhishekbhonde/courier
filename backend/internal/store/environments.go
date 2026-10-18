package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/abhishekbhonde/courier/internal/model"
)

// ---- environments ----

const environmentCols = `id, name, variables, created_at, updated_at`

func scanEnvironment(sc scanner) (model.Environment, error) {
	var (
		e                model.Environment
		vars             string
		created, updated int64
	)
	if err := sc.Scan(&e.ID, &e.Name, &vars, &created, &updated); err != nil {
		return e, err
	}
	if err := json.Unmarshal([]byte(vars), &e.Variables); err != nil {
		return e, fmt.Errorf("environment %s variables: %w", e.ID, err)
	}
	e.CreatedAt, e.UpdatedAt = fromMillis(created), fromMillis(updated)
	return e, nil
}

func normalizeEnvironment(e *model.Environment) error {
	e.Name = strings.TrimSpace(e.Name)
	if e.Name == "" {
		return fmt.Errorf("%w: environment name is required", ErrInvalid)
	}
	if e.Variables == nil {
		e.Variables = []model.Variable{}
	}
	return nil
}

func (s *Store) ListEnvironments(ctx context.Context) ([]model.Environment, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+environmentCols+` FROM environments ORDER BY name COLLATE NOCASE, created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Environment{}
	for rows.Next() {
		e, err := scanEnvironment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) GetEnvironment(ctx context.Context, id string) (model.Environment, error) {
	e, err := scanEnvironment(s.db.QueryRowContext(ctx,
		`SELECT `+environmentCols+` FROM environments WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return e, ErrNotFound
	}
	return e, err
}

func (s *Store) CreateEnvironment(ctx context.Context, e model.Environment) (model.Environment, error) {
	if err := normalizeEnvironment(&e); err != nil {
		return e, err
	}
	e.ID = model.NewID()
	e.CreatedAt = now()
	e.UpdatedAt = e.CreatedAt
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO environments (`+environmentCols+`) VALUES (?, ?, ?, ?, ?)`,
		e.ID, e.Name, mustJSON(e.Variables), toMillis(e.CreatedAt), toMillis(e.UpdatedAt))
	return e, err
}

func (s *Store) UpdateEnvironment(ctx context.Context, e model.Environment) (model.Environment, error) {
	if err := normalizeEnvironment(&e); err != nil {
		return e, err
	}
	err := checkAffected(s.db.ExecContext(ctx,
		`UPDATE environments SET name = ?, variables = ?, updated_at = ? WHERE id = ?`,
		e.Name, mustJSON(e.Variables), toMillis(now()), e.ID))
	if err != nil {
		return e, err
	}
	return s.GetEnvironment(ctx, e.ID)
}

func (s *Store) DeleteEnvironment(ctx context.Context, id string) error {
	return checkAffected(s.db.ExecContext(ctx, `DELETE FROM environments WHERE id = ?`, id))
}

// ---- history ----

const historyCols = `id, spec, status, duration_ms, size, error, created_at`

func scanHistory(sc scanner) (model.HistoryEntry, error) {
	var (
		h       model.HistoryEntry
		spec    string
		created int64
	)
	if err := sc.Scan(&h.ID, &spec, &h.Status, &h.DurationMs, &h.Size, &h.Error, &created); err != nil {
		return h, err
	}
	if err := json.Unmarshal([]byte(spec), &h.Request); err != nil {
		return h, fmt.Errorf("history %s spec: %w", h.ID, err)
	}
	h.Request.Normalize()
	h.CreatedAt = fromMillis(created)
	return h, nil
}

// AddHistory records an entry and prunes the oldest beyond limit.
func (s *Store) AddHistory(ctx context.Context, h model.HistoryEntry, limit int) (model.HistoryEntry, error) {
	h.ID = model.NewID()
	h.CreatedAt = now()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO history (`+historyCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			h.ID, mustJSON(h.Request), h.Status, h.DurationMs, h.Size, h.Error, toMillis(h.CreatedAt)); err != nil {
			return err
		}
		if limit > 0 {
			_, err := tx.ExecContext(ctx,
				`DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY created_at DESC LIMIT ?)`, limit)
			return err
		}
		return nil
	})
	return h, err
}

func (s *Store) ListHistory(ctx context.Context, limit int) ([]model.HistoryEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+historyCols+` FROM history ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.HistoryEntry{}
	for rows.Next() {
		h, err := scanHistory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (s *Store) DeleteHistory(ctx context.Context, id string) error {
	return checkAffected(s.db.ExecContext(ctx, `DELETE FROM history WHERE id = ?`, id))
}

func (s *Store) ClearHistory(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM history`)
	return err
}

// ---- settings ----

const settingsKey = "app"

// GetSettings returns stored settings layered over the defaults.
func (s *Store) GetSettings(ctx context.Context) (model.Settings, error) {
	st := model.DefaultSettings()
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, settingsKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return st, nil
	} else if err != nil {
		return st, err
	}
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		return model.DefaultSettings(), fmt.Errorf("settings: %w", err)
	}
	return st, nil
}

func (s *Store) SaveSettings(ctx context.Context, st model.Settings) (model.Settings, error) {
	if st.TimeoutMs < 0 || st.MaxResponseBytes < 0 || st.HistoryLimit < 0 {
		return st, fmt.Errorf("%w: settings values must not be negative", ErrInvalid)
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		settingsKey, mustJSON(st))
	return st, err
}
