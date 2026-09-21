import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import { invoices, invoiceStatusLog, staff } from "../db/schema";
import { isValidTransition } from "../lib/status-flow";

/**
 * OCR Engine Interface.
 *
 * Locked decision (spec Slice 2): poll, don't use S3 events/webhooks.
 * Provider choice: AWS Textract is the documented production target
 * (per-field confidence + table/form support suits invoices; Vision is the
 * fallback). `OCR_PROVIDER` selects the implementation:
 *   "mock" (default, dev/test) — deterministic stub, no network, no billing.
 *   "textract" — TODO: wire AWS Textract DetectDocumentText/AnalyzeExpense
 *     using S3 object key; map Blocks → OcrResult below.
 *   "google_vision" — TODO: wire Vision DOCUMENT_TEXT_DETECTION similarly.
 */
export interface OcrResult {
  success: boolean;
  amount?: number | string;
  invoiceNo?: string;
  date?: string;
  vendor?: string;
  rawText?: string;
  confidence?: number;
  fieldConfidence?: Record<string, number>;
  errorMessage?: string;
}

const OCR_PROVIDER = (process.env.OCR_PROVIDER || "mock").toLowerCase();
const STALE_PENDING_MS = parseInt(process.env.OCR_STALE_PENDING_MS || "600000", 10); // 10 min

/**
 * Mock OCR processor for local development & testing.
 * Deterministic (no Math.random billing/money data): derives stable pseudo
 * values from the s3Key hash so repeated runs don't fabricate new amounts.
 * Filenames containing 'bad'/'fail'/'corrupt' simulate unreadable images.
 */
async function processInvoiceOcr(s3Key: string): Promise<OcrResult> {
  if (OCR_PROVIDER === "mock" && process.env.NODE_ENV === "production") {
    // PRODUCTION FAIL-CLOSED: never write fabricated money data to real
    // invoices. Wire Textract/Vision (set OCR_PROVIDER accordingly) first.
    // Invoices stay queued until a real provider processes them.
    return {
      success: false,
      errorMessage:
        "OCR misconfigured: mock provider is disabled in production. Set OCR_PROVIDER=textract (or google_vision) and implement the adapter.",
    };
  }
  if (OCR_PROVIDER !== "mock") {
    // Production providers are not yet wired; fail loudly instead of
    // silently returning mock money data.
    return {
      success: false,
      errorMessage: `OCR provider "${OCR_PROVIDER}" is not implemented. Set OCR_PROVIDER=mock for dev or implement the Textract/Vision adapter.`,
    };
  }
  console.log(`[OCR Worker] Analyzing image content for S3 Key: ${s3Key}...`);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const lower = s3Key.toLowerCase();
  if (lower.includes("bad") || lower.includes("fail") || lower.includes("corrupt")) {
    return {
      success: false,
      errorMessage: "OCR parsing failed: Unreadable or blurry document image.",
    };
  }

  // Deterministic pseudo-extraction from key hash (stable across retries)
  let hash = 0;
  for (let i = 0; i < s3Key.length; i++) hash = (hash * 31 + s3Key.charCodeAt(i)) >>> 0;
  const vendors = ["Acme Industrial Supplies Ltd", "Starlight Logistics", "OmniCorp Services"];
  const vendor = vendors[hash % vendors.length];
  const amount = ((hash % 48500) + 1500) / 10; // 150.00–5000.00 deterministic
  const invoiceNo = `INV-2026-${String((hash % 90000) + 10000)}`;
  const date = new Date().toISOString().split("T")[0];

  return {
    success: true,
    amount,
    invoiceNo,
    date,
    vendor,
    rawText: `INVOICE\nVendor: ${vendor}\nInvoice #: ${invoiceNo}\nDate: ${date}\nTotal: $${amount.toFixed(2)}\n[MOCK OCR — replace with Textract in production]`,
    confidence: 94.5,
    fieldConfidence: {
      amount: 98.2,
      invoiceNo: 95.0,
      date: 92.1,
      vendor: 93.4,
    },
  };
}

type ClaimedRow = { id: string; s3_key: string; ocr_retry_count: number; status: string };

