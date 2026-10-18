package importer

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/abhishekbhonde/courier/internal/model"
)

const postmanSchema = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

// Postman's JSON is loose: several fields may be a string or an object, so
// those are kept raw and interpreted by helpers below.

type pmCollection struct {
	Info struct {
		Name        string          `json:"name"`
		Description json.RawMessage `json:"description"`
	} `json:"info"`
	Item     []pmItem     `json:"item"`
	Variable []pmVariable `json:"variable"`
	Auth     *pmAuth      `json:"auth"`
}

type pmItem struct {
	Name    string          `json:"name"`
	Item    []pmItem        `json:"item"`
	Request json.RawMessage `json:"request"`
	Auth    *pmAuth         `json:"auth"`
}

type pmRequest struct {
	Method string          `json:"method"`
	Header json.RawMessage `json:"header"`
	Body   *pmBody         `json:"body"`
	URL    json.RawMessage `json:"url"`
	Auth   *pmAuth         `json:"auth"`
}

type pmKV struct {
	Key         string          `json:"key"`
	Value       any             `json:"value,omitempty"`
	Disabled    bool            `json:"disabled,omitempty"`
	Type        string          `json:"type,omitempty"`
	Src         json.RawMessage `json:"src,omitempty"`
	ContentType string          `json:"contentType,omitempty"`
	Description json.RawMessage `json:"description,omitempty"`
}

type pmBody struct {
	Mode       string `json:"mode"`
	Raw        string `json:"raw,omitempty"`
	URLEncoded []pmKV `json:"urlencoded,omitempty"`
	FormData   []pmKV `json:"formdata,omitempty"`
	GraphQL    *struct {
		Query     string `json:"query"`
		Variables string `json:"variables"`
	} `json:"graphql,omitempty"`
	Options *struct {
		Raw struct {
			Language string `json:"language"`
		} `json:"raw"`
	} `json:"options,omitempty"`
}

type pmURL struct {
	Raw   string `json:"raw"`
	Query []pmKV `json:"query"`
}

type pmAuth struct {
	Type   string `json:"type"`
	Bearer []pmKV `json:"bearer,omitempty"`
	Basic  []pmKV `json:"basic,omitempty"`
	APIKey []pmKV `json:"apikey,omitempty"`
}

type pmVariable struct {
	Key      string `json:"key"`
	Value    any    `json:"value"`
	Disabled bool   `json:"disabled,omitempty"`
	Type     string `json:"type,omitempty"`
}

type pmEnvironment struct {
	Name   string `json:"name"`
	Values []struct {
		Key     string `json:"key"`
		Value   any    `json:"value"`
		Enabled *bool  `json:"enabled"`
		Type    string `json:"type"`
	} `json:"values"`
}

// Imported is the result of ImportPostman: exactly one field is set.
type Imported struct {
	Collection  *model.CollectionTree `json:"collection,omitempty"`
	Environment *model.Environment    `json:"environment,omitempty"`
}

// ImportPostman detects and converts a Postman v2.0/v2.1 collection or a
// Postman environment export.
func ImportPostman(data []byte) (Imported, error) {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(data, &probe); err != nil {
		return Imported{}, fmt.Errorf("not valid JSON: %w", err)
	}
	if _, ok := probe["info"]; ok {
		t, err := importCollection(data)
		return Imported{Collection: t}, err
	}
	if _, ok := probe["values"]; ok {
		e, err := importEnvironment(data)
		return Imported{Environment: e}, err
	}
	return Imported{}, errors.New("unrecognized format: expected a Postman collection (v2.x) or environment")
}

func importEnvironment(data []byte) (*model.Environment, error) {
	var pe pmEnvironment
	if err := json.Unmarshal(data, &pe); err != nil {
		return nil, err
	}
	env := &model.Environment{Name: pe.Name, Variables: []model.Variable{}}
	if env.Name == "" {
		env.Name = "Imported environment"
	}
	for _, v := range pe.Values {
		env.Variables = append(env.Variables, model.Variable{
			Key:     v.Key,
			Value:   stringify(v.Value),
			Enabled: v.Enabled == nil || *v.Enabled,
			Secret:  v.Type == "secret",
		})
	}
	return env, nil
}

