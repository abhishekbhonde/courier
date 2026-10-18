package importer

import (
	"encoding/json"
	"testing"

	"github.com/abhishekbhonde/courier/internal/model"
)

func TestParseCurl(t *testing.T) {
	tests := []struct {
		name  string
		cmd   string
		check func(t *testing.T, s model.RequestSpec)
	}{
		{
			name: "json post with continuation",
			cmd: `curl -X POST 'https://api.example.com/users?page=2' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer abc" \
  --data-raw '{"name": "Ada"}'`,
			check: func(t *testing.T, s model.RequestSpec) {
				if s.Method != "POST" || s.URL != "https://api.example.com/users?page=2" {
					t.Errorf("method/url: %s %s", s.Method, s.URL)
				}
				if len(s.Headers) != 2 || s.Headers[1].Value != "Bearer abc" {
					t.Errorf("headers: %+v", s.Headers)
				}
				if s.Body.Mode != model.BodyJSON || s.Body.Raw != `{"name": "Ada"}` {
					t.Errorf("body: %+v", s.Body)
				}
				if len(s.Params) != 1 || s.Params[0].Key != "page" || s.Params[0].Value != "2" {
					t.Errorf("params: %+v", s.Params)
				}
			},
		},
		{
			name: "form data implies POST and urlencoded",
			cmd:  `curl https://x.test/login -d user=ada -d 'pass=a%20b'`,
			check: func(t *testing.T, s model.RequestSpec) {
				if s.Method != "POST" || s.Body.Mode != model.BodyURLEncoded {
					t.Errorf("got %s %s", s.Method, s.Body.Mode)
				}
				if len(s.Body.URLEncoded) != 2 || s.Body.URLEncoded[1].Value != "a b" {
					t.Errorf("urlencoded: %+v", s.Body.URLEncoded)
				}
			},
		},
		{
			name: "combined short flags, basic auth, multipart",
			cmd:  `curl -sSL -XPUT -u admin:pw https://x.test/up -F name=doc -F 'file=@/tmp/a.png;type=image/png'`,
			check: func(t *testing.T, s model.RequestSpec) {
				if s.Method != "PUT" || s.Auth.Type != model.AuthBasic || s.Auth.Password != "pw" {
					t.Errorf("method/auth: %s %+v", s.Method, s.Auth)
				}
				if s.Body.Mode != model.BodyFormData || len(s.Body.FormData) != 2 {
					t.Fatalf("form: %+v", s.Body)
				}
				f := s.Body.FormData[1]
				if f.Type != model.FieldFile || f.FileName != "a.png" || f.ContentType != "image/png" {
					t.Errorf("file field: %+v", f)
				}
			},
		},
		{
			name: "-G moves data to query",
			cmd:  `curl -G https://x.test/search --data-urlencode "q=hello world"`,
			check: func(t *testing.T, s model.RequestSpec) {
				if s.Method != "GET" || s.URL != "https://x.test/search?q=hello+world" || s.Body.Mode != model.BodyNone {
					t.Errorf("got %s %s %s", s.Method, s.URL, s.Body.Mode)
				}
			},
		},
		{
			name: "long flag with equals and --url",
			cmd:  `curl --request=DELETE --url=https://x.test/items/1 --header='X-A: 1'`,
			check: func(t *testing.T, s model.RequestSpec) {
				if s.Method != "DELETE" || s.URL != "https://x.test/items/1" || len(s.Headers) != 1 {
					t.Errorf("got %+v", s)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := ParseCurl(tt.cmd)
			if err != nil {
				t.Fatal(err)
			}
			tt.check(t, s)
		})
	}

	for _, bad := range []string{"wget x", "curl", `curl 'unterminated`} {
		if _, err := ParseCurl(bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

const samplePostman = `{
  "info": {"name": "Sample", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
  "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}"}]},
  "variable": [{"key": "base", "value": "https://api.test"}],
  "item": [
    {
      "name": "Users",
      "auth": {"type": "apikey", "apikey": [{"key": "key", "value": "X-Key"}, {"key": "value", "value": "k"}]},
      "item": [
        {
          "name": "Create user",
          "request": {
            "method": "POST",
            "header": [{"key": "X-A", "value": "1", "disabled": true}],
            "url": {"raw": "{{base}}/users?x=1", "query": [{"key": "x", "value": "1"}]},
            "body": {"mode": "raw", "raw": "{\"a\":1}", "options": {"raw": {"language": "json"}}}
          }
        },
        {"name": "Nested", "item": [{"name": "Ping", "request": "https://api.test/ping"}]}
      ]
    },
    {
      "name": "Login",
      "request": {
        "method": "POST",
        "auth": {"type": "noauth"},
        "url": "{{base}}/login",
        "body": {"mode": "urlencoded", "urlencoded": [{"key": "u", "value": "ada"}]}
      }
    }
  ]
}`

func TestImportPostmanCollection(t *testing.T) {
	imp, err := ImportPostman([]byte(samplePostman))
	if err != nil {
		t.Fatal(err)
	}
	c := imp.Collection
	if c == nil || c.Name != "Sample" || c.Auth.Type != model.AuthBearer || len(c.Variables) != 1 {
		t.Fatalf("collection: %+v", c)
	}
	if len(c.Folders) != 2 || len(c.Requests) != 3 {
		t.Fatalf("got %d folders, %d requests", len(c.Folders), len(c.Requests))
	}
	if c.Folders[1].ParentID == nil || *c.Folders[1].ParentID != c.Folders[0].ID {
		t.Error("nested folder parent not set")
	}

	byName := map[string]model.Request{}
	for _, r := range c.Requests {
		byName[r.Name] = r
	}
	create := byName["Create user"]
	if create.Body.Mode != model.BodyJSON || create.Headers[0].Enabled || len(create.Params) != 1 {
		t.Errorf("create: %+v", create.RequestSpec)
	}
	// Folder auth is pushed down to inheriting requests, including nested ones.
	if create.Auth.Type != model.AuthAPIKey || byName["Ping"].Auth.Type != model.AuthAPIKey {
		t.Errorf("folder auth not applied: %+v / %+v", create.Auth, byName["Ping"].Auth)
	}
	if login := byName["Login"]; login.Auth.Type != model.AuthNone || login.Body.Mode != model.BodyURLEncoded {
		t.Errorf("login: %+v", login.RequestSpec)
	}
}

func TestImportPostmanEnvironment(t *testing.T) {
	imp, err := ImportPostman([]byte(`{"name": "Prod", "values": [
		{"key": "base", "value": "https://prod", "enabled": true},
		{"key": "token", "value": "t", "enabled": false, "type": "secret"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	e := imp.Environment
	if e == nil || e.Name != "Prod" || len(e.Variables) != 2 || e.Variables[1].Enabled || !e.Variables[1].Secret {
		t.Fatalf("environment: %+v", e)
	}
}

func TestExportRoundTrip(t *testing.T) {
	imp, err := ImportPostman([]byte(samplePostman))
	if err != nil {
		t.Fatal(err)
	}
	out, err := ExportPostman(*imp.Collection)
	if err != nil {
		t.Fatal(err)
	}
	var probe map[string]any
	if err := json.Unmarshal(out, &probe); err != nil {
		t.Fatal(err)
	}
	again, err := ImportPostman(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Collection.Folders) != 2 || len(again.Collection.Requests) != 3 {
		t.Fatalf("round trip lost items: %d folders %d requests", len(again.Collection.Folders), len(again.Collection.Requests))
	}
}
