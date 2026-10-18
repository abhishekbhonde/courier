package runner

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/abhishekbhonde/courier/internal/model"
)

// echo responds with a JSON description of the request it received.
func echo(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"method":  r.Method,
		"uri":     r.RequestURI,
		"host":    r.Host,
		"headers": r.Header,
		"body":    string(body),
	})
}

type echoed struct {
	Method  string              `json:"method"`
	URI     string              `json:"uri"`
	Host    string              `json:"host"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body"`
}

func run(t *testing.T, spec model.RequestSpec, vars *Resolver) (*Result, echoed) {
	t.Helper()
	if vars == nil {
		vars = NewResolver()
	}
	res := Execute(context.Background(), spec, vars, OptionsFromSettings(model.DefaultSettings()))
	if res.Error != "" {
		t.Fatalf("execute: %s", res.Error)
	}
	var e echoed
	if err := json.Unmarshal([]byte(res.Body), &e); err != nil {
		t.Fatalf("decode echo: %v (%s)", err, res.Body)
	}
	return res, e
}

func TestVariablesHeadersAndBearer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(echo))
	defer srv.Close()

	vars := NewResolver(
		[]model.Variable{{Key: "base", Value: "overridden", Enabled: true}, {Key: "id", Value: "7", Enabled: true}},
		[]model.Variable{{Key: "base", Value: srv.URL, Enabled: true}, {Key: "token", Value: "s3cret", Enabled: true}},
	)
	spec := model.RequestSpec{
		Method: "post",
		URL:    "{{base}}/users/{{id}}?q=hello world&missing={{nope}}",
		Headers: []model.KV{
			{Key: "X-Trace", Value: "{{id}}", Enabled: true},
			{Key: "X-Disabled", Value: "1", Enabled: false},
		},
		Body: model.Body{Mode: model.BodyJSON, Raw: `{"id": {{id}}}`},
		Auth: model.Auth{Type: model.AuthBearer, Token: "{{token}}"},
	}
	res, e := run(t, spec, vars)

	if e.Method != "POST" {
		t.Errorf("method = %s", e.Method)
	}
	if e.URI != "/users/7?q=hello%20world&missing=%7B%7Bnope%7D%7D" {
		t.Errorf("uri = %s", e.URI)
	}
	if got := e.Headers["X-Trace"]; len(got) != 1 || got[0] != "7" {
		t.Errorf("X-Trace = %v", got)
	}
	if _, ok := e.Headers["X-Disabled"]; ok {
		t.Error("disabled header was sent")
	}
	if got := e.Headers["Authorization"]; len(got) != 1 || got[0] != "Bearer s3cret" {
		t.Errorf("Authorization = %v", got)
	}
	if got := e.Headers["Content-Type"]; len(got) != 1 || got[0] != "application/json" {
		t.Errorf("Content-Type = %v", got)
	}
	if e.Body != `{"id": 7}` {
		t.Errorf("body = %s", e.Body)
	}
	if len(res.Unresolved) != 1 || res.Unresolved[0] != "nope" {
		t.Errorf("unresolved = %v", res.Unresolved)
	}
	if res.Status != 200 || res.StatusText != "OK" || res.Timings.Total <= 0 {
		t.Errorf("status/timings: %d %q %+v", res.Status, res.StatusText, res.Timings)
	}
}

func TestBasicAuthAPIKeyAndHostOverride(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(echo))
	defer srv.Close()

	_, e := run(t, model.RequestSpec{
		URL:     srv.URL + "/x",
		Headers: []model.KV{{Key: "Host", Value: "api.internal", Enabled: true}},
		Auth:    model.Auth{Type: model.AuthBasic, Username: "u", Password: "p"},
	}, nil)
	if e.Host != "api.internal" {
		t.Errorf("host = %s", e.Host)
	}
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("u:p"))
	if got := e.Headers["Authorization"]; len(got) != 1 || got[0] != want {
		t.Errorf("Authorization = %v", got)
	}

	_, e = run(t, model.RequestSpec{
		URL:  srv.URL + "/x?a=1",
		Auth: model.Auth{Type: model.AuthAPIKey, Key: "api key", Value: "v&1", In: "query"},
	}, nil)
	if e.URI != "/x?a=1&api+key=v%261" {
		t.Errorf("uri = %s", e.URI)
	}
}