func importCollection(data []byte) (*model.CollectionTree, error) {
	var pc pmCollection
	if err := json.Unmarshal(data, &pc); err != nil {
		return nil, err
	}
	t := &model.CollectionTree{
		Collection: model.Collection{
			Name:        pc.Info.Name,
			Description: description(pc.Info.Description),
			Variables:   []model.Variable{},
			Auth:        model.Auth{Type: model.AuthNone},
		},
		Folders:  []model.Folder{},
		Requests: []model.Request{},
	}
	if t.Name == "" {
		t.Name = "Imported collection"
	}
	if pc.Auth != nil {
		t.Auth = convertAuth(pc.Auth)
		if t.Auth.Type == model.AuthInherit {
			t.Auth.Type = model.AuthNone
		}
	}
	for _, v := range pc.Variable {
		t.Variables = append(t.Variables, model.Variable{Key: v.Key, Value: stringify(v.Value), Enabled: !v.Disabled})
	}
	if err := walkItems(t, pc.Item, nil, nil); err != nil {
		return nil, err
	}
	return t, nil
}

// walkItems flattens Postman's nested items into folders (parents first) and
// requests. Courier has no folder-level auth, so a folder's auth is pushed
// down onto descendant requests that would otherwise inherit.
func walkItems(t *model.CollectionTree, items []pmItem, parent *string, folderAuth *model.Auth) error {
	folderSort, reqSort := 0, 0
	for _, it := range items {
		if len(it.Request) == 0 || string(it.Request) == "null" {
			id := model.NewID()
			t.Folders = append(t.Folders, model.Folder{ID: id, ParentID: parent, Name: nonEmpty(it.Name, "Folder"), Sort: folderSort})
			folderSort++
			auth := folderAuth
			if it.Auth != nil {
				if a := convertAuth(it.Auth); a.Type != model.AuthInherit {
					auth = &a
				}
			}
			if err := walkItems(t, it.Item, &id, auth); err != nil {
				return err
			}
			continue
		}
		spec, err := convertRequest(it.Request)
		if err != nil {
			return fmt.Errorf("request %q: %w", it.Name, err)
		}
		if spec.Auth.Type == model.AuthInherit && folderAuth != nil {
			spec.Auth = *folderAuth
		}
		t.Requests = append(t.Requests, model.Request{
			FolderID: parent, Name: nonEmpty(it.Name, spec.URL), Sort: reqSort, RequestSpec: spec,
		})
		reqSort++
	}
	return nil
}

func convertRequest(raw json.RawMessage) (model.RequestSpec, error) {
	var spec model.RequestSpec
	// A request may be just a URL string.
	var urlOnly string
	if json.Unmarshal(raw, &urlOnly) == nil {
		spec.URL, spec.Method = urlOnly, "GET"
		spec.Params = ParamsFromURL(urlOnly)
		spec.Auth.Type = model.AuthInherit
		spec.Normalize()
		return spec, nil
	}

	var pr pmRequest
	if err := json.Unmarshal(raw, &pr); err != nil {
		return spec, err
	}
	spec.Method = strings.ToUpper(nonEmpty(pr.Method, "GET"))
	spec.URL, spec.Params = convertURL(pr.URL)
	spec.Headers = convertHeaders(pr.Header)
	spec.Body = convertBody(pr.Body)
	if pr.Auth != nil {
		spec.Auth = convertAuth(pr.Auth)
	} else {
		spec.Auth.Type = model.AuthInherit
	}
	spec.Normalize()
	return spec, nil
}

func convertURL(raw json.RawMessage) (string, []model.KV) {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, ParamsFromURL(s)
	}
	var u pmURL
	if json.Unmarshal(raw, &u) != nil {
		return "", []model.KV{}
	}
	params := []model.KV{}
	if len(u.Query) == 0 {
		params = ParamsFromURL(u.Raw)
	}
	for _, q := range u.Query {
		params = append(params, model.KV{Key: q.Key, Value: stringify(q.Value), Enabled: !q.Disabled, Description: description(q.Description)})
	}
	return u.Raw, params
}

func convertHeaders(raw json.RawMessage) []model.KV {
	out := []model.KV{}
	var list []pmKV
	if json.Unmarshal(raw, &list) == nil {
		for _, h := range list {
			out = append(out, model.KV{Key: h.Key, Value: stringify(h.Value), Enabled: !h.Disabled, Description: description(h.Description)})
		}
		return out
	}
	// Headers may also be a raw "Key: value\n" block.
	var block string
	if json.Unmarshal(raw, &block) == nil {
		for _, line := range strings.Split(block, "\n") {
			if k, v, ok := strings.Cut(line, ":"); ok {
				out = append(out, model.KV{Key: strings.TrimSpace(k), Value: strings.TrimSpace(v), Enabled: true})
			}
		}
	}
	return out
}

