import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The Go binary embeds the built UI.
    outDir: "../backend/internal/web/dist",
    emptyOutDir: true,
    // It's a local app; one bundle (mostly CodeMirror) is fine.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      // Keep the original Host header (no changeOrigin): the backend rejects
      // requests whose Origin and Host disagree.
      "/api": { target: "http://127.0.0.1:7777" },
    },
  },
});
