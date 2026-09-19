# Build Prompt: Invoice Collection System

You are building a full-stack invoice collection system with three parts: a native mobile app (client-facing), a Next.js web app (admin + staff), and a shared backend API + database. Build this in **vertical slices** — each slice should be fully working end-to-end (DB → API → UI) before moving to the next, not layer-by-layer.

## System overview

Three roles:
- **Client** — uses the mobile app to scan and upload invoice photos.
- **Admin** — uses the Next.js web app to view uploaded invoices and assign them to staff.
- **Staff** — uses the Next.js web app to verify/correct invoice data and manage collection status.

## Locked technical decisions (do not deviate without asking)

- **Mobile app**: separate native app (React Native / Expo with a custom dev client — NOT Expo Go, since native modules are required). Uses `react-native-document-scanner-plugin` (MIT license) for document capture with auto edge-detection and crop.
- **Web app**: Next.js (App Router), single app serving both `/admin/*` and `/staff/*` route groups, gated by role via middleware.
- **Auth**: NextAuth (Auth.js) for the web app (admin/staff), two roles: `admin` and `staff`. Mobile app clients authenticate separately via **phone OTP** (see Client Identity section — do not skip this).
- **Database**: PostgreSQL with Drizzle ORM.
- **File storage**: S3-compatible bucket, **private** (not public-read). Invoice images are sensitive documents — never make the bucket or objects public.
- **OCR**: runs server-side, asynchronously, AFTER upload — **fire-and-forget** from the mobile app's perspective. The app confirms "uploaded" immediately without waiting for OCR.
- **OCR trigger mechanism**: simple polling — a scheduled job (cron/interval) queries invoices in `uploaded` status, runs OCR (Google Vision API or AWS Textract — pick one and document the choice), and updates the record. Do NOT build S3-event/webhook-based triggering; polling is the deliberate choice here for simplicity. The polling job must be safe to run as multiple concurrent instances (see Slice 2).
- **OCR failure handling**: track `ocrRetryCount` on the invoice. On OCR failure, increment the count and retry on the next polling cycle. Once `ocrRetryCount >= 3`, set status to `ocr_failed` (terminal state) instead of retrying forever — a bad/blurry image should not burn API quota indefinitely.
- **Status flow (enforced, not advisory)**: `uploaded → ocr_pending → ocr_done | ocr_failed → assigned → in_review → needs_info → verified → collected | disputed`. `needs_info` can loop back to `in_review`. `collected` and `disputed` are terminal — no further transitions once reached, only viewing. The exact allowed-transition table must live in one place in code (not scattered `if` checks) so it can be reasoned about and tested.

## Client identity (non-negotiable — this is the actual trust root of the system)

- Clients authenticate via **phone number + OTP**, not username/password and not unverified phone entry. On first login, send an OTP via SMS provider (pick one — Twilio, MSG91, etc. — and document the choice); verify the OTP server-side before issuing a JWT.
- The JWT is the only thing that proves "this request is from client X." Never accept a client's identity from anything else — not a header, not a request body field, not a query param.
- Rate-limit OTP requests per phone number (e.g., max 5 per hour) to prevent SMS-bombing abuse.
- Ask before substituting a different identity mechanism (magic link, social login, etc.) — OTP is the deliberate choice for this user base.

## Security requirements (non-negotiable — do not ship without these)

