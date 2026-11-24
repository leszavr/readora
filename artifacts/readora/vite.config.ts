import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { readFile } from "node:fs/promises";

const rawPort = process.env.PORT ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const spaRoutes = [
  /^\/login$/,
  /^\/register$/,
  /^\/verify\/[^/]+$/,
  /^\/forgot-password$/,
  /^\/reset-password\/[^/]+$/,
  /^\/confirm-password-change\/[^/]+$/,
  /^\/library$/,
  /^\/book\/\d+$/,
  /^\/reader\/\d+$/,
  /^\/profile$/,
  /^\/admin$/,
];

function landingSsrPlugin(): Plugin {
  return {
    name: "readora-landing-ssr",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const pathname = new URL(req.url, "http://localhost").pathname;
        if (pathname !== "/" && pathname !== "/about" && pathname !== "/changelog" && pathname !== "/terms" && pathname !== "/privacy" && !spaRoutes.some((route) => route.test(pathname))) {
          next();
          return;
        }

        try {
          const template = await readFile(path.resolve(import.meta.dirname, "index.html"), "utf8");
          const transformedTemplate = await server.transformIndexHtml(pathname, template);
          const { renderAboutDocument, renderChangelogDocument, renderHomeDocument, renderLegalDocument, renderPrivateSpaDocument } = await server.ssrLoadModule("/src/entry-server.tsx");
          const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          if (pathname === "/about") {
            res.end(renderAboutDocument({ template: transformedTemplate, publicBaseUrl }));
            return;
          }

          if (pathname === "/changelog") {
            const items = await fetch(`${process.env.API_PROXY_TARGET ?? "http://localhost:5000"}/api/announcements/changelog`)
              .then(async (response) => response.ok ? response.json() : { items: [] })
              .catch(() => ({ items: [] }));
            res.end(renderChangelogDocument({ template: transformedTemplate, publicBaseUrl, items: items.items ?? [] }));
            return;
          }

          if (pathname === "/terms" || pathname === "/privacy") {
            res.end(renderLegalDocument({
              template: transformedTemplate,
              publicBaseUrl,
              kind: pathname === "/terms" ? "terms" : "privacy",
            }));
            return;
          }

          if (spaRoutes.some((route) => route.test(pathname))) {
            res.end(renderPrivateSpaDocument({ template: transformedTemplate, publicBaseUrl }));
            return;
          }

          const popularBooks = await fetch(`${process.env.API_PROXY_TARGET ?? "http://localhost:5000"}/api/public/popular-books?limit=6`)
            .then(async (response) => response.ok ? response.json() : [])
            .catch(() => []);
          const maintenanceStatus = await fetch(`${process.env.API_PROXY_TARGET ?? "http://localhost:5000"}/api/public/maintenance-status`)
            .then(async (response) => response.ok ? response.json() : { enabled: false, reason: null, eta: null, message: null })
            .catch(() => ({ enabled: false, reason: null, eta: null, message: null }));
          const registrationStatus = await fetch(`${process.env.API_PROXY_TARGET ?? "http://localhost:5000"}/api/public/registration-status`)
            .then(async (response) => response.ok ? response.json() : { enabled: true })
            .catch(() => ({ enabled: true }));
          res.end(renderHomeDocument({ template: transformedTemplate, publicBaseUrl, popularBooks, maintenanceStatus, registrationStatus }));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ command, isSsrBuild }) => ({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    landingSsrPlugin(),
    // Офлайн app shell (ADR-0002): только client-проход билда; SSR-проход
    // лендинга SW не генерирует. Регистрация — в main.tsx (injectRegister: false).
    ...(isSsrBuild ? [] : [VitePWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/$/, /^\/about$/, /^\/changelog$/, /^\/terms$/, /^\/privacy$/],
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      },
    })]),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  ssr: {
    noExternal: command === "build" ? true : ["@workspace/api-client-react"],
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:5000",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
}));
