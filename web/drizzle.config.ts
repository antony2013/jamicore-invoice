import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: (() => {
      const url = process.env.DATABASE_URL;
      if (!url) {
        if (process.env.NODE_ENV === "production") {
          throw new Error("DATABASE_URL is not set.");
        }
        return "postgres://postgres:postgres@localhost:5432/invoice_db";
      }
      return url;
    })(),
  },
});
