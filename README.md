# Courier

A Postman-style API client built with Go and React. Live at [courier.abhishekk.xyz](https://courier.abhishekk.xyz).

Requests are sent from the Go backend, so there are no CORS issues, and you get real timing (DNS, TCP, TLS, TTFB).

## Features

- Any method, headers, params, and JSON, form or multipart bodies
- Bearer, Basic and API key auth
- Collections, folders, environments and `{{variables}}`
- History, tabs, and dark and light themes
- Import from cURL and Postman; export to Postman
- Code snippets for cURL, fetch, Python and Go

## Run locally

Requires Go 1.26+ and Node 20+.

```sh
make build && ./bin/courier -open   # http://localhost:7777
make dev                            # dev mode with hot reload on :5173
make test                           # run all tests
```

## Deploy

- **Backend (Render):** uses `render.yaml` and `backend/Dockerfile`. Set these environment variables:
  - `COURIER_TOKEN`: the access token
  - `COURIER_ALLOW_HOSTS`: your Render hostname
  - `COURIER_ALLOW_ORIGINS`: your frontend URL(s)
- **Frontend (Vercel):** root directory `frontend`. `vercel.json` forwards `/api` to Render.

When hosted, the UI asks for the access token once and remembers it.
