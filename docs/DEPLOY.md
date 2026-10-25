# Coolify Deployment Guide — JamiCore Invoice

The repo ships Coolify-ready: a production `web/Dockerfile` (Next.js
standalone, non-root node:20-alpine), a SQL migration runner
(`node scripts/migrate.mjs`), the full migration chain
(`web/src/db/migrations/0000…0018`, fresh from an empty database), and a
one-file stack (`docker-compose.coolify.yml`) for web + PostgreSQL + MinIO.

---

## 1. Prerequisites

- Coolify (v4.22+ recommended) with a working Traefik/proxy.
- A domain for the web app, e.g. `ac.jamicore.com`.
- A domain for MinIO S3, e.g. `s3.jamicore.com` — **must be reachable from
  the phone** (the mobile app fetches presigned links directly from S3).
- DNS A/AAAA records for both domains.

## 2. Create the stack in Coolify

1. **New resource → Docker Compose → Docker Compose Empty**, connect this
   Git repo, branch `main`, Docker Compose file:
   `docker-compose.coolify.yml`.
2. Under the resource, add these **Environment Variables** (values become
   the `${VAR}` in the compose file):

   | Variable | Example / how to generate |
   |---|---|
   | `POSTGRES_DB` | `invoice_db` |
   | `POSTGRES_USER` | `postgres` |
   | `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
   | `JWT_SECRET` | `openssl rand -hex 32` |
   | `NEXTAUTH_SECRET` | `openssl rand -hex 32` |
   | `APP_URL` | `https://ac.jamicore.com` |
   | `S3_PUBLIC_URL` | `https://s3.jamicore.com` |
   | `S3_BUCKET_NAME` | `invoice-uploads` |
   | `S3_CORS_ORIGINS` | `https://ac.jamicore.com` |
   | `AWS_ACCESS_KEY_ID` | e.g. `jamicore-app` (minio root user) |
   | `AWS_SECRET_ACCESS_KEY` | `openssl rand -hex 24` |
   | `OCR_PROVIDER` | `mock` (switch to `textract` when credentials exist) |
   | `ENFORCE_MAKER_CHECKER` | `true` (see `web/.env.example` for caveats) |

3. Set the **Pre-deployment command** on the stack to
   `node scripts/migrate.mjs` — applies 0000→0018 on every deploy.
4. **Domains**: map the `web` service to `APP_URL` (port 3000 in-container)
   and the `minio` service to `S3_PUBLIC_URL` (port 9000).
5. Deploy. First boot: Postgres healthy → `minio-init` creates the private
   bucket → web builds and starts.

## 3. First-run setup (no seeding in production)

1. Sign up the first admin at `https://<APP_URL>/login` → admin created via
   the seed only when `ALLOW_SEED=true`; in production create the admin in
   the admin UI on first visit if prompted, or insert one staff row
   manually. **Only** empty-password accounts remain locked until created.
2. Create office staff, then clients (each client receives a user ID +
   password for the mobile app) and outlets on `/admin` pages.
3. Log in on the mobile app with the client's user ID + password. The app
   URL used by release builds comes from `mobile/app.json` →
   `extra.apiBaseUrl` — it must equal `APP_URL`.

## 4. Smoke checklist

- `GET https://<APP_URL>/api/health` → `{"status":"ok"}`.
- Upload a photo from the mobile app (validates presigned PUT + CORS).
- Download the Excel report (validates presigned GET through the proxy).
- Branch chat + invoice chat from the mobile app appear in the staff outlet
  page widget; attachments open in both directions.

## 5. Day-2 operations

- **Migrations**: always via the pre-deploy command; verify in the deploy
  log (`Migrations up to date.`).
- **DB access**: Coolify terminal → `psql` to the postgres container.
- **S3 contents**: MinIO console (port 9001, expose temporarily or via
  domain with authentication) — never make the data public.
- **Backups**: snapshot `jamicore-pgdata` and `jamicore-minio` volumes
  (Coolify → the resource → S3 backups, or your own cron).

## Local verification (what was tested before shipping)

- `docker build ./web` builds end-to-end (exit 0).
- Fresh empty database + `node scripts/migrate.mjs` applies the full
  0000→0018 chain, ending with `chat_messages` created.
- `docker-compose.coolify.yml` is schema-valid
  (`docker compose -f docker-compose.coolify.yml config`).
