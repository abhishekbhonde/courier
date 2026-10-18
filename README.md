# Courier

A local HTTP API client in the spirit of Postman, built with Go and React.

Requests are sent by the Go backend rather than the browser, so there are no
CORS restrictions, you get a real timing breakdown (DNS / TCP / TLS / TTFB /
download), and the original response headers are shown untouched. Everything
ships as a single binary with the UI embedded; data lives in a local SQLite file.

## Features

- **Requests**: any method, query params synced with the URL, headers, and bodies
  (JSON, raw text/XML/HTML, `x-www-form-urlencoded`, multipart `form-data` with file uploads)
- **Auth**: Bearer, Basic, API key (header or query), or inherit from the collection
- **Variables**: `{{name}}` anywhere. Collection variables are overridden by the active
  environment. Dynamic values include `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`
  and `{{$randomInt}}`. Variables are highlighted green or red as you type, and
  unresolved ones are flagged after sending.
- **Responses**: pretty/raw/preview (HTML in a sandboxed iframe, images), headers,
  cookies, timing waterfall, and the exact request that was sent. Gzip and deflate
  are decoded, large bodies are truncated safely, and bodies can be copied or downloaded.
- **Organization**: collections with nested folders, drag-and-drop, rename, duplicate,
  multiple tabs with unsaved-change tracking (restored on reload), and history
- **Import/export**: paste a cURL command into the URL bar; import Postman v2.0/v2.1
  collections and Postman environments; export collections as Postman v2.1
- **Code generation**: cURL, JavaScript `fetch`, Python `requests`, Go `net/http`
- **Settings**: timeout, redirects, TLS verification, response size limit, history size
- Dark and light themes, plus keyboard shortcuts: `⌘/Ctrl+Enter` to send, `⌘/Ctrl+S` to save

## Quick start

Requires Go 1.25+ and Node 20+.

```sh
make build          # builds the UI, then bin/courier with the UI embedded
./bin/courier -open # http://localhost:7777
```

Flags:

| Flag           | Default                                 | Purpose                                     |
| -------------- | --------------------------------------- | ------------------------------------------- |
| `-addr`        | `127.0.0.1:7777`                        | Listen address                              |
| `-db`          | `<user config dir>/courier/courier.db`  | SQLite database path                        |
| `-allow-hosts` |                                         | Extra hostnames accepted in the Host header |
| `-open`        | `false`                                 | Open the UI in a browser                    |

## Development

```sh
make dev   # Go API on :7777 + Vite dev server with hot reload on :5173
make test  # go vet, Go tests, TypeScript typecheck, Vitest
```

Open http://localhost:5173 during development. Vite proxies `/api` to the Go server.

## Layout

```
backend/
  cmd/courier/         entry point: flags, server, graceful shutdown
  internal/model/      domain types shared across packages
  internal/store/      SQLite persistence with versioned migrations
  internal/runner/     builds and sends requests: variables, auth, bodies, timing, decoding
  internal/importer/   cURL parser, Postman import/export
  internal/api/        REST API, security middleware
  internal/web/        embedded UI with SPA fallback
frontend/
  src/lib/             pure logic: URL/param sync, variables, codegen (unit tested)
  src/store/           zustand stores: workspace data, tabs, UI dialogs
  src/components/      React UI
```

## Security

Courier runs a local server that can send requests anywhere, so the API refuses
anything that could come from another website:

- It listens on `127.0.0.1` by default.
- It rejects `Host` headers that aren't loopback names, which blocks DNS rebinding.
- It rejects cross-origin `Origin` headers.
- It requires `Content-Type: application/json` on writes, so cross-site form posts
  (which browsers send without a CORS preflight) fail.

If you expose it on a network address, pass `-allow-hosts` and keep in mind that
anyone who can reach it can use it as a proxy.

## API

| Method | Path                                    | Description                             |
| ------ | --------------------------------------- | --------------------------------------- |
| POST   | `/api/execute`                          | Send a request (`{request, environmentId, collectionId}`) |
| GET    | `/api/collections`                      | All collections with folders and requests |
| POST/PUT/DELETE | `/api/collections[/{id}]`      | Manage collections                      |
| GET    | `/api/collections/{id}/export`          | Postman v2.1 export                     |
| POST/PUT/DELETE | `/api/folders[/{id}]`          | Manage folders                          |
| POST/PUT/DELETE | `/api/requests[/{id}]`         | Manage saved requests                   |
| POST   | `/api/requests/{id}/duplicate`          | Duplicate a request                     |
| GET/POST/PUT/DELETE | `/api/environments[/{id}]` | Manage environments                     |
| GET/DELETE | `/api/history[/{id}]`               | List, delete, or clear history          |
| GET/PUT | `/api/settings`                        | App settings                            |
| POST   | `/api/import/curl`                      | Parse a cURL command into a request     |
| POST   | `/api/import/postman`                   | Import a Postman collection or environment |