- **Mobile app auth is mandatory.** Every request from the mobile app (requesting an upload URL, confirming an upload) must include a valid auth token (JWT). No endpoint that touches client data may be callable anonymously.
- **`clientId` is never trusted from the request body.** It must be derived server-side from the authenticated user's token on every request. A client must never be able to pass another client's ID and attach an invoice to someone else's account.
- **Invoice images are served via short-lived signed GET URLs, generated on demand.** TTL is 5 minutes. Not stored/returned as permanent public URLs. The bucket stays private end-to-end. Admin/staff UI requests a fresh signed URL when displaying an image.
- **The confirm-upload step must be idempotent.** The same `s3Key` should not be able to create duplicate `invoices` rows if the client retries the confirm call (e.g., due to a flaky network response). Key on `s3Key` uniqueness.
- **Verify the object actually exists in S3** (`HeadObject`) before writing the DB row, so a failed/partial S3 upload can't create an orphan "uploaded" record with no real file behind it. This is required, not optional.
- **Presigned upload URLs are constrained**: scope the presigned PUT to a specific content-type (image/jpeg, image/png) and a max content-length (e.g., 15MB). Reject anything else at the S3 policy level, not just client-side.
- **Rate-limit `/api/invoices/upload-url`** per client token (e.g., max 30 requests/hour) to prevent storage/bandwidth abuse from a compromised or misbehaving client.
- **Status transitions are validated server-side against the allowed-transition table.** No endpoint may set an invoice directly from `uploaded` to `collected`, skip states, or mutate a `collected`/`disputed` (terminal) invoice. Reject invalid transitions with a clear error, do not silently ignore.
- Do not trust `clientId`, `staffId`, or any identity field from request bodies — always derive from the authenticated session/token.
- Do not make the S3 bucket or any object in it public — signed URLs only, generated per request.

## Data model (Postgres via Drizzle)

```
clients
  id, name, phone (unique), email, created_at

staff
  id, name, email, role ('admin' | 'staff'), created_at

invoices
  id, client_id (fk -> clients), s3_key (unique), image_url (internal reference only, not public),
  status (enum, see status flow above),
  ocr_data (jsonb, nullable: { amount, invoiceNo, date, vendor, rawText, confidence })
  ocr_retry_count (integer, default 0),
  assigned_to (fk -> staff, nullable),
  priority ('low' | 'normal' | 'urgent'),
  created_at, updated_at

assignments
  id, invoice_id (fk), staff_id (fk), assigned_by (fk -> staff), assigned_at

invoice_status_log
  id, invoice_id (fk), status, changed_by (fk -> staff, nullable — null means an automated/system change e.g. OCR worker), note, timestamp
```

- `ocr_data.confidence` — store the OCR provider's confidence score (overall, and per-field if the provider supports it, e.g. Textract does). Surface low-confidence fields in the staff verification UI (Slice 4) rather than treating all OCR output as equally trustworthy — this data drives money-collection decisions.
- Note: this schema assumes **one image per invoice**. Multi-page invoices are explicitly out of scope for this build — flag to the user if that's not actually true of their real invoices, since retrofitting multi-image support later is a real schema/UI change, not a tweak.

Every status change must write a row to `invoice_status_log` — this is the audit trail; do not skip it even for automated transitions.

## Vertical slices — build in this order

### Slice 1: Authenticated client upload → private storage → DB record
- DB: `clients`, `invoices` tables (with `s3_key` unique constraint, `clients.phone` unique).
- Mobile client auth: phone OTP login flow → issue JWT on verified OTP; every subsequent API call from the mobile app carries this token.
- API: `POST /api/invoices/upload-url` — requires valid client auth token; rate-limited; generates a presigned PUT URL scoped to a private bucket with content-type and size constraints; does NOT create a DB row yet.
- API: `POST /api/invoices/confirm-upload` — requires the same auth token; derives `clientId` from the token (never from the request body); verifies the S3 object exists (`HeadObject`); checks `s3Key` for idempotency before inserting; creates the `invoices` row in `uploaded` status plus an `invoice_status_log` entry (`changedBy: null`).
- Mobile: OTP login screen → scan screen (document scanner plugin) → capture → crop → direct upload to S3 via presigned URL → call confirm endpoint → show "Uploaded ✓" instantly, no waiting on OCR.
- Done when: a client can log in via OTP, scan an invoice on a real device, and it lands in the DB with status `uploaded`, a valid private `s3Key`, correctly attributed to their own `clientId` — and retrying the confirm call does not create a duplicate row, and an OTP-request flood is rate-limited.

