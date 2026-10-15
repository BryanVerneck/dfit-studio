import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// In development the browser talks only to this dev server, which forwards API calls to the backend.
// Keeping the same origin means the login cookie (scoped to /auth) works exactly as it will in production.
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const apiPaths = ["/auth", "/me", "/sessions", "/bookings", "/staff", "/health"];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Dfit Studio",
        short_name: "Dfit",
        description: "Find and book your classes at Dfit Studio",
        theme_color: "#111827",
        background_color: "#111827",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // API calls are never served from the cache, so spots left and bookings are always current.
        navigateFallbackDenylist: apiPaths.map((p) => new RegExp(`^${p}`)),
      },
    }),
  ],
  server: {
    proxy: Object.fromEntries(apiPaths.map((p) => [p, { target: API_URL, changeOrigin: true }])),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
