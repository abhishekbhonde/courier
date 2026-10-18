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

// ---- collections ----

const collectionCols = `id, name, description, variables, auth, created_at, updated_at`

func scanCollection(sc scanner) (model.Collection, error) {
	var (
		c                model.Collection
		vars, auth       string
		created, updated int64
	)
	if err := sc.Scan(&c.ID, &c.Name, &c.Description, &vars, &auth, &created, &updated); err != nil {
		return c, err
	}
	if err := json.Unmarshal([]byte(vars), &c.Variables); err != nil {
		return c, fmt.Errorf("collection %s variables: %w", c.ID, err)
	}
	if err := json.Unmarshal([]byte(auth), &c.Auth); err != nil {
		return c, fmt.Errorf("collection %s auth: %w", c.ID, err)
	}
	c.CreatedAt, c.UpdatedAt = fromMillis(created), fromMillis(updated)
	return c, nil
}

func normalizeCollection(c *model.Collection) error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return fmt.Errorf("%w: collection name is required", ErrInvalid)
	}
	if c.Variables == nil {
		c.Variables = []model.Variable{}
	}
	if c.Auth.Type == "" || c.Auth.Type == model.AuthInherit {
		c.Auth.Type = model.AuthNone
	}
	return nil
}

func (s *Store) GetCollection(ctx context.Context, id string) (model.Collection, error) {
	c, err := scanCollection(s.db.QueryRowContext(ctx,
		`SELECT `+collectionCols+` FROM collections WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func (s *Store) CreateCollection(ctx context.Context, c model.Collection) (model.Collection, error) {
	if err := normalizeCollection(&c); err != nil {
		return c, err
	}
	c.ID = model.NewID()
	c.CreatedAt = now()
	c.UpdatedAt = c.CreatedAt
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO collections (`+collectionCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.Name, c.Description, mustJSON(c.Variables), mustJSON(c.Auth),
		toMillis(c.CreatedAt), toMillis(c.UpdatedAt))
	return c, err
}

func (s *Store) UpdateCollection(ctx context.Context, c model.Collection) (model.Collection, error) {
	if err := normalizeCollection(&c); err != nil {
		return c, err
	}
	c.UpdatedAt = now()
	err := checkAffected(s.db.ExecContext(ctx,
		`UPDATE collections SET name = ?, description = ?, variables = ?, auth = ?, updated_at = ? WHERE id = ?`,
		c.Name, c.Description, mustJSON(c.Variables), mustJSON(c.Auth), toMillis(c.UpdatedAt), c.ID))
	if err != nil {
		return c, err
	}
	return s.GetCollection(ctx, c.ID)
}

func (s *Store) DeleteCollection(ctx context.Context, id string) error {
	return checkAffected(s.db.ExecContext(ctx, `DELETE FROM collections WHERE id = ?`, id))
}

// ListCollectionTrees returns every collection with its folders and requests.
func (s *Store) ListCollectionTrees(ctx context.Context) ([]model.CollectionTree, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+collectionCols+` FROM collections ORDER BY name COLLATE NOCASE, created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	trees := []model.CollectionTree{}
	index := map[string]int{}
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			return nil, err
		}
		index[c.ID] = len(trees)
		trees = append(trees, model.CollectionTree{Collection: c, Folders: []model.Folder{}, Requests: []model.Request{}})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	folders, err := s.queryFolders(ctx, `ORDER BY sort, created_at`)
	if err != nil {
		return nil, err
	}
	for _, f := range folders {
		if i, ok := index[f.CollectionID]; ok {
			trees[i].Folders = append(trees[i].Folders, f)
		}
	}

	requests, err := s.queryRequests(ctx, `ORDER BY sort, created_at`)
	if err != nil {
		return nil, err
	}
	for _, r := range requests {
		if i, ok := index[r.CollectionID]; ok {
			trees[i].Requests = append(trees[i].Requests, r)
		}
	}
	return trees, nil
}

func (s *Store) GetCollectionTree(ctx context.Context, id string) (model.CollectionTree, error) {
	c, err := s.GetCollection(ctx, id)
	if err != nil {
		return model.CollectionTree{}, err
	}
	t := model.CollectionTree{Collection: c}
	if t.Folders, err = s.queryFolders(ctx, `WHERE collection_id = ? ORDER BY sort, created_at`, id); err != nil {
		return t, err
	}
	if t.Requests, err = s.queryRequests(ctx, `WHERE collection_id = ? ORDER BY sort, created_at`, id); err != nil {
		return t, err
	}
	return t, nil
}

// ImportCollection inserts a whole tree in one transaction. Folder and request
// IDs in the tree are kept so that parent references resolve; folders must be
// ordered parents-first. The collection gets a fresh ID.
func (s *Store) ImportCollection(ctx context.Context, t model.CollectionTree) (model.CollectionTree, error) {
	if err := normalizeCollection(&t.Collection); err != nil {
		return t, err
	}
	t.ID = model.NewID()
	t.CreatedAt = now()
	t.UpdatedAt = t.CreatedAt
	ts := toMillis(t.CreatedAt)

	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO collections (`+collectionCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			t.ID, t.Name, t.Description, mustJSON(t.Variables), mustJSON(t.Auth), ts, ts); err != nil {
			return err
		}
		for i := range t.Folders {
			f := &t.Folders[i]
			f.CollectionID, f.CreatedAt, f.UpdatedAt = t.ID, t.CreatedAt, t.CreatedAt
			if f.ID == "" {
				f.ID = model.NewID()
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO folders (`+folderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				f.ID, f.CollectionID, f.ParentID, f.Name, f.Sort, ts, ts); err != nil {
				return fmt.Errorf("folder %q: %w", f.Name, err)
			}
		}
		for i := range t.Requests {
			r := &t.Requests[i]
			r.CollectionID, r.CreatedAt, r.UpdatedAt = t.ID, t.CreatedAt, t.CreatedAt
			r.ID = model.NewID()
			r.Normalize()
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO requests (`+requestCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				r.ID, r.CollectionID, r.FolderID, r.Name, r.Sort, mustJSON(r.RequestSpec), ts, ts); err != nil {
				return fmt.Errorf("request %q: %w", r.Name, err)
			}
		}
		return nil
	})
	if err != nil {
		return t, err
	}
	return s.GetCollectionTree(ctx, t.ID)
}