/**
 * Client default-staff routing: if the invoice's client has an assigned
 * default staff member, move ocr_done/ocr_failed straight to `assigned`.
 * Runs inside the worker's transaction (atomic with the OCR update).
 * No `assignments` row is written (assignedBy requires a human); the
 * status log carries the auto-assign note instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoAssignToClientDefault(tx: any, invoiceId: string, fromStatus: "ocr_done" | "ocr_failed") {
  if (!isValidTransition(fromStatus, "assigned")) return;
  const row = await tx.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    with: { client: true },
  });
  const defaultStaffId = (row?.client as { assignedStaffId?: string | null } | undefined)?.assignedStaffId;
  if (!row || !defaultStaffId) return;
  const target = await tx.query.staff.findFirst({ where: eq(staff.id, defaultStaffId) });
  if (!target || (target as { role?: string }).role !== "staff") return;
  await tx
    .update(invoices)
    .set({ status: "assigned", assignedTo: defaultStaffId, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  await tx.insert(invoiceStatusLog).values({
    invoiceId,
    status: "assigned",
    changedBy: null,
    note: `Auto-assigned to ${target.name} (client default staff)`,
  });
  console.log(`[OCR Worker] Invoice ${invoiceId} auto-assigned to ${target.name} (client default)`);
}

function normalizeRows(raw: unknown): ClaimedRow[] {
  if (Array.isArray(raw)) return raw as ClaimedRow[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // drizzle-orm/postgres-js may return { rows: [...] }
    if (Array.isArray(obj.rows)) return obj.rows as ClaimedRow[];
    // node-postgres style { rows }
    if (Array.isArray((obj as { rows?: unknown }).rows)) return (obj as { rows: ClaimedRow[] }).rows;
  }
  return [];
}

/**
 * Single Polling Cycle
 * Uses SELECT ... FOR UPDATE SKIP LOCKED so multiple concurrent worker
 * instances never double-claim or double-bill the OCR API.
 *
 * Claims BOTH fresh `uploaded` rows AND stale `ocr_pending` rows
 * (updated_at older than STALE_PENDING_MS — covers crash-between-claim-
 * and-completion). Stale rows are NOT transitioned (they are already
 * ocr_pending); they are simply re-processed.
 */
