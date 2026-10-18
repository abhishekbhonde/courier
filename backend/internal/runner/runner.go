// Package runner turns a RequestSpec into a real HTTP request and captures a
// detailed result: status, headers, cookies, body and a timing breakdown.
package runner

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/textproto"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/abhishekbhonde/courier/internal/model"
)

const userAgent = "Courier/0.1"

// Options control how a request is sent.
type Options struct {
	Timeout          time.Duration
	FollowRedirects  bool
	VerifyTLS        bool
	MaxResponseBytes int64
}

func OptionsFromSettings(s model.Settings) Options {
	return Options{
		Timeout:          time.Duration(s.TimeoutMs) * time.Millisecond,
		FollowRedirects:  s.FollowRedirects,
		VerifyTLS:        s.VerifyTLS,
		MaxResponseBytes: s.MaxResponseBytes,
	}
}

type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain,omitempty"`
	Path     string `json:"path,omitempty"`
	Expires  string `json:"expires,omitempty"`
	MaxAge   int    `json:"maxAge,omitempty"`
	HTTPOnly bool   `json:"httpOnly"`
	Secure   bool   `json:"secure"`
	SameSite string `json:"sameSite,omitempty"`
}

// Timings are phase durations in milliseconds. Phases that did not happen
// (for example DNS for an IP literal, or TLS for plain HTTP) are zero.
type Timings struct {
	DNS      float64 `json:"dns"`
	Connect  float64 `json:"connect"`
	TLS      float64 `json:"tls"`
	Send     float64 `json:"send"`
	Waiting  float64 `json:"waiting"`
	Download float64 `json:"download"`
	Total    float64 `json:"total"`
}

// SentRequest describes what actually went over the wire, after variable
// substitution and auth.
type SentRequest struct {
	Method   string   `json:"method"`
	URL      string   `json:"url"`
	Headers  []Header `json:"headers"`
	BodySize int64    `json:"bodySize"`
}

type Result struct {
	Status       int          `json:"status"`
	StatusText   string       `json:"statusText"`
	Proto        string       `json:"proto"`
	URL          string       `json:"url"`
	Headers      []Header     `json:"headers"`
	Cookies      []Cookie     `json:"cookies"`
	ContentType  string       `json:"contentType"`
	Body         string       `json:"body"`
	BodyEncoding string       `json:"bodyEncoding"` // "utf8" or "base64"
	Size         int64        `json:"size"`         // decoded body bytes
	WireSize     int64        `json:"wireSize"`     // body bytes as received
	Truncated    bool         `json:"truncated"`
	Timings      Timings      `json:"timings"`
	Request      *SentRequest `json:"request,omitempty"`
	Unresolved   []string     `json:"unresolvedVariables"`
	Error        string       `json:"error,omitempty"`
}

// Execute sends spec and always returns a Result; transport failures are
// reported in Result.Error.
func Execute(ctx context.Context, spec model.RequestSpec, vars *Resolver, opts Options) *Result {
	res := &Result{Headers: []Header{}, Cookies: []Cookie{}}
	if opts.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, opts.Timeout)
		defer cancel()
	}

	req, bodySize, err := Build(ctx, spec, vars)
	res.Unresolved = vars.Missing()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.Request = &SentRequest{
		Method:   req.Method,
		URL:      req.URL.String(),
		Headers:  flattenHeaders(req.Header),
		BodySize: bodySize,
	}

	tm := &timer{}
	req = req.WithContext(httptrace.WithClientTrace(ctx, tm.trace()))
	client := newClient(opts)
	defer client.CloseIdleConnections()

	tm.start = time.Now()
	resp, err := client.Do(req)
	if err != nil {
		res.Timings = tm.timings(time.Now())
		res.Error = describeError(ctx, err, opts.Timeout)
		return res
	}
	defer resp.Body.Close()

	raw, truncated, readErr := readLimited(resp.Body, opts.MaxResponseBytes)
	end := time.Now()

	res.Status = resp.StatusCode
	res.StatusText = statusText(resp)
	res.Proto = resp.Proto
	res.URL = resp.Request.URL.String()
	res.Headers = flattenHeaders(resp.Header)
	res.Cookies = convertCookies(resp.Cookies())
	res.ContentType = resp.Header.Get("Content-Type")
	res.Timings = tm.timings(end)
	res.WireSize = int64(len(raw))
	res.Truncated = truncated
	if readErr != nil {
		res.Error = "reading response body: " + describeError(ctx, readErr, opts.Timeout)
	}

	body := raw
	if enc := resp.Header.Get("Content-Encoding"); enc != "" && !truncated {
		if decoded, err := decode(raw, enc, opts.MaxResponseBytes); err == nil {
			body = decoded
		}
	}
	res.Size = int64(len(body))
	if utf8.Valid(body) {
		res.Body, res.BodyEncoding = string(body), "utf8"
	} else {
		res.Body, res.BodyEncoding = base64.StdEncoding.EncodeToString(body), "base64"
	}
	return res
}

