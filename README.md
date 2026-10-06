# JamiCore Invoice Collection System

Shop owners (and their team staff) photograph invoices in a mobile app.
Office staff verify, correct, message, report (Excel) and collect them in a
web portal. Admins manage clients, staff, outlets, archives and the audit log.

## Architecture

```
mobile/ (Expo React Native, SDK 57) ──Bearer JWT──▶ web/ (Next.js 15 App Router)
                                                      ├─ Postgres (Drizzle ORM)
                                                      └─ S3 (private bucket: MinIO / AWS / R2 / LocalStack)
```

- **Auth**: office = NextAuth credentials (staff/admin, revocation via
  `token_version`); mobile = short-lived JWTs (`tv` claim, revalidated per
  request, 7-day expiry).
- **Files**: presigned PUT/GET only, 5-minute view links, magic-byte checked.
- **Money rule**: verified invoices lock for staff; `verified → collected`
  needs a different account (maker-checker, env-gated).

## Roles & permissions (matrix)

| Capability | Admin | Staff | Client owner | Team staff |
|---|---|---|---|---|
| Manage staff/clients/outlets/archive | ✅ | — | — | — |
| Verify/collect assigned invoices | ✅ | own only | — | — |
| Upload invoices | — | — | ✅ | ✅ own |
| Edit/withdraw own upload (1h, pre-office) | — | — | ✅ | ✅ own |
| Team management + PIN resets | — | — | ✅ | — |
| Message thread per invoice | ✅ | own | ✅ | ✅ own |
| Excel reports (staff creates, client downloads) | ✅ | own | download | download own |
| Audit log viewer | ✅ | — | — | — |

## Status flow (single source of truth: `web/src/lib/status-flow.ts`)

```
uploaded ──▶ assigned ──▶ in_review ──▶ verified ──▶ collected (terminal)
                  │            ╰──▶ needs_info ──▶ in_review       disputed (terminal)
                  ╰── (re-assign keeps status)
legacy ocr_* ──▶ assigned (drain only; nothing new enters)
```

All status writes go through `transitionInvoice()` (conditional update,
409 on concurrent change). Soft-deleted rows (`deleted_at`) are invisible
everywhere; purge only via `db:purge`.

## Local setup

```bash
# 1. Postgres + S3 (LocalStack)
docker start jamicore-postgres jamicore-s3   # or: docker compose up -d (see below)
docker exec jamicore-s3 awslocal s3 mb s3://invoice-uploads

# 2. Web
cd web && cp .env.example .env   # fill secrets + SEED_* passwords
npm install
npm run db:migrate
ALLOW_SEED=true npx tsx src/db/seed.ts   # first run only
npm run dev                               # http://localhost:3000

# 3. Mobile
cd mobile && npx expo start --tunnel
```

Docker volumes are the dev database — back it up before risky ops:
`pg_dump` lives outside the repo (see Deployment notes).

## Environment variables (see `web/.env.example`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (fail-closed outside dev) |
| `NEXTAUTH_SECRET` / `JWT_SECRET` | Session + mobile JWT signing (fail-closed) |
| `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_FORCE_PATH_STYLE`, `AWS_*` | Private bucket config; endpoint must be phone-reachable (LAN IP) |
| `SEED_*` / `ALLOW_SEED` | First-run accounts (dev) |
| `ENFORCE_MAKER_CHECKER` (default true) | verified→collected needs a different account |
| `ENFORCE_MAKER_CHECKER_ADMIN_EXEMPT` (default false) | Admin exemption |
| `DATABASE_URL_TEST` | Scratch DB for `npm test` (name must contain "test") |

## Migration workflow

```bash
cd web
# 1. edit src/db/schema.ts (NEVER edit existing files in src/db/migrations)
npx drizzle-kit generate --name <what-changed>
# 2. REVIEW the generated SQL, then:
npm run db:migrate
```

## Scripts (`web/`, all dry-run by default)

| Script | Purpose |
|---|---|
| `npm run s3:cleanup [-- --apply]` | Delete S3 objects >24h with no DB row |
| `npm run db:purge [-- --older-than-days=N --apply]` | Hard-purge soft-deleted invoices (DB first, S3 after) |
| `npm run db:rotate [-- --apply --scope=staff\|clients\|all]` | Rotate all credentials after a leak |
| `npm test` | vitest (needs `DATABASE_URL_TEST` scratch DB) |

## Deployment notes (Coolify)

- Behind Traefik: the app trusts `x-forwarded-for`/`x-forwarded-proto`
  (rate limits, audit IPs, secure cookies). Serve only HTTPS in prod.
- After each deploy: run `npm run db:migrate` (Coolify terminal or
  pre-deploy command), then redeploy.
- S3 bucket CORS must allow the web origin (PUT/GET/HEAD) or browser
  uploads fail with CORS errors (mobile is unaffected).
- Cron: `s3:cleanup --apply` daily; `db:purge --older-than-days=30 --apply`
  on a schedule you choose. Keep an off-site `pg_dump` before purges.
- Mobile release builds lock the API URL to `extra.apiBaseUrl`
  (`mobile/app.json`); the in-app server switcher is dev-only.