var languageContentTypes = map[string]string{
	"text":       "text/plain",
	"javascript": "application/javascript",
	"html":       "text/html",
	"xml":        "application/xml",
}

func convertBody(b *pmBody) model.Body {
	if b == nil {
		return model.Body{Mode: model.BodyNone}
	}
	switch b.Mode {
	case "raw":
		lang := ""
		if b.Options != nil {
			lang = b.Options.Raw.Language
		}
		if lang == "json" {
			return model.Body{Mode: model.BodyJSON, Raw: b.Raw}
		}
		return model.Body{Mode: model.BodyRaw, Raw: b.Raw, ContentType: languageContentTypes[lang]}
	case "urlencoded":
		kvs := []model.KV{}
		for _, kv := range b.URLEncoded {
			kvs = append(kvs, model.KV{Key: kv.Key, Value: stringify(kv.Value), Enabled: !kv.Disabled, Description: description(kv.Description)})
		}
		return model.Body{Mode: model.BodyURLEncoded, URLEncoded: kvs}
	case "formdata":
		fields := []model.FormField{}
		for _, kv := range b.FormData {
			f := model.FormField{Key: kv.Key, Enabled: !kv.Disabled, Type: model.FieldText, ContentType: kv.ContentType}
			if kv.Type == "file" {
				f.Type = model.FieldFile
				f.FileName = srcName(kv.Src)
			} else {
				f.Value = stringify(kv.Value)
			}
			fields = append(fields, f)
		}
		return model.Body{Mode: model.BodyFormData, FormData: fields}
	case "graphql":
		if b.GraphQL == nil {
			return model.Body{Mode: model.BodyNone}
		}
		payload := map[string]any{"query": b.GraphQL.Query}
		if strings.TrimSpace(b.GraphQL.Variables) != "" {
			payload["variables"] = json.RawMessage(b.GraphQL.Variables)
		}
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			// Variables were not valid JSON; send them as a string instead.
			payload["variables"] = b.GraphQL.Variables
			out, _ = json.MarshalIndent(payload, "", "  ")
		}
		return model.Body{Mode: model.BodyJSON, Raw: string(out)}
	}
	return model.Body{Mode: model.BodyNone}
}

func convertAuth(a *pmAuth) model.Auth {
	attr := func(list []pmKV, key string) string {
		for _, kv := range list {
			if kv.Key == key {
				return stringify(kv.Value)
			}
		}
		return ""
	}
	switch a.Type {
	case "noauth":
		return model.Auth{Type: model.AuthNone}
	case "bearer":
		return model.Auth{Type: model.AuthBearer, Token: attr(a.Bearer, "token")}
	case "basic":
		return model.Auth{Type: model.AuthBasic, Username: attr(a.Basic, "username"), Password: attr(a.Basic, "password")}
	case "apikey":
		in := attr(a.APIKey, "in")
		if in != "query" {
			in = "header"
		}
		return model.Auth{Type: model.AuthAPIKey, Key: attr(a.APIKey, "key"), Value: attr(a.APIKey, "value"), In: in}
	}
	// Unsupported schemes (oauth2, digest, ...) fall back to inheriting.
	return model.Auth{Type: model.AuthInherit}
}

func description(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var obj struct {
		Content string `json:"content"`
	}
	json.Unmarshal(raw, &obj)
	return obj.Content
}

