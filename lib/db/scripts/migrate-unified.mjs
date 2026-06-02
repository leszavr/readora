#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const DB_PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const ROOT_DIR = path.resolve(DB_PACKAGE_DIR, "..", "..");
const MIGRATIONS_DIR = path.resolve(DB_PACKAGE_DIR, "migrations");
const LEDGER_TABLE = "public.readora_migration_ledger";
const LOCK_KEY_SQL = "SELECT pg_advisory_lock(hashtext('readora-unified-migrations-v1'))";
const UNLOCK_KEY_SQL = "SELECT pg_advisory_unlock(hashtext('readora-unified-migrations-v1'))";

function loadEnvFromRootFile() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const envPath = path.resolve(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseCliArgs(argv) {
  const mode = argv[2] || "apply";
  if (!["apply", "adopt", "status"].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}. Use apply | adopt | status`);
  }

  return {
    mode,
    force: argv.includes("--force"),
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "en"));

  return files.map((name) => {
    const fullPath = path.join(MIGRATIONS_DIR, name);
    const sql = fs.readFileSync(fullPath, "utf8");
    return {
      name,
      fullPath,
      sql,
      checksum: sha256(sql),
    };
  });
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      id bigserial PRIMARY KEY,
      migration_name text NOT NULL UNIQUE,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_via text NOT NULL,
      applied_by text,
      execution_ms integer,
      notes text
    )
  `);
}

async function getAppliedMap(client) {
  const { rows } = await client.query(
    `SELECT migration_name, checksum, applied_at, applied_via FROM ${LEDGER_TABLE} ORDER BY id ASC`
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.migration_name, row);
  }
  return map;
}

async function detectExistingSchema(client) {
  const { rows } = await client.query(`
    SELECT
      to_regclass('public.users') IS NOT NULL AS users_exists,
      to_regclass('public.books') IS NOT NULL AS books_exists,
      to_regclass('public.reading_progress') IS NOT NULL AS reading_progress_exists
  `);

  const row = rows[0] || {};
  return Boolean(row.users_exists || row.books_exists || row.reading_progress_exists);
}

async function applyOneMigration(client, migration, appliedBy) {
  const startedAt = Date.now();
  await client.query("BEGIN");

  try {
    await client.query(migration.sql);
    const executionMs = Date.now() - startedAt;

    await client.query(
      `
      INSERT INTO ${LEDGER_TABLE}
        (migration_name, checksum, applied_via, applied_by, execution_ms, notes)
      VALUES ($1, $2, 'apply', $3, $4, NULL)
      `,
      [migration.name, migration.checksum, appliedBy, executionMs],
    );

    await client.query("COMMIT");
    return executionMs;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function adoptOneMigration(client, migration, appliedBy) {
  await client.query(
    `
    INSERT INTO ${LEDGER_TABLE}
      (migration_name, checksum, applied_via, applied_by, execution_ms, notes)
    VALUES ($1, $2, 'adopt', $3, NULL, 'Adopted without executing SQL body')
    `,
    [migration.name, migration.checksum, appliedBy],
  );
}

function printStatus(migrations, appliedMap) {
  let applied = 0;
  let pending = 0;

  for (const migration of migrations) {
    const existing = appliedMap.get(migration.name);
    if (existing) {
      applied += 1;
      const marker = existing.checksum === migration.checksum ? "ok" : "checksum-mismatch";
      console.log(`${migration.name}: applied (${existing.applied_via}, ${marker})`);
    } else {
      pending += 1;
      console.log(`${migration.name}: pending`);
    }
  }

  console.log(`---`);
  console.log(`Applied: ${applied}`);
  console.log(`Pending: ${pending}`);
}

async function main() {
  loadEnvFromRootFile();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Set env or .env at repository root.");
  }

  const { mode, force } = parseCliArgs(process.argv);
  const migrations = getMigrationFiles();
  const appliedBy = process.env.USER || process.env.USERNAME || "unknown";

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();
  try {
    await client.query(LOCK_KEY_SQL);
    await ensureLedger(client);

    const appliedMap = await getAppliedMap(client);

    if (mode === "status") {
      printStatus(migrations, appliedMap);
      return;
    }

    if (mode === "apply" && appliedMap.size === 0) {
      const hasSchema = await detectExistingSchema(client);
      if (hasSchema && !force) {
        throw new Error(
          "Ledger is empty but schema objects already exist. Run adopt first: pnpm --filter @workspace/db run migrate:adopt"
        );
      }
    }

    let changed = 0;
    for (const migration of migrations) {
      const existing = appliedMap.get(migration.name);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Checksum mismatch for ${migration.name}. Recorded=${existing.checksum}, current=${migration.checksum}`
          );
        }
        console.log(`Skip ${migration.name} (already applied via ${existing.applied_via})`);
        continue;
      }

      if (mode === "adopt") {
        await adoptOneMigration(client, migration, appliedBy);
        console.log(`Adopted ${migration.name}`);
      } else {
        const executionMs = await applyOneMigration(client, migration, appliedBy);
        console.log(`Applied ${migration.name} (${executionMs}ms)`);
      }

      changed += 1;
    }

    if (changed === 0) {
      console.log("No changes: all migrations are already registered.");
    }
  } finally {
    try {
      await client.query(UNLOCK_KEY_SQL);
    } catch {
      // Ignore unlock errors.
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