// ---- folders ----

const folderCols = `id, collection_id, parent_id, name, sort, created_at, updated_at`

func scanFolder(sc scanner) (model.Folder, error) {
	var (
		f                model.Folder
		parent           sql.NullString
		created, updated int64
	)
	if err := sc.Scan(&f.ID, &f.CollectionID, &parent, &f.Name, &f.Sort, &created, &updated); err != nil {
		return f, err
	}
	if parent.Valid {
		f.ParentID = &parent.String
	}
	f.CreatedAt, f.UpdatedAt = fromMillis(created), fromMillis(updated)
	return f, nil
}

func (s *Store) queryFolders(ctx context.Context, clause string, args ...any) ([]model.Folder, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+folderCols+` FROM folders `+clause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Folder{}
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) GetFolder(ctx context.Context, id string) (model.Folder, error) {
	f, err := scanFolder(s.db.QueryRowContext(ctx, `SELECT `+folderCols+` FROM folders WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return f, ErrNotFound
	}
	return f, err
}

// checkPlacement verifies that the collection exists and that folderID (if
// set) belongs to it. selfID guards against making a folder its own ancestor.
func (s *Store) checkPlacement(ctx context.Context, collectionID string, folderID *string, selfID string) error {
	if _, err := s.GetCollection(ctx, collectionID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("%w: collection %s does not exist", ErrInvalid, collectionID)
		}
		return err
	}
	for id := folderID; id != nil; {
		if selfID != "" && *id == selfID {
			return fmt.Errorf("%w: a folder cannot be moved inside itself", ErrInvalid)
		}
		f, err := s.GetFolder(ctx, *id)
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("%w: folder %s does not exist", ErrInvalid, *id)
		} else if err != nil {
			return err
		}
		if f.CollectionID != collectionID {
			return fmt.Errorf("%w: folder %s belongs to another collection", ErrInvalid, *id)
		}
		id = f.ParentID
	}
	return nil
}

func (s *Store) nextSort(ctx context.Context, table, parentCol string, collectionID string, parentID *string) (int, error) {
	var max sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT MAX(sort) FROM %s WHERE collection_id = ? AND %s IS ?`, table, parentCol),
		collectionID, parentID).Scan(&max)
	if err != nil {
		return 0, err
	}
	if !max.Valid {
		return 0, nil
	}
	return int(max.Int64) + 1, nil
}

func (s *Store) CreateFolder(ctx context.Context, f model.Folder) (model.Folder, error) {
	f.Name = strings.TrimSpace(f.Name)
	if f.Name == "" {
		return f, fmt.Errorf("%w: folder name is required", ErrInvalid)
	}
	if err := s.checkPlacement(ctx, f.CollectionID, f.ParentID, ""); err != nil {
		return f, err
	}
	sort, err := s.nextSort(ctx, "folders", "parent_id", f.CollectionID, f.ParentID)
	if err != nil {
		return f, err
	}
	f.ID, f.Sort = model.NewID(), sort
	f.CreatedAt = now()
	f.UpdatedAt = f.CreatedAt
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO folders (`+folderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		f.ID, f.CollectionID, f.ParentID, f.Name, f.Sort, toMillis(f.CreatedAt), toMillis(f.UpdatedAt))
	return f, err
}

// UpdateFolder renames and/or moves a folder within its collection.
func (s *Store) UpdateFolder(ctx context.Context, f model.Folder) (model.Folder, error) {
	existing, err := s.GetFolder(ctx, f.ID)
	if err != nil {
		return f, err
	}
	f.Name = strings.TrimSpace(f.Name)
	if f.Name == "" {
		return f, fmt.Errorf("%w: folder name is required", ErrInvalid)
	}
	if err := s.checkPlacement(ctx, existing.CollectionID, f.ParentID, f.ID); err != nil {
		return f, err
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE folders SET name = ?, parent_id = ?, sort = ?, updated_at = ? WHERE id = ?`,
		f.Name, f.ParentID, f.Sort, toMillis(now()), f.ID)
	if err != nil {
		return f, err
	}
	return s.GetFolder(ctx, f.ID)
}

