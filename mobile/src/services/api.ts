// Mobile API Service communicating with Jamicore Backend
// Client auth: admin-created user ID + password (no OTP).
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { printToFileAsync } from "expo-print";

// Production backend. Override anytime from inside the app (tap the API badge).
let currentApiBaseUrl = "https://ac.jamicore.com";

let clientAuthToken: string | null = null;
declare const require: (module: string) => any;
let secureStore: {
  getItemAsync: (k: string) => Promise<string | null>;
  setItemAsync: (k: string, v: string) => Promise<void>;
  deleteItemAsync: (k: string) => Promise<void>;
} | null = null;
try {
  // Lazy require so web builds without the module don't crash at import
  secureStore = require("expo-secure-store") as typeof secureStore;
} catch {
  secureStore = null;
}

const TOKEN_KEY = "jamicore_client_jwt";

export function setApiBaseUrl(url: string) {
  currentApiBaseUrl = url.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  return currentApiBaseUrl;
}

export async function loadPersistedToken(): Promise<string | null> {
  if (!secureStore) return clientAuthToken;
  try {
    const stored = await secureStore.getItemAsync(TOKEN_KEY);
    if (stored) clientAuthToken = stored;
    return clientAuthToken;
  } catch {
    return clientAuthToken;
  }
}

export async function setAuthToken(token: string | null) {
  clientAuthToken = token;
  if (secureStore) {
    try {
      if (token) await secureStore.setItemAsync(TOKEN_KEY, token);
      else await secureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // In-memory token remains usable for this session
    }
  }
}

export function getAuthToken(): string | null {
  return clientAuthToken;
}

/** Local file size in bytes (for S3 policy-level enforcement). Kept for
 *  potential direct-file flows; the PDF flow uses in-memory bytes instead. */
