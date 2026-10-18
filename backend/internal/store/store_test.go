package store

import (
	"context"
	"errors"
	"testing"

	"github.com/abhishekbhonde/courier/internal/model"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestCollectionTreeLifecycle(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)

	c, err := s.CreateCollection(ctx, model.Collection{Name: "  API  "})
	if err != nil {
		t.Fatal(err)
	}
	if c.Name != "API" || c.Auth.Type != model.AuthNone {
		t.Fatalf("collection not normalized: %+v", c)
	}

	parent, err := s.CreateFolder(ctx, model.Folder{CollectionID: c.ID, Name: "users"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.CreateFolder(ctx, model.Folder{CollectionID: c.ID, ParentID: &parent.ID, Name: "admin"})
	if err != nil {
		t.Fatal(err)
	}

	r1, err := s.CreateRequest(ctx, model.Request{CollectionID: c.ID, FolderID: &child.ID, Name: "list",
		RequestSpec: model.RequestSpec{Method: "get", URL: "https://example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	r2, err := s.CreateRequest(ctx, model.Request{CollectionID: c.ID, FolderID: &child.ID, Name: "create"})
	if err != nil {
		t.Fatal(err)
	}
	if r1.Method != "GET" || r1.Sort != 0 || r2.Sort != 1 {
		t.Fatalf("unexpected requests: %+v / %+v", r1, r2)
	}

	dup, err := s.DuplicateRequest(ctx, r1.ID)
	if err != nil || dup.Name != "list Copy" || dup.URL != r1.URL {
		t.Fatalf("duplicate: %+v %v", dup, err)
	}

	tree, err := s.GetCollectionTree(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Folders) != 2 || len(tree.Requests) != 3 {
		t.Fatalf("tree has %d folders, %d requests", len(tree.Folders), len(tree.Requests))
	}

	// A folder cannot become its own descendant.
	parent.ParentID = &child.ID
	if _, err := s.UpdateFolder(ctx, parent); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid moving folder into child, got %v", err)
	}

	// Deleting the parent folder cascades to subfolders and their requests.
	if err := s.DeleteFolder(ctx, parent.ID); err != nil {
		t.Fatal(err)
	}
	tree, _ = s.GetCollectionTree(ctx, c.ID)
	if len(tree.Folders) != 0 || len(tree.Requests) != 0 {
		t.Fatalf("cascade failed: %+v", tree)
	}

	if err := s.DeleteCollection(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCollection(ctx, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestRequestPlacementValidation(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	a, _ := s.CreateCollection(ctx, model.Collection{Name: "a"})
	b, _ := s.CreateCollection(ctx, model.Collection{Name: "b"})
	fb, _ := s.CreateFolder(ctx, model.Folder{CollectionID: b.ID, Name: "f"})

	_, err := s.CreateRequest(ctx, model.Request{CollectionID: a.ID, FolderID: &fb.ID, Name: "x"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid for cross-collection folder, got %v", err)
	}
	_, err = s.CreateRequest(ctx, model.Request{CollectionID: "missing", Name: "x"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid for missing collection, got %v", err)
	}
}

func TestHistoryPruning(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	for i := 0; i < 5; i++ {
		if _, err := s.AddHistory(ctx, model.HistoryEntry{Status: 200 + i}, 3); err != nil {
			t.Fatal(err)
		}
	}
	h, err := s.ListHistory(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 3 {
		t.Fatalf("expected 3 entries after pruning, got %d", len(h))
	}
}

func TestSettingsDefaultsAndSave(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	st, err := s.GetSettings(ctx)
	if err != nil || st != model.DefaultSettings() {
		t.Fatalf("defaults: %+v %v", st, err)
	}
	st.FollowRedirects = false
	if _, err := s.SaveSettings(ctx, st); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetSettings(ctx)
	if got.FollowRedirects {
		t.Fatal("setting not persisted")
	}
}

func TestImportCollection(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	fid := model.NewID()
	tree, err := s.ImportCollection(ctx, model.CollectionTree{
		Collection: model.Collection{Name: "imported"},
		Folders:    []model.Folder{{ID: fid, Name: "f"}},
		Requests: []model.Request{
			{Name: "root"},
			{Name: "nested", FolderID: &fid},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Folders) != 1 || len(tree.Requests) != 2 {
		t.Fatalf("unexpected import result: %+v", tree)
	}
}
