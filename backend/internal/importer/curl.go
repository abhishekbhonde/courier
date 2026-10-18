// Package importer converts external formats (cURL commands, Postman
// collections and environments) to and from Courier's model.
package importer

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/abhishekbhonde/courier/internal/model"
)

// Short flags that take a value; their value may be attached ("-XPOST").
const shortValueFlags = "XHdFuAbeomxwcETr"

var longValueFlags = map[string]bool{
	"request": true, "header": true, "data": true, "data-raw": true, "data-binary": true,
	"data-ascii": true, "data-urlencode": true, "form": true, "form-string": true,
	"user": true, "user-agent": true, "cookie": true, "referer": true, "url": true,
	"output": true, "max-time": true, "connect-timeout": true, "proxy": true,
	"write-out": true, "cookie-jar": true, "cert": true, "key": true, "cacert": true,
	"retry": true, "oauth2-bearer": true, "upload-file": true, "range": true,
	"resolve": true, "interface": true, "max-redirs": true, "json": true,
}

var shortToLong = map[byte]string{
	'X': "request", 'H': "header", 'd': "data", 'F': "form", 'u': "user", 'A': "user-agent",
	'b': "cookie", 'e': "referer", 'o': "output", 'm': "max-time", 'x': "proxy",
	'w': "write-out", 'c': "cookie-jar", 'E': "cert", 'T': "upload-file", 'r': "range",
	'G': "get", 'I': "head",
}

type flag struct {
	name  string // long name
	value string
}

// ParseCurl converts a curl command line into a request spec.
func ParseCurl(cmd string) (model.RequestSpec, error) {
	var spec model.RequestSpec
	args, err := shellSplit(cmd)
	if err != nil {
		return spec, err
	}
	if len(args) > 0 && args[0] == "$" {
		args = args[1:]
	}
	if len(args) == 0 || args[0] != "curl" {
		return spec, errors.New("command must start with curl")
	}

	var flags []flag
	var rawURL string
	for i := 1; i < len(args); i++ {
		a := args[i]
		takeValue := func() (string, error) {
			if i+1 >= len(args) {
				return "", fmt.Errorf("flag %s is missing a value", a)
			}
			i++
			return args[i], nil
		}
		switch {
		case strings.HasPrefix(a, "--") && len(a) > 2:
			name, value, hasValue := strings.Cut(a[2:], "=")
			if longValueFlags[name] && !hasValue {
				if value, err = takeValue(); err != nil {
					return spec, err
				}
			}
			flags = append(flags, flag{name, value})
		case strings.HasPrefix(a, "-") && len(a) > 1:
			for j := 1; j < len(a); j++ {
				c := a[j]
				name := shortToLong[c]
				if strings.IndexByte(shortValueFlags, c) < 0 {
					if name != "" {
						flags = append(flags, flag{name: name})
					}
					continue
				}
				value := a[j+1:]
				if value == "" {
					if value, err = takeValue(); err != nil {
						return spec, err
					}
				}
				flags = append(flags, flag{name, value})
				break
			}
		default:
			if rawURL == "" {
				rawURL = a
			}
		}
	}

	var (
		method        string
		data          []string
		form          []model.FormField
		getMode, head bool
		jsonFlag      bool
	)
	for _, f := range flags {
		switch f.name {
		case "url":
			rawURL = f.value
		case "request":
			method = strings.ToUpper(f.value)
		case "header":
			k, v, _ := strings.Cut(f.value, ":")
			spec.Headers = append(spec.Headers, model.KV{Key: strings.TrimSpace(k), Value: strings.TrimSpace(v), Enabled: true})
		case "data", "data-raw", "data-binary", "data-ascii":
			data = append(data, f.value)
		case "json":
			data = append(data, f.value)
			jsonFlag = true
		case "data-urlencode":
			data = append(data, encodeDataURLEncode(f.value))
		case "form", "form-string":
			form = append(form, parseFormFlag(f.value, f.name == "form-string"))
		case "user":
			u, p, _ := strings.Cut(f.value, ":")
			spec.Auth = model.Auth{Type: model.AuthBasic, Username: u, Password: p}
		case "oauth2-bearer":
			spec.Auth = model.Auth{Type: model.AuthBearer, Token: f.value}
		case "user-agent":
			spec.Headers = append(spec.Headers, model.KV{Key: "User-Agent", Value: f.value, Enabled: true})
		case "cookie":
			spec.Headers = append(spec.Headers, model.KV{Key: "Cookie", Value: f.value, Enabled: true})
		case "referer":
			spec.Headers = append(spec.Headers, model.KV{Key: "Referer", Value: f.value, Enabled: true})
		case "get":
			getMode = true
		case "head":
			head = true
		}
	}

	if rawURL == "" {
		return spec, errors.New("no URL found in curl command")
	}
	joined := strings.Join(data, "&")

	switch {
	case getMode && len(data) > 0:
		if strings.Contains(rawURL, "?") {
			rawURL += "&" + joined
		} else {
			rawURL += "?" + joined
		}
	case len(form) > 0:
		spec.Body = model.Body{Mode: model.BodyFormData, FormData: form}
	case len(data) > 0:
		spec.Body = bodyFromData(joined, headerValue(spec.Headers, "Content-Type"), jsonFlag)
		if jsonFlag {
			if headerValue(spec.Headers, "Content-Type") == "" {
				spec.Headers = append(spec.Headers, model.KV{Key: "Content-Type", Value: "application/json", Enabled: true})
			}
			if headerValue(spec.Headers, "Accept") == "" {
				spec.Headers = append(spec.Headers, model.KV{Key: "Accept", Value: "application/json", Enabled: true})
			}
		}
	}

	switch {
	case method != "":
	case head:
		method = "HEAD"
	case getMode:
		method = "GET"
	case len(data) > 0 || len(form) > 0:
		method = "POST"
	default:
		method = "GET"
	}

	spec.Method = method
	spec.URL = rawURL
	spec.Params = ParamsFromURL(rawURL)
	spec.Normalize()
	return spec, nil
}

