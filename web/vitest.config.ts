import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Alias order matters: longest prefix first (vite matches in order).
    alias: [
      {
        find: "next-auth/providers/credentials",
        replacement: path.resolve(__dirname, "src/test/stubs/next-auth-credentials.ts"),
      },
      {
        find: "next-auth",
        replacement: path.resolve(__dirname, "src/test/stubs/next-auth.ts"),
      },
      {
        find: "next/server",
        replacement: path.resolve(__dirname, "src/test/stubs/next-server.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 60000,
    // Test files share ONE Postgres database (truncate in beforeEach), so
    // they must not run in parallel workers against each other.
    pool: "forks",
    maxWorkers: 1,
    // next-auth must be transformed+aliased, not externalized, so the
    // next/server stubs apply to its imports too.
    server: {
      deps: {
        inline: ["next-auth"],
      },
    },
    // Test-only secrets: the Step 3.1 fail-closed change throws in
    // production without these; tests run under NODE_ENV=test with
    // throwaway values so secret handling itself stays testable.
    env: {
      NODE_ENV: "test",
      NEXTAUTH_SECRET: "test-only-nextauth-secret-not-a-real-secret",
      JWT_SECRET: "test-only-jwt-secret-not-a-real-secret",
      S3_ENDPOINT: "http://127.0.0.1:1",
      S3_BUCKET_NAME: "test-bucket",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      S3_FORCE_PATH_STYLE: "true",
      ENFORCE_MAKER_CHECKER: "true",
    },
  },
});
