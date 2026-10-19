// Package api exposes Courier's REST API and serves the web UI.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
	"time"

	"github.com/abhishekbhonde/courier/internal/store"
)

// maxRequestBody bounds API payloads; multipart file uploads travel inline as base64.
const maxRequestBody = 64 << 20

type Config struct {
	// AllowedHosts are extra hostnames accepted in the Host header besides
	// loopback names. This protects against DNS-rebinding attacks.
	AllowedHosts []string
	// AllowedOrigins are extra browser origins (e.g. "https://courier.vercel.app")
	// accepted besides the server's own, for a UI hosted elsewhere that proxies /api.
	AllowedOrigins []string
	// Token, when set, must be sent as "Authorization: Bearer <token>" on every
	// API call except the health check. Required on any public deployment.
	Token string
}

type Server struct {
	store *store.Store
	log   *slog.Logger
	cfg   Config
}

// New returns the full HTTP handler: the API under /api/ and static (the web
// UI) for everything else.
func New(st *store.Store, log *slog.Logger, cfg Config, static http.Handler) http.Handler {
	s := &Server{store: st, log: log, cfg: cfg}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/collections", s.listCollections)
	mux.HandleFunc("POST /api/collections", s.createCollection)
	mux.HandleFunc("GET /api/collections/{id}", s.getCollection)
	mux.HandleFunc("PUT /api/collections/{id}", s.updateCollection)
	mux.HandleFunc("DELETE /api/collections/{id}", s.deleteCollection)
	mux.HandleFunc("GET /api/collections/{id}/export", s.exportCollection)

	mux.HandleFunc("POST /api/folders", s.createFolder)
	mux.HandleFunc("PUT /api/folders/{id}", s.updateFolder)
	mux.HandleFunc("DELETE /api/folders/{id}", s.deleteFolder)

	mux.HandleFunc("POST /api/requests", s.createRequest)
	mux.HandleFunc("GET /api/requests/{id}", s.getRequest)
	mux.HandleFunc("PUT /api/requests/{id}", s.updateRequest)
	mux.HandleFunc("DELETE /api/requests/{id}", s.deleteRequest)
	mux.HandleFunc("POST /api/requests/{id}/duplicate", s.duplicateRequest)

	mux.HandleFunc("GET /api/environments", s.listEnvironments)
	mux.HandleFunc("POST /api/environments", s.createEnvironment)
	mux.HandleFunc("PUT /api/environments/{id}", s.updateEnvironment)
	mux.HandleFunc("DELETE /api/environments/{id}", s.deleteEnvironment)

	mux.HandleFunc("GET /api/history", s.listHistory)
	mux.HandleFunc("DELETE /api/history", s.clearHistory)
	mux.HandleFunc("DELETE /api/history/{id}", s.deleteHistory)

	mux.HandleFunc("GET /api/settings", s.getSettings)
	mux.HandleFunc("PUT /api/settings", s.saveSettings)

	mux.HandleFunc("POST /api/execute", s.execute)
	mux.HandleFunc("POST /api/import/curl", s.importCurl)
	mux.HandleFunc("POST /api/import/postman", s.importPostman)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "no such endpoint")
	})
	if static != nil {
		mux.Handle("/", static)
	}

	return s.recoverer(s.logger(s.guard(mux)))
}

// guard rejects requests that could come from another website: foreign Host
// headers (DNS rebinding), cross-origin Origins, and non-JSON bodies (which
// browsers can send cross-site without a CORS preflight). With a Token set it
// also rejects unauthenticated API calls.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Platform health checks arrive with arbitrary Host headers.
		if r.Method == http.MethodGet && r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		if !s.hostAllowed(r.Host) {
			writeError(w, http.StatusForbidden, "host not allowed: "+r.Host)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || (u.Host != r.Host && !s.originAllowed(origin)) {
				writeError(w, http.StatusForbidden, "cross-origin requests are not allowed")
				return
			}
		}
		if s.cfg.Token != "" && strings.HasPrefix(r.URL.Path, "/api/") && !s.tokenValid(r) {
			writeError(w, http.StatusUnauthorized, "missing or invalid access token")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && (r.Method == http.MethodPost || r.Method == http.MethodPut || r.ContentLength > 0) {
			mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if mt != "application/json" {
				writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) hostAllowed(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	for _, h := range s.cfg.AllowedHosts {
		if strings.EqualFold(h, host) || h == "*" {
			return true
		}
	}
	return false
}

func (s *Server) originAllowed(origin string) bool {
	origin = strings.TrimSuffix(origin, "/")
	for _, o := range s.cfg.AllowedOrigins {
		if strings.EqualFold(strings.TrimSuffix(o, "/"), origin) {
			return true
		}
	}
	return false
}

func (s *Server) tokenValid(r *http.Request) bool {
	got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return ok && subtle.ConstantTimeCompare([]byte(got), []byte(s.cfg.Token)) == 1
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		s.log.Info("api", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"duration", time.Since(start).Round(time.Microsecond))
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.log.Error("panic", "err", v, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeStoreError maps store errors onto HTTP statuses.
func (s *Server) writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		s.log.Error("store", "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		} else {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		}
		return false
	}
	return true
}
