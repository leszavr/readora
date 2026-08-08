import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import pgSession from "connect-pg-simple";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { emailService } from "./lib/email-service";
import { getPopularBooks } from "./lib/popular-books-service";
import { getPublicBaseUrl } from "./lib/public-url";
import seoRouter from "./routes/seo";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

const app: Express = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && !sessionSecret) {
  throw new Error("SESSION_SECRET is required in production");
}

const PgSessionStore = pgSession(session);
const runtimeRoot = resolve(import.meta.dirname, "..");
const clientDist = resolve(runtimeRoot, "client");
const clientServerDist = resolve(runtimeRoot, "client-server");
const hasClientDist = isProduction && existsSync(clientDist) && existsSync(clientServerDist);
type HomeRenderer = {
  renderHomeDocument(input: {
    template: string;
    publicBaseUrl: string;
    popularBooks: Awaited<ReturnType<typeof getPopularBooks>>;
  }): string;
  renderAboutDocument(input: {
    template: string;
    publicBaseUrl: string;
  }): string;
  renderPrivateSpaDocument(input: {
    template: string;
    publicBaseUrl: string;
  }): string;
};
const homeRenderer: HomeRenderer | null = hasClientDist
  ? await import(pathToFileURL(resolve(clientServerDist, "entry-server.js")).href) as HomeRenderer
  : null;
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

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));
app.use(cors({
  origin(origin, callback) {
    const allowedOrigin = process.env.APP_ORIGIN;
    if (!isProduction || !allowedOrigin || !origin || origin === allowedOrigin) {
      callback(null, true);
      return;
    }

    callback(new Error("CORS origin is not allowed"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(seoRouter);

app.use(
  session({
    store: new PgSessionStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
      // Автоматическая очистка просроченных сессий каждые 15 минут
      pruneSessionInterval: 15 * 60,
    }),
    secret: sessionSecret ?? "readora-secret-dev",
    resave: false,
    saveUninitialized: false,
    rolling: true, // Продлевать сессию при каждой активности
    name: "readora.sid",
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней (увеличено с 7)
    },
  }),
);

// Initialize email service
await emailService.initialize().catch((error) => {
  logger.error({ error }, "Failed to initialize email service");
});

// Автоматическое восстановление сессии из remember token (ПЕРЕД роутами)
const { autoRestoreSession } = await import("./middlewares/auto-restore-session");
app.use("/api", autoRestoreSession);

app.use("/api", router);

if (hasClientDist && homeRenderer) {
  const indexHtml = readFileSync(resolve(clientDist, "index.html"), "utf8");
  const privateSpaTemplate = indexHtml.replace("<meta name=\"robots\" content=\"index, follow\" />", "<meta name=\"robots\" content=\"noindex, nofollow\" />");
  const privateSpaHtml = homeRenderer.renderPrivateSpaDocument({
    template: privateSpaTemplate,
    publicBaseUrl: getPublicBaseUrl(),
  });
  app.get("/", async (_req, res, next) => {
    try {
      res.type("html").send(homeRenderer.renderHomeDocument({
        template: indexHtml,
        publicBaseUrl: getPublicBaseUrl(),
        popularBooks: await getPopularBooks(6),
      }));
    } catch (error) {
      next(error);
    }
  });
  app.get("/about", (_req, res, next) => {
    try {
      res.type("html").send(homeRenderer.renderAboutDocument({
        template: indexHtml,
        publicBaseUrl: getPublicBaseUrl(),
      }));
    } catch (error) {
      next(error);
    }
  });
  app.use(express.static(clientDist));
  app.use((req, res) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      res.status(404).end();
      return;
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.status(spaRoutes.some((route) => route.test(req.path)) ? 200 : 404).type("html").send(privateSpaHtml);
  });
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : "Ошибка сервера";
  if (message.includes("File too large")) {
    res.status(413).json({ error: "Файл слишком большой" });
    return;
  }
  if (message.includes("Поддерживаются только")) {
    res.status(400).json({ error: message });
    return;
  }
  logger.error({ err }, "Unhandled API error");
  res.status(500).json({ error: "Ошибка сервера" });
};

app.use(errorHandler);

export default app;