func TestURLEncodedAndMultipartBodies(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(echo))
	defer srv.Close()

	_, e := run(t, model.RequestSpec{
		Method: "POST",
		URL:    srv.URL,
		Body: model.Body{Mode: model.BodyURLEncoded, URLEncoded: []model.KV{
			{Key: "a", Value: "1 2", Enabled: true},
			{Key: "b", Value: "x", Enabled: false},
		}},
	}, nil)
	if e.Body != "a=1+2" {
		t.Errorf("urlencoded body = %q", e.Body)
	}

	var gotFile, gotField string
	mp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("parse multipart: %v", err)
			return
		}
		gotField = r.FormValue("name")
		f, h, err := r.FormFile("upload")
		if err != nil {
			t.Errorf("form file: %v", err)
			return
		}
		b, _ := io.ReadAll(f)
		gotFile = h.Filename + ":" + string(b)
		echo(w, r)
	}))
	defer mp.Close()

	run(t, model.RequestSpec{
		Method: "POST",
		URL:    mp.URL,
		// A user-supplied Content-Type must not break the multipart boundary.
		Headers: []model.KV{{Key: "content-type", Value: "multipart/form-data", Enabled: true}},
		Body: model.Body{Mode: model.BodyFormData, FormData: []model.FormField{
			{Key: "name", Value: "courier", Enabled: true, Type: model.FieldText},
			{Key: "upload", Enabled: true, Type: model.FieldFile, FileName: "a.txt",
				FileContent: base64.StdEncoding.EncodeToString([]byte("hello"))},
		}},
	}, nil)
	if gotField != "courier" || gotFile != "a.txt:hello" {
		t.Errorf("multipart: field=%q file=%q", gotField, gotFile)
	}
}

func TestGzipDecodingKeepsHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		zw.Write([]byte(strings.Repeat("courier ", 100)))
		zw.Close()
		w.Header().Set("Content-Encoding", "gzip")
		w.Write(buf.Bytes())
	}))
	defer srv.Close()

	res := Execute(context.Background(), model.RequestSpec{URL: srv.URL}, NewResolver(), OptionsFromSettings(model.DefaultSettings()))
	if res.Error != "" {
		t.Fatal(res.Error)
	}
	if res.Body != strings.Repeat("courier ", 100) {
		t.Errorf("body not decoded: %q", res.Body[:min(len(res.Body), 40)])
	}
	if res.WireSize >= res.Size {
		t.Errorf("expected compressed wire size < decoded size: %d vs %d", res.WireSize, res.Size)
	}
	found := false
	for _, h := range res.Headers {
		if h.Name == "Content-Encoding" {
			found = true
		}
	}
	if !found {
		t.Error("Content-Encoding header hidden")
	}
}

func TestRedirectsTimeoutAndTruncation(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/from", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/to", http.StatusFound) })
	mux.HandleFunc("/to", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("0123456789")) })
	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opts := OptionsFromSettings(model.DefaultSettings())
	res := Execute(context.Background(), model.RequestSpec{URL: srv.URL + "/from"}, NewResolver(), opts)
	if res.Status != 200 || !strings.HasSuffix(res.URL, "/to") {
		t.Errorf("follow: %d %s", res.Status, res.URL)
	}

	opts.FollowRedirects = false
	res = Execute(context.Background(), model.RequestSpec{URL: srv.URL + "/from"}, NewResolver(), opts)
	if res.Status != http.StatusFound {
		t.Errorf("no-follow status = %d", res.Status)
	}

	opts.FollowRedirects, opts.MaxResponseBytes = true, 4
	res = Execute(context.Background(), model.RequestSpec{URL: srv.URL + "/to"}, NewResolver(), opts)
	if !res.Truncated || res.Body != "0123" {
		t.Errorf("truncation: %v %q", res.Truncated, res.Body)
	}

	opts.Timeout = 50 * time.Millisecond
	res = Execute(context.Background(), model.RequestSpec{URL: srv.URL + "/slow"}, NewResolver(), opts)
	if !strings.Contains(res.Error, "timed out") {
		t.Errorf("timeout error = %q", res.Error)
	}
}

func TestBuildErrors(t *testing.T) {
	for _, u := range []string{"", "ftp://x", "http://"} {
		if _, _, err := Build(context.Background(), model.RequestSpec{URL: u}, NewResolver()); err == nil {
			t.Errorf("expected error for URL %q", u)
		}
	}
	req, _, err := Build(context.Background(), model.RequestSpec{URL: "example.com/a#frag"}, NewResolver())
	if err != nil || req.URL.String() != "http://example.com/a" {
		t.Errorf("scheme default: %v %v", req, err)
	}
}

func TestResolverDepthAndDynamic(t *testing.T) {
	r := NewResolver([]model.Variable{
		{Key: "a", Value: "{{b}}", Enabled: true},
		{Key: "b", Value: "{{a}}", Enabled: true},
		{Key: "off", Value: "x", Enabled: false},
	})
	r.Resolve("{{a}}") // must terminate
	if got := r.Resolve("{{ $timestamp }}"); got == "" || strings.Contains(got, "{{") {
		t.Errorf("dynamic var = %q", got)
	}
	if got := r.Resolve("{{off}}"); got != "{{off}}" {
		t.Errorf("disabled var resolved: %q", got)
	}
}
