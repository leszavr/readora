import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import pgSession from "connect-pg-simple";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { emailService } from "./lib/email-service";

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
const clientDist = resolve("client");
const hasClientDist = isProduction && existsSync(clientDist);

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
app.use(helmet());
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

if (hasClientDist) {
  app.use(express.static(clientDist));
}

app.use(
  session({
    store: new PgSessionStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: sessionSecret ?? "readora-secret-dev",
    resave: false,
    saveUninitialized: false,
    name: "readora.sid",
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

// Initialize email service
await emailService.initialize().catch((error) => {
  logger.error({ error }, "Failed to initialize email service");
});

app.use("/api", router);

if (hasClientDist) {
  app.get("*", (_req, res) => {
    res.sendFile(resolve(clientDist, "index.html"));
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
