import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const apiProxy = process.env.API_PROXY ?? "http://localhost:3001";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Huella Rosa",
        short_name: "Huella Rosa",
        description: "Registro de pacientes de EIRA con o sin internet.",
        lang: "es-MX",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        theme_color: "#b7426c",
        background_color: "#ffffff",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // The whole app shell is cached so it opens without internet.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: true, type: "module" },
    }),
  ],
  server: {
    port: 5173,
    // API_PROXY lets a second checkout run its server on another port.
    proxy: { "/api": apiProxy },
  },
  // `npm run demo`: the production build (with its service worker) behind the same /api proxy.
  preview: {
    port: Number(process.env.PREVIEW_PORT ?? 4173),
    strictPort: true,
    proxy: { "/api": apiProxy },
  },
});
