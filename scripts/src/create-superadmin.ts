import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";

const PLACEHOLDERS = {
  email: "admin@example.com",
  username: "AdminUser",
  password: "ChangeMe123!",
} as const;

type AdminInput = {
  email: string;
  username: string;
  password: string;
};

function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizeUsername(value: string): string {
  return value.trim();
}

function readInputFromEnv(): AdminInput {
  const emailRaw = process.env.ADMIN_EMAIL ?? PLACEHOLDERS.email;
  const usernameRaw = process.env.ADMIN_USERNAME ?? PLACEHOLDERS.username;
  const passwordRaw = process.env.ADMIN_PASSWORD ?? PLACEHOLDERS.password;

  const email = sanitizeEmail(emailRaw);
  const username = sanitizeUsername(usernameRaw);
  const password = passwordRaw;

  if (!email || !username || !password) {
    throw new Error("ADMIN_EMAIL, ADMIN_USERNAME и ADMIN_PASSWORD обязательны");
  }

  if (email === PLACEHOLDERS.email || username === PLACEHOLDERS.username || password === PLACEHOLDERS.password) {
    throw new Error(
      "Замените плейсхолдеры ADMIN_EMAIL / ADMIN_USERNAME / ADMIN_PASSWORD на реальные значения перед запуском.",
    );
  }

  if (!email.includes("@")) {
    throw new Error("ADMIN_EMAIL должен быть валидным email");
  }

  if (username.length < 2) {
    throw new Error("ADMIN_USERNAME должен содержать минимум 2 символа");
  }

  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD должен быть не короче 8 символов");
  }

  return { email, username, password };
}

async function upsertSuperadmin(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL не задан");
  }

  const input = readInputFromEnv();
  const passwordHash = await bcrypt.hash(input.password, 12);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: input.email,
      username: input.username,
      passwordHash,
      role: "admin",
      status: "active",
      emailVerified: true,
      emailVerifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: usersTable.email,
      set: {
        username: input.username,
        passwordHash,
        role: "admin",
        status: "active",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      username: usersTable.username,
      role: usersTable.role,
      status: usersTable.status,
      emailVerified: usersTable.emailVerified,
    });

  console.log("Superadmin upsert completed:", user);
}

upsertSuperadmin()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to upsert superadmin:", message);
    process.exit(1);
  });
