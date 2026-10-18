package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/abhishekbhonde/courier/internal/model"
	"github.com/abhishekbhonde/courier/internal/runner"
	"github.com/abhishekbhonde/courier/internal/store"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := httptest.NewServer(New(st, slog.New(slog.NewTextHandler(io.Discard, nil)), Config{}, nil))
	t.Cleanup(srv.Close)
	return srv
}

func call(t *testing.T, srv *httptest.Server, method, path string, body any, out any) int {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, srv.URL+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatalf("%s %s: decode: %v", method, path, err)
		}
	}
	return resp.StatusCode
}

func TestExecuteUsesCollectionAndEnvironment(t *testing.T) {
	var gotAuth, gotPath string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
		w.WriteHeader(http.StatusTeapot)
	}))
	defer target.Close()

	srv := newTestServer(t)

	var c model.Collection
	call(t, srv, "POST", "/api/collections", model.Collection{
		Name:      "c",
		Variables: []model.Variable{{Key: "base", Value: "http://wrong", Enabled: true}},
		Auth:      model.Auth{Type: model.AuthBearer, Token: "{{token}}"},
	}, &c)

	var e model.Environment
	call(t, srv, "POST", "/api/environments", model.Environment{
		Name: "dev",
		Variables: []model.Variable{
			{Key: "base", Value: target.URL, Enabled: true},
			{Key: "token", Value: "env-token", Enabled: true},
		},
	}, &e)

	var res runner.Result
	status := call(t, srv, "POST", "/api/execute", map[string]any{
		"request":       model.RequestSpec{URL: "{{base}}/brew", Auth: model.Auth{Type: model.AuthInherit}},
		"collectionId":  c.ID,
		"environmentId": e.ID,
	}, &res)
	if status != 200 || res.Error != "" {
		t.Fatalf("execute: %d %+v", status, res)
	}
	if res.Status != http.StatusTeapot || gotPath != "/brew" || gotAuth != "Bearer env-token" {
		t.Errorf("status=%d path=%q auth=%q", res.Status, gotPath, gotAuth)
	}

	var history []model.HistoryEntry
	call(t, srv, "GET", "/api/history", nil, &history)
	if len(history) != 1 || history[0].Request.URL != "{{base}}/brew" || history[0].Status != http.StatusTeapot {
		t.Errorf("history: %+v", history)
	}
}

func TestCRUDErrors(t *testing.T) {
	srv := newTestServer(t)
	var errBody map[string]string
	if s := call(t, srv, "POST", "/api/collections", model.Collection{Name: " "}, &errBody); s != 400 || errBody["error"] == "" {
		t.Errorf("empty name: %d %v", s, errBody)
	}
	if s := call(t, srv, "DELETE", "/api/collections/missing", nil, nil); s != 404 {
		t.Errorf("delete missing: %d", s)
	}
	if s := call(t, srv, "GET", "/api/nope", nil, nil); s != 404 {
		t.Errorf("unknown endpoint: %d", s)
	}
}

func TestImportCurlAndPostman(t *testing.T) {
	srv := newTestServer(t)
	var spec model.RequestSpec
	if s := call(t, srv, "POST", "/api/import/curl", map[string]string{"command": "curl -X PATCH https://x.test"}, &spec); s != 200 || spec.Method != "PATCH" {
		t.Errorf("curl import: %d %+v", s, spec)
	}

	var out struct {
		Collection *model.CollectionTree `json:"collection"`
	}
	content := `{"info":{"name":"P"},"item":[{"name":"r","request":{"method":"GET","url":"https://x.test"}}]}`
	if s := call(t, srv, "POST", "/api/import/postman", map[string]string{"content": content}, &out); s != 201 || out.Collection == nil || len(out.Collection.Requests) != 1 {
		t.Fatalf("postman import: %d %+v", s, out)
	}

	resp, err := http.Get(srv.URL + "/api/collections/" + out.Collection.ID + "/export")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if !strings.Contains(resp.Header.Get("Content-Disposition"), "P.postman_collection.json") {
		t.Errorf("export disposition: %q", resp.Header.Get("Content-Disposition"))
	}
}

func TestGuard(t *testing.T) {
	srv := newTestServer(t)

	// Cross-site form posts arrive as text/plain without a preflight.
	req, _ := http.NewRequest("POST", srv.URL+"/api/collections", strings.NewReader(`{"name":"x"}`))
	req.Header.Set("Content-Type", "text/plain")
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain post: %d", resp.StatusCode)
	}

	req, _ = http.NewRequest("POST", srv.URL+"/api/collections", strings.NewReader(`{"name":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != http.StatusForbidden {
		t.Errorf("foreign origin: %d", resp.StatusCode)
	}

	// DNS rebinding: an attacker domain resolving to 127.0.0.1.
	req, _ = http.NewRequest("GET", srv.URL+"/api/collections", nil)
	req.Host = "evil.example"
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != http.StatusForbidden {
		t.Errorf("foreign host: %d", resp.StatusCode)
	}

	req, _ = http.NewRequest("GET", srv.URL+"/api/collections", nil)
	req.Header.Set("Origin", srv.URL)
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != http.StatusOK {
		t.Errorf("same origin: %d", resp.StatusCode)
	}
}