export async function getLocalFileSize(imageUri: string): Promise<number | undefined> {
  try {
    const FileSystem = require("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(imageUri);
    if (!info.exists) return undefined;
    return info.size || undefined;
  } catch {
    return undefined;
  }
}

export async function logout() {
  await setAuthToken(null);
}

/**
 * 1. Login with admin-provided user ID + password. Persists JWT to SecureStore.
 */
export async function loginWithPassword(username: string, password: string) {
  const response = await fetch(`${currentApiBaseUrl}/api/client-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Login failed.");
  }

  await setAuthToken(data.token);
  return data;
}

/**
 * 2. Request Presigned Upload URL from backend.
 * Pass the local file size so S3 enforces it at the policy level.
 */
export async function getUploadUrl(contentType: string = "image/jpeg", contentLength?: number) {
  if (!clientAuthToken) {
    throw new Error("Client is not authenticated. Please log in first.");
  }

  const response = await fetch(`${currentApiBaseUrl}/api/invoices/upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientAuthToken}`,
    },
    body: JSON.stringify(
      contentLength !== undefined ? { contentType, contentLength } : { contentType }
    ),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to get upload URL.");
  }
  return data as { uploadUrl: string; s3Key: string };
}

/**
 * 3. Upload bytes directly to S3 via presigned PUT (no file reads involved).
 * Used for the generated invoice PDF, whose bytes come straight from
 * expo-print (base64) — this sidesteps all device file-permission issues
 * ("isn't readable" cache errors, unreadable file:// URIs).
 */
export async function uploadBytesToS3(uploadUrl: string, base64: string, contentType: string) {
  if (!base64 || base64.length < 100) {
    throw new Error("Generated file is empty. Please try again.");
  }
  // base64 -> bytes in chunks (avoids huge intermediate strings on device)
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  const CHUNK = 8192;
  for (let offset = 0; offset < len; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, len);
    for (let i = offset; i < end; i++) bytes[i] = binary.charCodeAt(i);
  }
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes as any,
  });
  if (!putRes.ok) {
    throw new Error(`Failed to upload file to storage (Status ${putRes.status})`);
  }
  return { byteLength: len };
}

export type InvoicePage = { uri: string; note: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a multi-page PDF (Adobe Scan style) from photo pages.
 * Each photo is resized (max width 1240px, JPEG 75%) to keep the PDF small,
 * then embedded as base64 — one full page per photo (A4).
 * A per-page note (if any) is printed as a caption under the photo.
 * Returns the PDF bytes (base64) + size — no device file reads needed
 * downstream, so Expo Go cache-permission issues can't break the upload.
 */
export async function buildInvoicePdf(
  pages: InvoicePage[],
  onProgress?: (message: string) => void
): Promise<{ base64: string; byteLength: number }> {
  if (pages.length === 0) {
    throw new Error("Add at least one page first.");
  }
  if (pages.length > 20) {
    throw new Error("Maximum 20 pages per invoice.");
  }

  const built: Array<{ b64: string; note: string }> = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(`Preparing page ${i + 1} of ${pages.length}...`);
    const out = await manipulateAsync(
      pages[i].uri,
      [{ resize: { width: 1240 } }],
      { compress: 0.75, format: SaveFormat.JPEG, base64: true }
    );
    if (!out.base64) {
      throw new Error(`Could not process page ${i + 1}. Please retake it.`);
    }
    built.push({ b64: out.base64, note: pages[i].note.trim() });
  }

  onProgress?.("Generating PDF...");
  const pagesHtml = built
    .map(
      (p, i) =>
        `<div class="page"><div class="pageno">Page ${i + 1} of ${built.length}</div>` +
        `<img src="data:image/jpeg;base64,${p.b64}" />` +
        (p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : "") +
        `</div>`
    )
    .join("");
  const html = `<html><head><meta charset="utf-8" /><style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; font-family: sans-serif; }
    .page { width: 100%; page-break-after: always; display: flex; flex-direction: column; align-items: center; padding: 24px; box-sizing: border-box; }
    .page:last-child { page-break-after: auto; }
    .pageno { font-size: 12px; color: #888; margin-bottom: 8px; }
    img { max-width: 100%; max-height: 82vh; object-fit: contain; }
    .note { margin-top: 12px; font-size: 15px; color: #111; background: #fef9c3; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; max-width: 100%; white-space: pre-wrap; word-break: break-word; }
  </style></head><body>${pagesHtml}</body></html>`;

  const { base64 } = await printToFileAsync({ html, base64: true });
  if (!base64 || base64.length < 100) {
    throw new Error("Could not generate the PDF. Please try again.");
  }
  // base64 length -> byte length (4 base64 chars = 3 bytes, minus padding)
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor((base64.length * 3) / 4) - padding;
  return { base64, byteLength };
}

/**
 * 5. My outlets (for the upload outlet picker). Empty = no outlets yet.
 */
export async function getMyOutlets(): Promise<Array<{ id: string; name: string }>> {
  if (!clientAuthToken) {
    throw new Error("Client is not authenticated. Please log in first.");
  }
  const response = await fetch(`${currentApiBaseUrl}/api/client-outlets`, {
    method: "GET",
    headers: { Authorization: `Bearer ${clientAuthToken}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch outlets.");
  }
  return data.outlets;
}
/**
 * 6. My invoice history with status timelines (client's own rows only).
 */
export async function getMyInvoices() {
  if (!clientAuthToken) {
    throw new Error("Client is not authenticated. Please log in first.");
  }

  const response = await fetch(`${currentApiBaseUrl}/api/client-invoices`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${clientAuthToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch history.");
  }
  return data.invoices as Array<{
    id: string;
    status: string;
    priority: string;
    outlet: { id: string; name: string } | null;
    ocrData: { amount?: number | string | null; invoiceNo?: string | null; vendor?: string | null; date?: string | null; confidence?: number | null } | null;
    createdAt: string;
    updatedAt: string;
    statusLogs: Array<{ status: string; note?: string | null; timestamp: string }>;
  }>;
}

/**
 * 7. Confirm Upload with backend (idempotent per s3Key — safe to retry).
 * Optional overall note + per-page notes (index-aligned with PDF pages)
 * + optional outlet the invoice belongs to.
 */
export async function confirmInvoiceUpload(s3Key: string, note?: string, pageNotes?: string[], outletId?: string) {
  if (!clientAuthToken) {
    throw new Error("Client is not authenticated. Please log in first.");
  }

  const trimmedNote = note?.trim() ? note.trim() : undefined;
  const trimmedPages = pageNotes?.map((n) => (n || "").trim().slice(0, 500));
  const body: Record<string, unknown> = { s3Key };
  if (trimmedNote) body.note = trimmedNote;
  if (trimmedPages && trimmedPages.some((n) => n.length > 0)) body.pageNotes = trimmedPages;
  if (outletId) body.outletId = outletId;
  const response = await fetch(`${currentApiBaseUrl}/api/invoices/confirm-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientAuthToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to confirm upload.");
  }
  return data;
}
