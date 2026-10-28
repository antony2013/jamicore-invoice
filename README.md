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
- **Money rule**: verified invoices lock for staff.
- **Maker-checker**: OFF by default (`ENFORCE_MAKER_CHECKER=false`); set it
  to `true` to require a second account for `verified → collected`.

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

**Completing a job** (`→ collected`) also derives business data in the same
transaction: `job_number` (`JC-YYYYMMDD-0001`, daily sequence, unique) and
`completed_at`. Allocation is serialized with a transaction-scoped advisory
lock inside `transitionInvoice()` / `allocateJobNumber()`, so two concurrent
completions can never share a number. Both fields are shown on the staff and
admin invoice pages.

## Local setup

```bash
# 1. Postgres + S3 (LocalStack)
docker start jamicore-postgres jamicore-s3   # or: docker compose up -d
docker exec jamicore-s3 awslocal s3 mb s3://invoice-uploads
cd web && node scripts/init-local-s3.mjs     # recreate bucket + CORS (PUT/GET/HEAD)

# 2. Web
cd web && cp .env.example .env   # fill secrets + SEED_* passwords
npm install
npm run db:migrate
ALLOW_SEED=true npx tsx src/db/seed.ts   # first run only
npm run dev                               # http://localhost:3000

# 3. Mobile
cd mobile && npx expo start --tunnel
cd mobile && npm run typecheck               # typecheck only
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
| `ENFORCE_MAKER_CHECKER` (default false) | verified→collected by a different account; set `true` to re-enable |
| `ENFORCE_MAKER_CHECKER_ADMIN_EXEMPT` (default false) | Admin exemption (only while maker-checker is on) |
| `JOB_NUMBER_TZ` (default `Asia/Colombo`) | Calendar day used in `JC-YYYYMMDD-NNNN` job numbers |
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
| `npm run audit:retention [-- --older-than-days=N --archive=file --delete]` | Export old audit rows to JSONL; with `--delete`, prune them after archiving |
| `npm run db:rotate [-- --apply --scope=staff\|clients\|all]` | Rotate all credentials after a leak |
| `npm test` | vitest (needs `DATABASE_URL_TEST` scratch DB) |
| `npm run lint` | ESLint (flat config, `next/core-web-vitals` + TS rules) |

CI (`.github/workflows/ci.yml`) runs on every push/PR: production dependency
audit, typecheck, lint, the full vitest suite against a scratch Postgres
service, `next build`, the mobile typecheck, and `docker compose config` for
the Coolify stack. A red job blocks merge.

## Messaging surfaces (two, on purpose)

| Surface | Tables / API | Who uses it |
|---|---|---|
| Invoice thread | `invoice_messages`, `/api/invoices/[id]/messages`, `/api/threads` | Staff "Messages" page + mobile invoice detail: the legacy, per-invoice mail-style thread with unread counters and report attachments |
| Scoped chat | `chat_messages`, `/api/chat`, `/api/client-chat` (+ `/attachment`) | Staff outlet/invoice chat widget + mobile branch chat: lightweight outlet/invoice-scoped chat with photo attachments |

They are deliberately separate: the thread is a documented, auditable
per-invoice record (unread counts, Excel reports), while chat is the quick
branch-level conversation. Both resolve authorization through
`src/lib/chat-scope.ts` / `src/lib/invoice-access.ts`; chat attachments are
authorized per message (the key alone is not enough).

## Deployment notes (Coolify)

- Behind Traefik: the app trusts `x-forwarded-for`/`x-forwarded-proto`
  (rate limits, audit IPs, secure cookies). Serve only HTTPS in prod.
- After each deploy: apply migrations **inside the app container** (the
  production image has no dev deps): Coolify → your app → Terminal, then
  `node scripts/migrate.mjs`. Same command works as the Pre-deployment
  Command. With DB access from a dev machine: `npm run db:migrate`.
- S3 bucket CORS must allow the web origin (PUT/GET/HEAD) or browser
  uploads fail with CORS errors (mobile is unaffected).
- Cron: `s3:cleanup --apply` daily; `db:purge --older-than-days=30 --apply`
  on a schedule you choose. Keep an off-site `pg_dump` before purges.
- Mobile release builds lock the API URL to `extra.apiBaseUrl`
  (`mobile/app.json`); the in-app server switcher is dev-only.

## Deployment runbook

Do these in order, every deploy. No new features here — just safe rollout.

### 1. Backup (before anything else)
```bash
docker exec jamicore-postgres pg_dump -U postgres -d invoice_db -F p --no-owner \
  > ~/jamicore-backups/invoice_db-$(date +%Y%m%d-%H%M%S).sql
```
Verify the dump contains data (`grep -c "^COPY public" <file>` should be > 0).
Keep dumps outside the repo; never commit one.

### 2. Required env vars (production refuses to boot without them)
`DATABASE_URL`, `NEXTAUTH_SECRET`, `JWT_SECRET` — fail-closed via
`requireSecret()` (dev fallback only when `NODE_ENV=development`).
Plus: `S3_ENDPOINT` (phone-reachable), `S3_BUCKET_NAME`, `AWS_*` keys,
`NEXTAUTH_URL=https://<your-domain>`. Full table: `web/.env.example`.

### 3. Migration order
```bash
cd web
npm run db:migrate            # dev machine with DB access (drizzle-kit)
node scripts/migrate.mjs      # inside the prod container (no dev deps)
```
Current chain: `0000`–`0012` (Phase 1), `0013` (audit_log + soft-delete),
`0014` (perf indexes), `0015` (message drafts), `0016` (report notes).
Review generated SQL before applying.

### 4. Rollback (restore from dump)
```bash
# stop the app first, then:
docker exec -i jamicore-postgres psql -U postgres -d invoice_db < ~/jamicore-backups/<file>.sql
# if the schema itself must go back too: drop + recreate the DB, restore,
# then `npm run db:migrate` will re-apply only what's missing.
```

### 5. `db:rotate` usage and consequences
After any credential leak (hashes were once served to browsers):
```bash
npm run db:rotate -- --apply --scope=all   # dry-run without --apply
```
- **Staff**: each gets a new random password, printed ONCE to stdout
  (copy now — never logged). Everyone must re-login (token_version bump).
- **Clients**: passwords set to NULL — owners **cannot log in until an admin
  sets a new password** in `/admin/clients`. Team PINs randomized — owners
  must reset them in the Team screen.

### 6. Health endpoint
`GET /api/health` (no auth): `{status:"ok"}` / HTTP 503 with
`{status:"unavailable"}` on DB failure (no internals). Point your
uptime monitor and Coolify healthcheck at it.

### 7. Cron entries
```cron
# S3 orphans (>24h, no DB row), daily
0 3 * * *  cd /srv/jamicore-invoice/web && npm run s3:cleanup -- --apply
# Hard-purge soft-deleted invoices (>30d), weekly — DB first, S3 after, audited
0 4 * * 0  cd /srv/jamicore-invoice/web && npm run db:purge -- --older-than-days=30 --apply
```

### TODO: audit_log retention / partitioning
`audit_log` is append-only and grows forever. Audit retention script exists:
`npm run audit:retention ...` exports old rows to JSONL and can prune only
after the archive file is written. For large installs, still plan monthly
RANGE partitioning on `at` plus moving detached partitions to cold storage.
Until then, watch table size (`pg_total_relation_size('audit_log')`) as part
of ops.