func bodyFromData(data, contentType string, isJSON bool) model.Body {
	ct := strings.ToLower(contentType)
	trimmed := strings.TrimSpace(data)
	switch {
	case isJSON || strings.Contains(ct, "json") ||
		(ct == "" && (strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "["))):
		return model.Body{Mode: model.BodyJSON, Raw: data}
	case ct == "" || strings.Contains(ct, "x-www-form-urlencoded"):
		if kvs, ok := parseURLEncoded(data); ok {
			return model.Body{Mode: model.BodyURLEncoded, URLEncoded: kvs}
		}
	}
	return model.Body{Mode: model.BodyRaw, Raw: data, ContentType: contentType}
}

func parseURLEncoded(data string) ([]model.KV, bool) {
	var out []model.KV
	for _, part := range strings.Split(data, "&") {
		if part == "" {
			continue
		}
		k, v, ok := strings.Cut(part, "=")
		if !ok {
			return nil, false
		}
		dk, err1 := url.QueryUnescape(k)
		dv, err2 := url.QueryUnescape(v)
		if err1 != nil || err2 != nil {
			return nil, false
		}
		out = append(out, model.KV{Key: dk, Value: dv, Enabled: true})
	}
	return out, len(out) > 0
}

// encodeDataURLEncode mirrors curl's --data-urlencode: "name=value" encodes
// only the value, a bare string is encoded whole.
func encodeDataURLEncode(v string) string {
	if name, value, ok := strings.Cut(v, "="); ok {
		if name == "" {
			return url.QueryEscape(value)
		}
		return name + "=" + url.QueryEscape(value)
	}
	return url.QueryEscape(v)
}

