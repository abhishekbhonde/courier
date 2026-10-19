// Command courier runs the Courier API client: a local server that sends HTTP
// requests on behalf of the web UI and stores collections in SQLite.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/abhishekbhonde/courier/internal/api"
	"github.com/abhishekbhonde/courier/internal/store"
	"github.com/abhishekbhonde/courier/internal/web"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "courier:", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		addr       = flag.String("addr", "127.0.0.1:7777", "listen address")
		dbPath     = flag.String("db", "", "SQLite database path (default: <user config dir>/courier/courier.db)")
		allowHosts = flag.String("allow-hosts", "", "comma-separated extra hostnames accepted in the Host header")
		allowOrigs = flag.String("allow-origins", "", "comma-separated extra browser origins (e.g. https://courier.vercel.app) allowed to call the API")
		open       = flag.Bool("open", false, "open the UI in a browser after starting")
	)
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if *dbPath == "" {
		dir, err := os.UserConfigDir()
		if err != nil {
			return fmt.Errorf("locating config dir: %w (pass -db)", err)
		}
		*dbPath = filepath.Join(dir, "courier", "courier.db")
	}
	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		return err
	}
	st, err := store.Open(*dbPath)
	if err != nil {
		return fmt.Errorf("opening database: %w", err)
	}
	defer st.Close()

	cfg := api.Config{
		AllowedHosts:   splitList(*allowHosts),
		AllowedOrigins: splitList(*allowOrigs),
		// Read from the environment, not a flag, so it doesn't show up in ps.
		Token: os.Getenv("COURIER_TOKEN"),
	}
	if cfg.Token == "" && (len(cfg.AllowedHosts) > 0 || len(cfg.AllowedOrigins) > 0) {
		log.Warn("COURIER_TOKEN is not set: anyone who can reach this server can use it")
	}

	srv := &http.Server{
		Handler:           api.New(st, log, cfg, web.Handler()),
		ReadHeaderTimeout: 10 * time.Second,
	}
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	url := "http://" + displayAddr(ln.Addr().String())
	log.Info("courier listening", "url", url, "db", *dbPath)
	if *open {
		openBrowser(url)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
	}
	return nil
}

func splitList(s string) []string {
	var out []string
	for _, v := range strings.Split(s, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// displayAddr turns wildcard listen addresses into something clickable.
func displayAddr(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	if ip := net.ParseIP(host); ip == nil || ip.IsUnspecified() || ip.IsLoopback() {
		host = "localhost"
	}
	return net.JoinHostPort(host, port)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
