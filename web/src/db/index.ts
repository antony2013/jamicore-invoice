import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. Refusing to start in production.");
  }
}
const resolvedConnectionString =
  connectionString || "postgres://postgres:postgres@localhost:5432/invoice_db";

// For queries that use connection pooling
const client = postgres(resolvedConnectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { client };
