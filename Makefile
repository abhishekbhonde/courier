.PHONY: build frontend backend dev dev-backend dev-frontend test lint clean

BIN := bin/courier

## build: build the UI and a single self-contained binary at bin/courier
build: frontend backend

frontend:
	cd frontend && npm ci && npm run build

backend:
	cd backend && go build -trimpath -ldflags="-s -w" -o ../$(BIN) ./cmd/courier

## dev: run the Go API (:7777) and the Vite dev server (:5173) together
dev:
	@trap 'kill 0' INT TERM; \
	$(MAKE) dev-backend & \
	$(MAKE) dev-frontend & \
	wait

dev-backend:
	cd backend && go run ./cmd/courier -db ../.dev/courier.db

dev-frontend:
	cd frontend && npm run dev

## test: run Go and frontend tests
test:
	cd backend && go vet ./... && go test ./...
	cd frontend && npm run typecheck && npm test

clean:
	rm -rf bin .dev frontend/node_modules
	find backend/internal/web/dist -mindepth 1 ! -name .gitkeep -delete
