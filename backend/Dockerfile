# API-only image for hosting (the UI is served separately, e.g. from Vercel).
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /courier ./cmd/courier

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /courier /usr/local/bin/courier
# PORT is set by the host (Render uses 10000). The DB lives on a mounted disk.
CMD courier -addr "0.0.0.0:${PORT:-10000}" -db "${COURIER_DB:-/data/courier.db}" \
    -allow-hosts "$COURIER_ALLOW_HOSTS" -allow-origins "$COURIER_ALLOW_ORIGINS"