export async function runOcrPollingCycle() {
  console.log(`[OCR Poller] Checking for invoices with status 'uploaded'...`);

  try {
    const claimedInvoices = await db.transaction(async (tx) => {
      const raw = await tx.execute(sql`
        SELECT id, s3_key, ocr_retry_count, status
        FROM invoices
        WHERE status = 'uploaded'
           OR (status = 'ocr_pending'
               AND updated_at < NOW() - (${STALE_PENDING_MS}::bigint * INTERVAL '1 millisecond'))
        ORDER BY created_at ASC
        LIMIT 5
        FOR UPDATE SKIP LOCKED
      `);

      const rows = normalizeRows(raw);
      if (rows.length === 0) return [];

      // Atomically move fresh 'uploaded' rows to 'ocr_pending' (validated).
      // Stale 'ocr_pending' rows stay as-is (no backward/duplicate transition).
      for (const inv of rows) {
        if (inv.status === "uploaded") {
          if (!isValidTransition("uploaded", "ocr_pending")) {
            throw new Error("Transition table misconfigured: uploaded -> ocr_pending missing");
          }
          await tx
            .update(invoices)
            .set({ status: "ocr_pending", updatedAt: new Date() })
            .where(eq(invoices.id, inv.id));

          await tx.insert(invoiceStatusLog).values({
            invoiceId: inv.id,
            status: "ocr_pending",
            changedBy: null,
            note: "Claimed by OCR Polling Worker",
          });
        } else {
          // Stale ocr_pending re-claimed: touch updatedAt as heartbeat, no status log spam
          await tx
            .update(invoices)
            .set({ updatedAt: new Date() })
            .where(eq(invoices.id, inv.id));
        }
      }

      return rows;
    });

    if (claimedInvoices.length === 0) {
      return 0;
    }

    console.log(`[OCR Worker] Claimed ${claimedInvoices.length} invoice(s) with row lock. Processing...`);

    for (const inv of claimedInvoices) {
      const ocrResult = await processInvoiceOcr(inv.s3_key);

      if (ocrResult.success) {
        if (!isValidTransition("ocr_pending", "ocr_done")) {
          throw new Error("Transition table misconfigured: ocr_pending -> ocr_done missing");
        }
        await db.transaction(async (tx) => {
          await tx
            .update(invoices)
            .set({
              status: "ocr_done",
              ocrData: {
                amount: ocrResult.amount,
                invoiceNo: ocrResult.invoiceNo,
                date: ocrResult.date,
                vendor: ocrResult.vendor,
                rawText: ocrResult.rawText,
                confidence: ocrResult.confidence,
                fieldConfidence: ocrResult.fieldConfidence,
              },
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, inv.id));

          await tx.insert(invoiceStatusLog).values({
            invoiceId: inv.id,
            status: "ocr_done",
            changedBy: null,
            note: `OCR extraction successful (Confidence: ${ocrResult.confidence}%)`,
          });

          // Client default-staff routing (same transaction)
          await autoAssignToClientDefault(tx, inv.id, "ocr_done");
        });

        console.log(`[OCR Worker] Invoice ${inv.id} successfully processed -> ocr_done`);
      } else {
        // Provider misconfiguration (e.g. mock in production) is NOT an
        // invoice failure: leave the row untouched in ocr_pending (heartbeat
        // only) so it auto-recovers once fixed. No retry counting, no
        // terminal transition, no audit spam.
        if (ocrResult.errorMessage?.startsWith("OCR misconfigured")) {
          console.error(`[OCR Worker] Invoice ${inv.id} skipped: ${ocrResult.errorMessage}`);
          await db
            .update(invoices)
            .set({ updatedAt: new Date() })
            .where(eq(invoices.id, inv.id));
          continue;
        }
        // Failure: increment retry count and STAY in ocr_pending for the next
        // cycle; only move to terminal ocr_failed at >= 3 attempts.
        // (Never regress to `uploaded` — that transition is illegal per table.)
        const newRetryCount = (inv.ocr_retry_count || 0) + 1;
        const reachedMaxRetries = newRetryCount >= 3;
        const nextStatus = reachedMaxRetries ? "ocr_failed" : "ocr_pending";
        if (!isValidTransition("ocr_pending", nextStatus)) {
          throw new Error(`Transition table misconfigured: ocr_pending -> ${nextStatus} missing`);
        }

        await db.transaction(async (tx) => {
          await tx
            .update(invoices)
            .set({
              status: nextStatus,
              ocrRetryCount: newRetryCount,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, inv.id));

          // Log every attempt outcome; terminal failure is explicit
          await tx.insert(invoiceStatusLog).values({
            invoiceId: inv.id,
            status: nextStatus,
            changedBy: null,
            note: reachedMaxRetries
              ? `OCR failed after 3 attempts. Error: ${ocrResult.errorMessage}`
              : `OCR attempt ${newRetryCount} failed; will retry (stays ocr_pending). Error: ${ocrResult.errorMessage}`,
          });

          // Terminal OCR failure also routes to the client default staff
          // (manual data entry happens there).
          if (reachedMaxRetries) {
            await autoAssignToClientDefault(tx, inv.id, "ocr_failed");
          }
        });

        console.warn(`[OCR Worker] Invoice ${inv.id} failed attempt ${newRetryCount} -> ${nextStatus}`);
      }
    }

    return claimedInvoices.length;
  } catch (error) {
    console.error("[OCR Worker] Error in polling cycle:", error);
    return 0;
  }
}

/**
 * Continuous polling worker loop
 */
export async function startWorker(intervalMs = 5000) {
  console.log(`OCR Polling Worker started. Polling every ${intervalMs / 1000}s...`);
  while (true) {
    await runOcrPollingCycle();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Auto-start when executed directly via `tsx src/workers/ocr-poller.ts`
// (ESM-safe: `require` is undefined under tsx ESM mode.)
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  (process.argv[1].endsWith("ocr-poller.ts") || process.argv[1].endsWith("ocr-poller.js"));
if (invokedDirectly) {
  startWorker(5000);
}
