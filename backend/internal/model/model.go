// Package model defines the domain types shared by the store, runner and API.
package model

import "time"

// KV is a generic key/value row used for params, headers and url-encoded bodies.
type KV struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description,omitempty"`
}

// Variable is an environment or collection variable.
type Variable struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
	Secret  bool   `json:"secret,omitempty"`
}

// Form field types for multipart bodies.
const (
	FieldText = "text"
	FieldFile = "file"
)

// FormField is a multipart/form-data entry. File contents travel base64-encoded.
type FormField struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Enabled     bool   `json:"enabled"`
	Type        string `json:"type"`
	FileName    string `json:"fileName,omitempty"`
	FileContent string `json:"fileContent,omitempty"`
	ContentType string `json:"contentType,omitempty"`
}

// Body modes.
const (
	BodyNone       = "none"
	BodyJSON       = "json"
	BodyRaw        = "raw"
	BodyURLEncoded = "urlencoded"
	BodyFormData   = "formdata"
)

// Body describes a request body. Only the fields relevant to Mode are used.
type Body struct {
	Mode        string      `json:"mode"`
	Raw         string      `json:"raw,omitempty"`
	ContentType string      `json:"contentType,omitempty"`
	URLEncoded  []KV        `json:"urlencoded,omitempty"`
	FormData    []FormField `json:"formdata,omitempty"`
}

// Auth types.
const (
	AuthNone    = "none"
	AuthInherit = "inherit"
	AuthBearer  = "bearer"
	AuthBasic   = "basic"
	AuthAPIKey  = "apikey"
)

// Auth describes request authentication. Only the fields relevant to Type are used.
type Auth struct {
	Type     string `json:"type"`
	Token    string `json:"token,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Key      string `json:"key,omitempty"`
	Value    string `json:"value,omitempty"`
	In       string `json:"in,omitempty"` // "header" or "query"
}

// RequestSpec is everything needed to send a request.
//
// URL is authoritative when sending, including its query string. Params mirrors
// that query string for editing and also keeps disabled entries around.
type RequestSpec struct {
	Method  string `json:"method"`
	URL     string `json:"url"`
	Params  []KV   `json:"params"`
	Headers []KV   `json:"headers"`
	Body    Body   `json:"body"`
	Auth    Auth   `json:"auth"`
}

// Normalize fills zero values with sensible defaults so clients always see
// well-formed specs.
func (s *RequestSpec) Normalize() {
	if s.Method == "" {
		s.Method = "GET"
	}
	if s.Params == nil {
		s.Params = []KV{}
	}
	if s.Headers == nil {
		s.Headers = []KV{}
	}
	if s.Body.Mode == "" {
		s.Body.Mode = BodyNone
	}
	if s.Auth.Type == "" {
		s.Auth.Type = AuthNone
	}
}

type Collection struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Variables   []Variable `json:"variables"`
	Auth        Auth       `json:"auth"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type Folder struct {
	ID           string    `json:"id"`
	CollectionID string    `json:"collectionId"`
	ParentID     *string   `json:"parentId"`
	Name         string    `json:"name"`
	Sort         int       `json:"sort"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// Request is a saved request inside a collection.
type Request struct {
	ID           string  `json:"id"`
	CollectionID string  `json:"collectionId"`
	FolderID     *string `json:"folderId"`
	Name         string  `json:"name"`
	Sort         int     `json:"sort"`
	RequestSpec
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CollectionTree is a collection with all of its folders and requests.
type CollectionTree struct {
	Collection
	Folders  []Folder  `json:"folders"`
	Requests []Request `json:"requests"`
}

type Environment struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Variables []Variable `json:"variables"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type HistoryEntry struct {
	ID         string      `json:"id"`
	Request    RequestSpec `json:"request"`
	Status     int         `json:"status"`
	DurationMs int64       `json:"durationMs"`
	Size       int64       `json:"size"`
	Error      string      `json:"error,omitempty"`
	CreatedAt  time.Time   `json:"createdAt"`
}

type Settings struct {
	TimeoutMs        int   `json:"timeoutMs"`
	FollowRedirects  bool  `json:"followRedirects"`
	VerifyTLS        bool  `json:"verifyTls"`
	MaxResponseBytes int64 `json:"maxResponseBytes"`
	HistoryLimit     int   `json:"historyLimit"`
}

func DefaultSettings() Settings {
	return Settings{
		TimeoutMs:        30_000,
		FollowRedirects:  true,
		VerifyTLS:        true,
		MaxResponseBytes: 50 << 20,
		HistoryLimit:     500,
	}
}
