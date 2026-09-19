import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function resolveConnectionString(): string {
  const s = process.env.DATABASE_URL;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is not set. Refusing to start in production.");
    }
    return "postgres://postgres:postgres@localhost:5432/invoice_db";
  }
  return s;
}

type PgClient = ReturnType<typeof postgres>;
type Db = ReturnType<typeof drizzle<typeof schema>>;

let _client: PgClient | null = null;
let _db: Db | null = null;

/**
 * Lazy singleton: importing this module (e.g. during `next build` route
 * collection) must NEVER open a connection or parse DATABASE_URL.
 * The first actual query creates the pool. A malformed URL therefore fails
 * loudly at request time with a clear message instead of breaking builds.
 */
function getDb(): Db {
  if (!_db) {
    _client = postgres(resolveConnectionString(), {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

/** Forwards every property access to the lazily-created drizzle instance. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb() as unknown as object, prop, receiver);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});

/** Close the pool (scripts/tests). Safe to call when never connected. */
export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