func parseFormFlag(v string, literal bool) model.FormField {
	key, value, _ := strings.Cut(v, "=")
	f := model.FormField{Key: key, Value: value, Enabled: true, Type: model.FieldText}
	if literal || !strings.HasPrefix(value, "@") {
		return f
	}
	// "@path;type=mime" — the file itself cannot be imported, keep its name.
	parts := strings.Split(value[1:], ";")
	f.Type, f.Value = model.FieldFile, ""
	f.FileName = parts[0]
	if i := strings.LastIndexAny(f.FileName, `/\`); i >= 0 {
		f.FileName = f.FileName[i+1:]
	}
	for _, p := range parts[1:] {
		if t, ok := strings.CutPrefix(strings.TrimSpace(p), "type="); ok {
			f.ContentType = t
		}
	}
	return f
}

func headerValue(h []model.KV, name string) string {
	for _, kv := range h {
		if strings.EqualFold(kv.Key, name) {
			return kv.Value
		}
	}
	return ""
}

// ParamsFromURL extracts query parameters, keeping them raw-decoded for display.
func ParamsFromURL(raw string) []model.KV {
	out := []model.KV{}
	_, query, ok := strings.Cut(raw, "?")
	if !ok {
		return out
	}
	query, _, _ = strings.Cut(query, "#")
	for _, part := range strings.Split(query, "&") {
		if part == "" {
			continue
		}
		k, v, _ := strings.Cut(part, "=")
		if dk, err := url.QueryUnescape(k); err == nil {
			k = dk
		}
		if dv, err := url.QueryUnescape(v); err == nil {
			v = dv
		}
		out = append(out, model.KV{Key: k, Value: v, Enabled: true})
	}
	return out
}

// shellSplit tokenizes a POSIX-ish shell command: quotes, backslash escapes,
// line continuations and ANSI-C $'...' strings.
func shellSplit(s string) ([]string, error) {
	var (
		out     []string
		cur     strings.Builder
		inToken bool
	)
	flush := func() {
		if inToken {
			out = append(out, cur.String())
			cur.Reset()
			inToken = false
		}
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '\\' && i+1 < len(s) && (s[i+1] == '\n' || (s[i+1] == '\r' && i+2 < len(s) && s[i+2] == '\n')):
			// line continuation
			if s[i+1] == '\r' {
				i++
			}
			i++
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			flush()
		case c == '\\':
			inToken = true
			if i+1 < len(s) {
				i++
				cur.WriteByte(s[i])
			}
		case c == '\'':
			inToken = true
			end := strings.IndexByte(s[i+1:], '\'')
			if end < 0 {
				return nil, errors.New("unterminated single quote")
			}
			cur.WriteString(s[i+1 : i+1+end])
			i += end + 1
		case c == '$' && i+1 < len(s) && s[i+1] == '\'':
			inToken = true
			i += 2
			closed := false
			for ; i < len(s); i++ {
				if s[i] == '\'' {
					closed = true
					break
				}
				if s[i] == '\\' && i+1 < len(s) {
					i++
					switch s[i] {
					case 'n':
						cur.WriteByte('\n')
					case 't':
						cur.WriteByte('\t')
					case 'r':
						cur.WriteByte('\r')
					default:
						cur.WriteByte(s[i])
					}
					continue
				}
				cur.WriteByte(s[i])
			}
			if !closed {
				return nil, errors.New("unterminated $' quote")
			}
		case c == '"':
			inToken = true
			closed := false
			for i++; i < len(s); i++ {
				if s[i] == '"' {
					closed = true
					break
				}
				if s[i] == '\\' && i+1 < len(s) && strings.IndexByte("\"\\$`\n", s[i+1]) >= 0 {
					i++
					if s[i] != '\n' {
						cur.WriteByte(s[i])
					}
					continue
				}
				cur.WriteByte(s[i])
			}
			if !closed {
				return nil, errors.New("unterminated double quote")
			}
		default:
			inToken = true
			cur.WriteByte(c)
		}
	}
	flush()
	return out, nil
}
