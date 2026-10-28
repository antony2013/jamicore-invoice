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
   | `ENFORCE_MAKER_CHECKER` | `false` (set `true` to force a second person for verified→collected) |
   | `JOB_NUMBER_TZ` | `Asia/Colombo` (calendar day for `JC-YYYYMMDD-NNNN`) |

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

### 5.1 Image pinning

Every service image is pinned to an explicit version — never `latest`:

| Service | Pinned reference |
|---|---|
| `postgres` | `postgres:16-alpine` |
| `minio` | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` |
| `minio-init` (`mc`) | `pgsty/mc:RELEASE.2026-10-26T00-00-00Z` |
| `web` | built from `./web/Dockerfile` in this repo |

The official `minio/minio` and `minio/mc` Docker Hub repositories were
removed upstream (Oct 2025), so the stack uses the maintained community
mirror of the same MinIO releases. To upgrade, change the tag **and** the
digest comment together after verifying the pull:

```bash
docker pull pgsty/minio:<TAG> && docker image inspect pgsty/minio:<TAG> --format '{{index .RepoDigests 0}}'
```

### 5.2 Scheduled maintenance jobs (run from `web/`)

These scripts are manual today — wire them into a cron/Coolify scheduled
task and check the logs the next morning:

| Job | Command | Suggested cadence |
|---|---|---|
| Soft-deleted row purge | `npm run db:purge -- --apply` | weekly |
| S3 orphan cleanup | `npm run s3:cleanup -- --apply` | weekly |
| Audit log retention | `npm run audit:retention -- --delete` | monthly |

All of them default to **dry-run** and print what they would delete; the
`--apply` / `--delete` flag is required to actually mutate data. Run a
dry-run first after any schema change.

## 6. Rollback and restore drill

### 6.1 Application rollback (bad deploy, schema unchanged)

1. Coolify → the resource → **Deployments** → redeploy the previous
   successful commit (`Redeploy` on that entry). Migrations are additive and
   re-runnable, so the pre-deploy command is safe to repeat.
2. Verify `GET /api/health` → `{"status":"ok"}`, then log in once.
3. If the image itself is cached-only, `docker compose -f
   docker-compose.coolify.yml up -d --force-recreate web`.

### 6.2 Rollback with a schema change

Migrations in `web/src/db/migrations/` are forward-only — there is **no
down migration**. For a release that changed the schema:

1. Stop the web service (Coolify → **Stop**) so nothing writes.
2. Restore the database snapshot taken immediately before the deploy:
   ```bash
   docker compose -f docker-compose.coolify.yml stop web
   docker run --rm -v jamicore-pgdata:/var/lib/postgresql/data \
     -v "$PWD":/backup alpine sh -c \
     "rm -rf /var/lib/postgresql/data/* && tar xzf /backup/pgdata-before-deploy.tar.gz -C /var/lib/postgresql/data"
   ```
   (Adapt the volume name to `<stack>_jamicore-pgdata` as Coolify names it.)
3. Redeploy the previous commit, then re-run `node scripts/migrate.mjs` and
   confirm `Migrations up to date.`

### 6.3 Restore drill (do this before launch, and quarterly)

A backup that was never restored is not a backup. On a **scratch** machine
or a throwaway Coolify stack:

1. Copy the latest `jamicore-pgdata` snapshot and the `jamicore-minio`
   volume archive.
2. Restore both into empty volumes, boot the stack, and sign in.
3. Check: invoice list loads, one photo opens from S3, one Excel report
   downloads, chat history for a known outlet renders.
4. Record the date, snapshot ID, and elapsed restore time in the ops log.
5. Destroy the scratch stack.

### 6.4 Emergency data fixes

- Soft-deleted invoices are recoverable: `UPDATE invoices SET deleted_at =
  NULL WHERE id = '…'` (then clear `delete_reason`).
- `npm run db:reset` drops **all** app tables — only for a brand-new
  database whose first migration failed. Never on live data.

## Local verification (what was tested before shipping)

- `docker build ./web` builds end-to-end (exit 0).
- Fresh empty database + `node scripts/migrate.mjs` applies the full
  0000→0018 chain, ending with `chat_messages` created.
- `docker-compose.coolify.yml` is schema-valid
  (`docker compose -f docker-compose.coolify.yml config`).