// Build resolves variables and constructs the outgoing request. It returns
// the request and the size of its body.
func Build(ctx context.Context, spec model.RequestSpec, vars *Resolver) (*http.Request, int64, error) {
	method := strings.ToUpper(strings.TrimSpace(spec.Method))
	if method == "" {
		method = http.MethodGet
	}

	u, err := buildURL(vars.Resolve(spec.URL))
	if err != nil {
		return nil, 0, err
	}

	header := http.Header{}
	host := ""
	for _, kv := range spec.Headers {
		key := strings.TrimSpace(vars.Resolve(kv.Key))
		if !kv.Enabled || key == "" {
			continue
		}
		value := vars.Resolve(kv.Value)
		if strings.EqualFold(key, "Host") {
			host = value
			continue
		}
		// Assign directly instead of Header.Add to preserve the user's casing.
		header[key] = append(header[key], value)
	}

	body, contentType, err := buildBody(spec.Body, vars)
	if err != nil {
		return nil, 0, err
	}
	if contentType != "" {
		if strings.HasPrefix(contentType, "multipart/") {
			// The boundary must match the generated body.
			deleteHeader(header, "Content-Type")
			header.Set("Content-Type", contentType)
		} else if !hasHeader(header, "Content-Type") {
			header.Set("Content-Type", contentType)
		}
	}

	applyAuth(spec.Auth, vars, header, u)

	setDefault(header, "User-Agent", userAgent)
	setDefault(header, "Accept", "*/*")
	setDefault(header, "Accept-Encoding", "gzip, deflate")

	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("invalid request: %w", err)
	}
	if len(body) == 0 {
		req.Body, req.ContentLength = http.NoBody, 0
	}
	req.Header = header
	if host != "" {
		req.Host = host
	}
	return req, int64(len(body)), nil
}

func buildURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("URL is empty")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("unsupported URL scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return nil, errors.New("URL has no host")
	}
	u.RawQuery = escapeQuery(u.RawQuery)
	u.Fragment, u.RawFragment = "", ""
	return u, nil
}