func srcName(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		var list []string
		if json.Unmarshal(raw, &list) == nil && len(list) > 0 {
			s = list[0]
		}
	}
	if i := strings.LastIndexAny(s, `/\`); i >= 0 {
		s = s[i+1:]
	}
	return s
}

func stringify(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

func nonEmpty(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

// ---- export ----

type exCollection struct {
	Info struct {
		Name        string `json:"name"`
		Description string `json:"description,omitempty"`
		Schema      string `json:"schema"`
	} `json:"info"`
	Item     []exItem     `json:"item"`
	Variable []pmVariable `json:"variable,omitempty"`
	Auth     *pmAuth      `json:"auth,omitempty"`
}

type exItem struct {
	Name    string     `json:"name"`
	Item    []exItem   `json:"item,omitempty"`
	Request *exRequest `json:"request,omitempty"`
}

type exRequest struct {
	Method string  `json:"method"`
	Header []pmKV  `json:"header"`
	Body   *pmBody `json:"body,omitempty"`
	URL    exURL   `json:"url"`
	Auth   *pmAuth `json:"auth,omitempty"`
}

type exURL struct {
	Raw   string `json:"raw"`
	Query []pmKV `json:"query,omitempty"`
}

// ExportPostman converts a collection tree to Postman collection v2.1 JSON.
func ExportPostman(t model.CollectionTree) ([]byte, error) {
	var out exCollection
	out.Info.Name = t.Name
	out.Info.Description = t.Description
	out.Info.Schema = postmanSchema
	for _, v := range t.Variables {
		out.Variable = append(out.Variable, pmVariable{Key: v.Key, Value: v.Value, Disabled: !v.Enabled, Type: "string"})
	}
	out.Auth = exportAuth(t.Auth)

	children := map[string][]model.Folder{}
	for _, f := range t.Folders {
		children[ptrKey(f.ParentID)] = append(children[ptrKey(f.ParentID)], f)
	}
	requests := map[string][]model.Request{}
	for _, r := range t.Requests {
		requests[ptrKey(r.FolderID)] = append(requests[ptrKey(r.FolderID)], r)
	}

	var build func(parent string) []exItem
	build = func(parent string) []exItem {
		items := []exItem{}
		for _, f := range children[parent] {
			items = append(items, exItem{Name: f.Name, Item: build(f.ID)})
		}
		for _, r := range requests[parent] {
			items = append(items, exItem{Name: r.Name, Request: exportRequest(r.RequestSpec)})
		}
		return items
	}
	out.Item = build("")
	return json.MarshalIndent(out, "", "  ")
}

func ptrKey(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func exportRequest(s model.RequestSpec) *exRequest {
	r := &exRequest{Method: s.Method, Header: []pmKV{}, URL: exURL{Raw: s.URL}, Auth: exportAuth(s.Auth)}
	for _, h := range s.Headers {
		r.Header = append(r.Header, pmKV{Key: h.Key, Value: h.Value, Disabled: !h.Enabled})
	}
	for _, p := range s.Params {
		r.URL.Query = append(r.URL.Query, pmKV{Key: p.Key, Value: p.Value, Disabled: !p.Enabled})
	}
	switch s.Body.Mode {
	case model.BodyJSON:
		r.Body = &pmBody{Mode: "raw", Raw: s.Body.Raw}
		r.Body.Options = &struct {
			Raw struct {
				Language string `json:"language"`
			} `json:"raw"`
		}{}
		r.Body.Options.Raw.Language = "json"
	case model.BodyRaw:
		r.Body = &pmBody{Mode: "raw", Raw: s.Body.Raw}
	case model.BodyURLEncoded:
		r.Body = &pmBody{Mode: "urlencoded", URLEncoded: []pmKV{}}
		for _, kv := range s.Body.URLEncoded {
			r.Body.URLEncoded = append(r.Body.URLEncoded, pmKV{Key: kv.Key, Value: kv.Value, Disabled: !kv.Enabled})
		}
	case model.BodyFormData:
		r.Body = &pmBody{Mode: "formdata", FormData: []pmKV{}}
		for _, f := range s.Body.FormData {
			kv := pmKV{Key: f.Key, Disabled: !f.Enabled, Type: "text", ContentType: f.ContentType}
			if f.Type == model.FieldFile {
				kv.Type = "file"
				src, _ := json.Marshal(f.FileName)
				kv.Src = src
			} else {
				kv.Value = f.Value
			}
			r.Body.FormData = append(r.Body.FormData, kv)
		}
	}
	return r
}

func exportAuth(a model.Auth) *pmAuth {
	attr := func(key, value string) pmKV { return pmKV{Key: key, Value: value, Type: "string"} }
	switch a.Type {
	case model.AuthNone:
		return &pmAuth{Type: "noauth"}
	case model.AuthBearer:
		return &pmAuth{Type: "bearer", Bearer: []pmKV{attr("token", a.Token)}}
	case model.AuthBasic:
		return &pmAuth{Type: "basic", Basic: []pmKV{attr("username", a.Username), attr("password", a.Password)}}
	case model.AuthAPIKey:
		in := a.In
		if in == "" {
			in = "header"
		}
		return &pmAuth{Type: "apikey", APIKey: []pmKV{attr("key", a.Key), attr("value", a.Value), attr("in", in)}}
	}
	return nil // inherit
}