### Slice 2: Async OCR via polling
- Backend: scheduled job (every N seconds/minutes, configurable) that claims invoices with status `uploaded` using `SELECT ... FOR UPDATE SKIP LOCKED` (or equivalent row-locking), sets them to `ocr_pending`, calls the OCR provider, writes result (including `confidence`) to `ocr_data`, sets status to `ocr_done`.
- The row-locking is required specifically so multiple worker instances can run concurrently without double-processing the same invoice or double-billing the OCR API.
- On failure: increment `ocr_retry_count`; if it reaches 3, set status to `ocr_failed` (terminal, no further retries); otherwise leave it for the next polling cycle to retry.
- Done when: an uploaded invoice gets `ocr_data` (with confidence) populated automatically within one polling cycle without manual triggering; a deliberately bad image correctly lands in `ocr_failed` after 3 attempts; and running two worker instances simultaneously against the same queue does not cause duplicate OCR calls on the same invoice.

### Slice 3: Admin — queue + assignment
- Auth: NextAuth login, admin role gated via middleware on `/admin/*`.
- API: `GET /api/invoices` (filter by status/client), `POST /api/invoices/:id/assign` — validated against the status transition table (`ocr_done`/`ocr_failed` → `assigned` only).
- Image display: admin UI requests a fresh short-lived (5 min TTL) signed GET URL per invoice image rather than using any stored "public" URL.
- UI: `/admin/dashboard` — invoice queue (unassigned first, show OCR data with confidence if available, including `ocr_failed` items flagged for manual handling), `/admin/invoices/[id]` — detail view + assign-to-staff + set priority.
- Done when: an admin can log in, see the invoice from Slice 1 (image loads correctly from the private bucket), and assign it to a staff account — and attempting to assign an invoice still in `uploaded`/`ocr_pending` is rejected.

### Slice 4: Staff — verification + status management
- Auth: staff role gated via middleware on `/staff/*`.
- API: `GET /api/invoices?assigned_to=me`, `PATCH /api/invoices/:id` (edit ocr_data fields, change status) — status changes validated against the transition table; requests to move a `collected`/`disputed` invoice are rejected.
- UI: `/staff/dashboard` — "my assigned invoices", `/staff/invoices/[id]` — editable OCR fields (pre-filled, or blank for manual entry if `ocr_failed`; visually flag low-confidence fields for review), status transition buttons limited to whatever states are actually valid from the current status.
- Every status change here must also write `invoice_status_log` with `changedBy` set to the acting staff member.
- Done when: a staff member can log in, see an assigned invoice, correct/confirm its OCR data (or manually enter data if OCR failed), and move it through statuses to `collected` — and cannot skip states or edit a terminal invoice.

### Slice 5: Audit trail + polish
- UI: status history timeline on the invoice detail view (admin and staff), pulled from `invoice_status_log`.
- Basic client list view for admin.
- Done when: full lifecycle of one invoice — upload → OCR (or OCR failure + manual entry) → assign → verify → collect — is visible end-to-end with a timestamped history, no step in that chain was reachable without proper auth or ownership checks, and no invalid status transition was possible at any point.

## Constraints for the agent

- Do not add S3-event-based or webhook-based OCR triggering — polling is the explicit choice, not a placeholder.
- Do not let the mobile app block on OCR completion at any point.
- Do not skip `invoice_status_log` writes on any status transition, including automated ones (e.g., OCR completion).
- Do not trust `clientId`, `staffId`, or any identity field from request bodies — always derive from the authenticated session/token.
- Do not make the S3 bucket or any object in it public — signed URLs only, generated per request, 5-minute TTL.
- Do not allow status transitions outside the defined transition table, and do not allow any mutation of `collected`/`disputed` invoices.
- Do not process the OCR polling queue without row-level locking (`SKIP LOCKED` or equivalent) — assume the job may run as multiple instances.
- Keep mobile app and Next.js app as separate codebases/repos; do not attempt to unify them.
- Ask before introducing additional services (queues, Redis, etc.) not listed above — keep the stack to what's specified unless a slice genuinely can't be built without it.
- Ask before substituting the OTP-based client identity mechanism for anything else.