// escapeQuery percent-encodes only the bytes that are not legal in a query
// string (spaces, quotes, non-ASCII, stray '%'), leaving everything else
// exactly as the user typed it.
func escapeQuery(q string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(q); i++ {
		c := q[i]
		switch {
		case c == '%' && i+2 < len(q) && isHex(q[i+1]) && isHex(q[i+2]):
			b.WriteByte(c)
		case c <= 0x20 || c >= 0x7f || c == '%' || strings.IndexByte("\"<>\\^`{|}", c) >= 0:
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

func isHex(c byte) bool {
	return ('0' <= c && c <= '9') || ('a' <= c && c <= 'f') || ('A' <= c && c <= 'F')
}

func buildBody(b model.Body, vars *Resolver) ([]byte, string, error) {
	switch b.Mode {
	case "", model.BodyNone:
		return nil, "", nil
	case model.BodyJSON:
		return []byte(vars.Resolve(b.Raw)), "application/json", nil
	case model.BodyRaw:
		ct := b.ContentType
		if ct == "" {
			ct = "text/plain"
		}
		return []byte(vars.Resolve(b.Raw)), ct, nil
	case model.BodyURLEncoded:
		var parts []string
		for _, kv := range b.URLEncoded {
			if !kv.Enabled || kv.Key == "" {
				continue
			}
			parts = append(parts, url.QueryEscape(vars.Resolve(kv.Key))+"="+url.QueryEscape(vars.Resolve(kv.Value)))
		}
		return []byte(strings.Join(parts, "&")), "application/x-www-form-urlencoded", nil
	case model.BodyFormData:
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		for _, f := range b.FormData {
			if !f.Enabled || f.Key == "" {
				continue
			}
			key := vars.Resolve(f.Key)
			if f.Type != model.FieldFile {
				if err := w.WriteField(key, vars.Resolve(f.Value)); err != nil {
					return nil, "", err
				}
				continue
			}
			content, err := base64.StdEncoding.DecodeString(f.FileContent)
			if err != nil {
				return nil, "", fmt.Errorf("form field %q: invalid file content: %w", key, err)
			}
			h := textproto.MIMEHeader{}
			h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`,
				quoteEscaper.Replace(key), quoteEscaper.Replace(f.FileName)))
			ct := f.ContentType
			if ct == "" {
				ct = "application/octet-stream"
			}
			h.Set("Content-Type", ct)
			part, err := w.CreatePart(h)
			if err != nil {
				return nil, "", err
			}
			if _, err := part.Write(content); err != nil {
				return nil, "", err
			}
		}
		if err := w.Close(); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), w.FormDataContentType(), nil
	default:
		return nil, "", fmt.Errorf("unknown body mode %q", b.Mode)
	}
}

var quoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"")

func applyAuth(a model.Auth, vars *Resolver, h http.Header, u *url.URL) {
	switch a.Type {
	case model.AuthBearer:
		if token := vars.Resolve(a.Token); token != "" && !hasHeader(h, "Authorization") {
			h.Set("Authorization", "Bearer "+token)
		}
	case model.AuthBasic:
		if !hasHeader(h, "Authorization") {
			cred := vars.Resolve(a.Username) + ":" + vars.Resolve(a.Password)
			h.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(cred)))
		}
	case model.AuthAPIKey:
		key := vars.Resolve(a.Key)
		if key == "" {
			return
		}
		value := vars.Resolve(a.Value)
		if a.In == "query" {
			pair := url.QueryEscape(key) + "=" + url.QueryEscape(value)
			if u.RawQuery == "" {
				u.RawQuery = pair
			} else {
				u.RawQuery += "&" + pair
			}
		} else if !hasHeader(h, key) {
			h[key] = []string{value}
		}
	}
}

func hasHeader(h http.Header, name string) bool {
	for k := range h {
		if strings.EqualFold(k, name) {
			return true
		}
	}
	return false
}

func deleteHeader(h http.Header, name string) {
	for k := range h {
		if strings.EqualFold(k, name) {
			delete(h, k)
		}
	}
}

func setDefault(h http.Header, name, value string) {
	if !hasHeader(h, name) {
		h.Set(name, value)
	}
}

func newClient(opts Options) *http.Client {
	tr := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: 15 * time.Second,
		// We decode bodies ourselves so the original Content-Encoding and
		// Content-Length headers stay visible to the user.
		DisableCompression: true,
		// Skipping verification is an explicit user setting for self-signed dev servers.
		TLSClientConfig: &tls.Config{InsecureSkipVerify: !opts.VerifyTLS}, //nolint:gosec
	}
	return &http.Client{
		Transport: tr,
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if !opts.FollowRedirects {
				return http.ErrUseLastResponse
			}
			if len(via) >= 10 {
				return errors.New("stopped after 10 redirects")
			}
			return nil
		},
	}
}

// timer records httptrace events. Callbacks can fire from other goroutines
// (e.g. parallel dials), hence the mutex.
type timer struct {
	mu                               sync.Mutex
	start, dnsStart, dnsDone         time.Time
	connStart, connDone              time.Time
	tlsStart, tlsDone                time.Time
	gotConn, wroteRequest, firstByte time.Time
}

func (t *timer) set(field *time.Time, onlyFirst bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if onlyFirst && !field.IsZero() {
		return
	}
	*field = time.Now()
}

func (t *timer) trace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		DNSStart:             func(httptrace.DNSStartInfo) { t.set(&t.dnsStart, true) },
		DNSDone:              func(httptrace.DNSDoneInfo) { t.set(&t.dnsDone, false) },
		ConnectStart:         func(string, string) { t.set(&t.connStart, true) },
		ConnectDone:          func(string, string, error) { t.set(&t.connDone, false) },
		TLSHandshakeStart:    func() { t.set(&t.tlsStart, false) },
		TLSHandshakeDone:     func(tls.ConnectionState, error) { t.set(&t.tlsDone, false) },
		GotConn:              func(httptrace.GotConnInfo) { t.set(&t.gotConn, false) },
		WroteRequest:         func(httptrace.WroteRequestInfo) { t.set(&t.wroteRequest, false) },
		GotFirstResponseByte: func() { t.set(&t.firstByte, false) },
	}
}

func (t *timer) timings(end time.Time) Timings {
	t.mu.Lock()
	defer t.mu.Unlock()
	ms := func(a, b time.Time) float64 {
		if a.IsZero() || b.IsZero() || b.Before(a) {
			return 0
		}
		return float64(b.Sub(a).Microseconds()) / 1000
	}
	return Timings{
		DNS:      ms(t.dnsStart, t.dnsDone),
		Connect:  ms(t.connStart, t.connDone),
		TLS:      ms(t.tlsStart, t.tlsDone),
		Send:     ms(t.gotConn, t.wroteRequest),
		Waiting:  ms(t.wroteRequest, t.firstByte),
		Download: ms(t.firstByte, end),
		Total:    ms(t.start, end),
	}
}

func describeError(ctx context.Context, err error, timeout time.Duration) string {
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return fmt.Sprintf("request timed out after %s", timeout)
	case errors.Is(ctx.Err(), context.Canceled):
		return "request cancelled"
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err.Error()
	}
	return err.Error()
}

func readLimited(r io.Reader, max int64) ([]byte, bool, error) {
	if max <= 0 {
		b, err := io.ReadAll(r)
		return b, false, err
	}
	b, err := io.ReadAll(io.LimitReader(r, max+1))
	if int64(len(b)) > max {
		return b[:max], true, err
	}
	return b, false, err
}

func decode(raw []byte, encoding string, max int64) ([]byte, error) {
	var r io.Reader
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "gzip", "x-gzip":
		zr, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		r = zr
	case "deflate":
		// "deflate" is zlib-wrapped per the RFC, but some servers send raw DEFLATE.
		if zr, err := zlib.NewReader(bytes.NewReader(raw)); err == nil {
			r = zr
		} else {
			r = flate.NewReader(bytes.NewReader(raw))
		}
	default:
		return nil, fmt.Errorf("unsupported content encoding %q", encoding)
	}
	b, truncated, err := readLimited(r, max)
	if err != nil {
		return nil, err
	}
	if truncated {
		return nil, errors.New("decoded body exceeds limit")
	}
	return b, nil
}

func statusText(resp *http.Response) string {
	if text := strings.TrimPrefix(resp.Status, strconv.Itoa(resp.StatusCode)+" "); text != resp.Status && text != "" {
		return text
	}
	return http.StatusText(resp.StatusCode)
}

func flattenHeaders(h http.Header) []Header {
	names := make([]string, 0, len(h))
	for k := range h {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	out := []Header{}
	for _, k := range names {
		for _, v := range h[k] {
			out = append(out, Header{Name: k, Value: v})
		}
	}
	return out
}

func convertCookies(cs []*http.Cookie) []Cookie {
	out := make([]Cookie, 0, len(cs))
	for _, c := range cs {
		ck := Cookie{
			Name: c.Name, Value: c.Value, Domain: c.Domain, Path: c.Path,
			MaxAge: c.MaxAge, HTTPOnly: c.HttpOnly, Secure: c.Secure,
		}
		if !c.Expires.IsZero() {
			ck.Expires = c.Expires.UTC().Format(time.RFC1123)
		}
		switch c.SameSite {
		case http.SameSiteLaxMode:
			ck.SameSite = "Lax"
		case http.SameSiteStrictMode:
			ck.SameSite = "Strict"
		case http.SameSiteNoneMode:
			ck.SameSite = "None"
		}
		out = append(out, ck)
	}
	return out
}
