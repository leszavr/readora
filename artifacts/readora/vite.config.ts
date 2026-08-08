import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFile } from "node:fs/promises";

const rawPort = process.env.PORT ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

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
        if (pathname !== "/" && pathname !== "/about") {
          next();
          return;
        }

        try {
          const template = await readFile(path.resolve(import.meta.dirname, "index.html"), "utf8");
          const transformedTemplate = await server.transformIndexHtml(pathname, template);
          const { renderAboutDocument, renderHomeDocument } = await server.ssrLoadModule("/src/entry-server.tsx");
          const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          if (pathname === "/about") {
            res.end(renderAboutDocument({ template: transformedTemplate, publicBaseUrl }));
            return;
          }

          const popularBooks = await fetch(`${process.env.API_PROXY_TARGET ?? "http://localhost:5000"}/api/public/popular-books?limit=6`)
            .then(async (response) => response.ok ? response.json() : [])
            .catch(() => []);
          res.end(renderHomeDocument({ template: transformedTemplate, publicBaseUrl, popularBooks }));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    landingSsrPlugin(),
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
