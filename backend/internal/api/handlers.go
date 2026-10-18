package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"github.com/abhishekbhonde/courier/internal/importer"
	"github.com/abhishekbhonde/courier/internal/model"
	"github.com/abhishekbhonde/courier/internal/runner"
	"github.com/abhishekbhonde/courier/internal/store"
)

// ---- collections ----

func (s *Server) listCollections(w http.ResponseWriter, r *http.Request) {
	trees, err := s.store.ListCollectionTrees(r.Context())
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, trees)
}

func (s *Server) getCollection(w http.ResponseWriter, r *http.Request) {
	t, err := s.store.GetCollectionTree(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) createCollection(w http.ResponseWriter, r *http.Request) {
	var c model.Collection
	if !decode(w, r, &c) {
		return
	}
	c, err := s.store.CreateCollection(r.Context(), c)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) updateCollection(w http.ResponseWriter, r *http.Request) {
	var c model.Collection
	if !decode(w, r, &c) {
		return
	}
	c.ID = r.PathValue("id")
	c, err := s.store.UpdateCollection(r.Context(), c)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) deleteCollection(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCollection(r.Context(), r.PathValue("id")); err != nil {
		s.writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var unsafeFilename = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func (s *Server) exportCollection(w http.ResponseWriter, r *http.Request) {
	t, err := s.store.GetCollectionTree(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	out, err := importer.ExportPostman(t)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	name := unsafeFilename.ReplaceAllString(t.Name, "_")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.postman_collection.json"`, name))
	w.Write(out)
}

// ---- folders ----

func (s *Server) createFolder(w http.ResponseWriter, r *http.Request) {
	var f model.Folder
	if !decode(w, r, &f) {
		return
	}
	f, err := s.store.CreateFolder(r.Context(), f)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (s *Server) updateFolder(w http.ResponseWriter, r *http.Request) {
	var f model.Folder
	if !decode(w, r, &f) {
		return
	}
	f.ID = r.PathValue("id")
	f, err := s.store.UpdateFolder(r.Context(), f)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) deleteFolder(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteFolder(r.Context(), r.PathValue("id")); err != nil {
		s.writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- requests ----

func (s *Server) getRequest(w http.ResponseWriter, r *http.Request) {
	req, err := s.store.GetRequest(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, req)
}

func (s *Server) createRequest(w http.ResponseWriter, r *http.Request) {
	var req model.Request
	if !decode(w, r, &req) {
		return
	}
	req, err := s.store.CreateRequest(r.Context(), req)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, req)
}

func (s *Server) updateRequest(w http.ResponseWriter, r *http.Request) {
	var req model.Request
	if !decode(w, r, &req) {
		return
	}
	req.ID = r.PathValue("id")
	req, err := s.store.UpdateRequest(r.Context(), req)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, req)
}

func (s *Server) deleteRequest(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteRequest(r.Context(), r.PathValue("id")); err != nil {
		s.writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) duplicateRequest(w http.ResponseWriter, r *http.Request) {
	req, err := s.store.DuplicateRequest(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, req)
}

// ---- environments ----

func (s *Server) listEnvironments(w http.ResponseWriter, r *http.Request) {
	envs, err := s.store.ListEnvironments(r.Context())
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, envs)
}

func (s *Server) createEnvironment(w http.ResponseWriter, r *http.Request) {
	var e model.Environment
	if !decode(w, r, &e) {
		return
	}
	e, err := s.store.CreateEnvironment(r.Context(), e)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

func (s *Server) updateEnvironment(w http.ResponseWriter, r *http.Request) {
	var e model.Environment
	if !decode(w, r, &e) {
		return
	}
	e.ID = r.PathValue("id")
	e, err := s.store.UpdateEnvironment(r.Context(), e)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) deleteEnvironment(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteEnvironment(r.Context(), r.PathValue("id")); err != nil {
		s.writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- history ----

func (s *Server) listHistory(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	h, err := s.store.ListHistory(r.Context(), limit)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, h)
}

func (s *Server) deleteHistory(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteHistory(r.Context(), r.PathValue("id")); err != nil {
		s.writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) clearHistory(w http.ResponseWriter, r *http.Request) {
	if err := s.store.ClearHistory(r.Context()); err != nil {
		s.writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- settings ----

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.GetSettings(r.Context())
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) {
	var st model.Settings
	if !decode(w, r, &st) {
		return
	}
	st, err := s.store.SaveSettings(r.Context(), st)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// ---- execute ----

type executeRequest struct {
	Request       model.RequestSpec `json:"request"`
	EnvironmentID string            `json:"environmentId"`
	CollectionID  string            `json:"collectionId"`
	SaveHistory   *bool             `json:"saveHistory"`
}

func (s *Server) execute(w http.ResponseWriter, r *http.Request) {
	var in executeRequest
	if !decode(w, r, &in) {
		return
	}
	ctx := r.Context()
	in.Request.Normalize()

	settings, err := s.store.GetSettings(ctx)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	var collectionVars, envVars []model.Variable
	spec := in.Request
	if in.CollectionID != "" {
		c, err := s.store.GetCollection(ctx, in.CollectionID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.writeStoreError(w, err)
			return
		}
		collectionVars = c.Variables
		if spec.Auth.Type == model.AuthInherit {
			spec.Auth = c.Auth
		}
	}
	if spec.Auth.Type == model.AuthInherit {
		spec.Auth = model.Auth{Type: model.AuthNone}
	}
	if in.EnvironmentID != "" {
		e, err := s.store.GetEnvironment(ctx, in.EnvironmentID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.writeStoreError(w, err)
			return
		}
		envVars = e.Variables
	}

	res := runner.Execute(ctx, spec, runner.NewResolver(collectionVars, envVars), runner.OptionsFromSettings(settings))

	if (in.SaveHistory == nil || *in.SaveHistory) && ctx.Err() == nil {
		// History keeps the unresolved spec so it can be replayed against any environment.
		entry := model.HistoryEntry{
			Request:    in.Request,
			Status:     res.Status,
			DurationMs: int64(res.Timings.Total),
			Size:       res.Size,
			Error:      res.Error,
		}
		if _, err := s.store.AddHistory(context.WithoutCancel(ctx), entry, settings.HistoryLimit); err != nil {
			s.log.Warn("saving history", "err", err)
		}
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- import ----

func (s *Server) importCurl(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Command string `json:"command"`
	}
	if !decode(w, r, &in) {
		return
	}
	spec, err := importer.ParseCurl(in.Command)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, spec)
}

func (s *Server) importPostman(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Content string `json:"content"`
	}
	if !decode(w, r, &in) {
		return
	}
	imp, err := importer.ImportPostman([]byte(in.Content))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx := r.Context()
	switch {
	case imp.Collection != nil:
		t, err := s.store.ImportCollection(ctx, *imp.Collection)
		if err != nil {
			s.writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"collection": t})
	case imp.Environment != nil:
		e, err := s.store.CreateEnvironment(ctx, *imp.Environment)
		if err != nil {
			s.writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"environment": e})
	}
}