func (s *Store) DeleteFolder(ctx context.Context, id string) error {
	return checkAffected(s.db.ExecContext(ctx, `DELETE FROM folders WHERE id = ?`, id))
}

// ---- requests ----

const requestCols = `id, collection_id, folder_id, name, sort, spec, created_at, updated_at`

func scanRequest(sc scanner) (model.Request, error) {
	var (
		r                model.Request
		folder           sql.NullString
		spec             string
		created, updated int64
	)
	if err := sc.Scan(&r.ID, &r.CollectionID, &folder, &r.Name, &r.Sort, &spec, &created, &updated); err != nil {
		return r, err
	}
	if folder.Valid {
		r.FolderID = &folder.String
	}
	if err := json.Unmarshal([]byte(spec), &r.RequestSpec); err != nil {
		return r, fmt.Errorf("request %s spec: %w", r.ID, err)
	}
	r.Normalize()
	r.CreatedAt, r.UpdatedAt = fromMillis(created), fromMillis(updated)
	return r, nil
}

func (s *Store) queryRequests(ctx context.Context, clause string, args ...any) ([]model.Request, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+requestCols+` FROM requests `+clause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Request{}
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetRequest(ctx context.Context, id string) (model.Request, error) {
	r, err := scanRequest(s.db.QueryRowContext(ctx, `SELECT `+requestCols+` FROM requests WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

func normalizeRequest(r *model.Request) error {
	r.Name = strings.TrimSpace(r.Name)
	if r.Name == "" {
		return fmt.Errorf("%w: request name is required", ErrInvalid)
	}
	r.Method = strings.ToUpper(strings.TrimSpace(r.Method))
	r.Normalize()
	return nil
}

func (s *Store) CreateRequest(ctx context.Context, r model.Request) (model.Request, error) {
	if err := normalizeRequest(&r); err != nil {
		return r, err
	}
	if err := s.checkPlacement(ctx, r.CollectionID, r.FolderID, ""); err != nil {
		return r, err
	}
	sort, err := s.nextSort(ctx, "requests", "folder_id", r.CollectionID, r.FolderID)
	if err != nil {
		return r, err
	}
	r.ID, r.Sort = model.NewID(), sort
	r.CreatedAt = now()
	r.UpdatedAt = r.CreatedAt
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO requests (`+requestCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.CollectionID, r.FolderID, r.Name, r.Sort, mustJSON(r.RequestSpec),
		toMillis(r.CreatedAt), toMillis(r.UpdatedAt))
	return r, err
}

// UpdateRequest replaces a saved request. It may also move it to another
// folder or collection.
func (s *Store) UpdateRequest(ctx context.Context, r model.Request) (model.Request, error) {
	if err := normalizeRequest(&r); err != nil {
		return r, err
	}
	existing, err := s.GetRequest(ctx, r.ID)
	if err != nil {
		return r, err
	}
	if r.CollectionID == "" {
		r.CollectionID = existing.CollectionID
	}
	if err := s.checkPlacement(ctx, r.CollectionID, r.FolderID, ""); err != nil {
		return r, err
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE requests SET collection_id = ?, folder_id = ?, name = ?, sort = ?, spec = ?, updated_at = ? WHERE id = ?`,
		r.CollectionID, r.FolderID, r.Name, r.Sort, mustJSON(r.RequestSpec), toMillis(now()), r.ID)
	if err != nil {
		return r, err
	}
	return s.GetRequest(ctx, r.ID)
}

func (s *Store) DeleteRequest(ctx context.Context, id string) error {
	return checkAffected(s.db.ExecContext(ctx, `DELETE FROM requests WHERE id = ?`, id))
}

// DuplicateRequest copies a request next to the original with a " Copy" suffix.
func (s *Store) DuplicateRequest(ctx context.Context, id string) (model.Request, error) {
	r, err := s.GetRequest(ctx, id)
	if err != nil {
		return r, err
	}
	r.Name += " Copy"
	return s.CreateRequest(ctx, r)
}
