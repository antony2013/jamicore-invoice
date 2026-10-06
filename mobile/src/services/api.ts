// Mobile API Service communicating with Jamicore Backend
// Client auth: admin-created user ID + password (no OTP).
import { manipulateAsync, SaveFormat, FlipType } from "expo-image-manipulator";
import { printToFileAsync } from "expo-print";

// Production backend. Override anytime from inside the app (tap the API badge).
// Release builds (!__DEV__) are LOCKED to the production URL from app config
// (extra.apiBaseUrl) — the in-app switcher is hidden and custom URLs ignored.
declare const __DEV__: boolean;

function productionBaseUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default;
    const extra = (Constants?.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
    if (typeof extra.apiBaseUrl === "string" && extra.apiBaseUrl.startsWith("https://")) {
      return extra.apiBaseUrl.replace(/\/+$/, "");
    }
  } catch {
    // Fall through to the compiled default below.
  }
  return "https://ac.jamicore.com";
}

let currentApiBaseUrl = __DEV__ ? "https://ac.jamicore.com" : productionBaseUrl();

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
const CLIENT_KEY = "jamicore_client_profile";

export function setApiBaseUrl(url: string) {
  const clean = url.replace(/\/+$/, "");
  // Release lock: only https production URLs are accepted outside dev.
  if (!__DEV__ && clean !== productionBaseUrl()) {
    return;
  }
  currentApiBaseUrl = clean;
}

export function getApiBaseUrl(): string {
  return currentApiBaseUrl;
}

/**
 * Backend fetch with central session-expiry handling: a 401 clears the
 * stored token and throws a SESSION_EXPIRED error so the app can send the
 * user back to login instead of sitting on a dead session.
 * (Presigned S3 calls keep raw fetch — their 401s are not session issues.)
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 401) {
    await setAuthToken(null);
    throw new Error("SESSION_EXPIRED:Please sign in again.");
  }
  return response;
}

export function isSessionExpired(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("SESSION_EXPIRED:");
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

/**
 * Restore the full session (token + client profile) on app launch.
 */
export async function loadPersistedSession(): Promise<{ token: string; client: any } | null> {
  if (!secureStore) return null;
  try {
    const [token, clientJson] = await Promise.all([
      secureStore.getItemAsync(TOKEN_KEY),
      secureStore.getItemAsync(CLIENT_KEY),
    ]);
    if (!token || !clientJson) return null;
    clientAuthToken = token;
    return { token, client: JSON.parse(clientJson) };
  } catch {
    return null;
  }
}

export async function setAuthToken(token: string | null) {
  clientAuthToken = token;
  if (secureStore) {
    try {
      if (token) await secureStore.setItemAsync(TOKEN_KEY, token);
      else {
        await secureStore.deleteItemAsync(TOKEN_KEY);
        await secureStore.deleteItemAsync(CLIENT_KEY);
      }
    } catch {
      // In-memory token remains usable for this session
    }
  }
}

export async function setPersistedClient(client: any | null) {
  if (!secureStore) return;
  try {
    if (client) await secureStore.setItemAsync(CLIENT_KEY, JSON.stringify(client));
    else await secureStore.deleteItemAsync(CLIENT_KEY);
  } catch {
    // Profile restore is best-effort; token still works
  }
}

export async function logout() {
  await setAuthToken(null);
  await setPersistedClient(null);
}

/**
 * 1. Login with admin-provided user ID + password. Persists JWT to SecureStore.
 */
export async function loginWithPassword(username: string, password: string) {
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Login failed.");
  }

  await setAuthToken(data.token);
  await setPersistedClient(data.client ?? null);
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

  const response = await apiFetch(`${currentApiBaseUrl}/api/invoices/upload-url`, {
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
/**
 * Base64 → bytes without atob() (not guaranteed on Hermes/native).
 */
function base64ToBytes(base64: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) lookup[chars[i]] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const len = Math.floor((clean.length * 3) / 4) - pad;
  const bytes = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean[i]] ?? 0;
    const b = lookup[clean[i + 1]] ?? 0;
    const c = lookup[clean[i + 2]] ?? 0;
    const d = lookup[clean[i + 3]] ?? 0;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < len) bytes[p++] = (triple >> 16) & 0xff;
    if (p < len) bytes[p++] = (triple >> 8) & 0xff;
    if (p < len) bytes[p++] = triple & 0xff;
  }
  return bytes;
}

export async function uploadBytesToS3(uploadUrl: string, base64: string, contentType: string) {
  if (!base64 || base64.length < 100) {
    throw new Error("Generated file is empty. Please try again.");
  }
  // base64 -> bytes (Hermes-safe decoder, no atob)
  const bytes = base64ToBytes(base64);
  const len = bytes.length;
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

export type InvoicePage = { uri: string; note: string; rotation: 0 | 90 | 180 | 270; flipH: boolean };

export type InvoiceCategory =
  | "sales_invoice"
  | "purchase_bill"
  | "expense_bill"
  | "asset_bill"
  | "other";

export const CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  sales_invoice: "Sales Invoice",
  purchase_bill: "Purchase Bill",
  expense_bill: "Expense Bill",
  asset_bill: "Asset Bill",
  other: "Other",
};

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
    const actions: Array<{ rotate: number } | { flip: FlipType } | { resize: { width?: number } }> = [];
    if (pages[i].rotation) actions.push({ rotate: pages[i].rotation });
    if (pages[i].flipH) actions.push({ flip: FlipType.Horizontal });
    actions.push({ resize: { width: 1240 } });
    const out = await manipulateAsync(
      pages[i].uri,
      actions as any,
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
export type Outlet = {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  createdByName?: string | null;
};

export async function getMyOutlets(): Promise<Outlet[]> {
  if (!clientAuthToken) {
    throw new Error("Client is not authenticated. Please log in first.");
  }
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-outlets`, {
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

  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices`, {
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
    category?: string | null;
    categoryDetail?: string | null;
    clientNote?: string | null;
    pageNotes?: string[] | null;
    uploadedByName?: string | null;
    deletableUntil?: string | null;
    ocrData: { amount?: number | string | null; invoiceNo?: string | null; vendor?: string | null; date?: string | null; confidence?: number | null } | null;
    createdAt: string;
    updatedAt: string;
    statusLogs: Array<{ status: string; note?: string | null; timestamp: string }>;
    /** Office Excel report (null until staff shares one) */
    report?: { fileName: string; createdAt: string } | null;
    /** Unread staff messages on this invoice's thread */
    unreadMessages?: number;
  }>;
}

export type InvoiceMessage = {
  id: string;
  senderType: string;
  senderName: string;
  kind: string;
  body: string;
  mine: boolean;
  createdAt: string;
};

/**
 * 14. Office Excel report for one of my invoices (download URL, 5-min TTL).
 */
export async function getMyInvoiceReportUrl(id: string): Promise<{ fileName: string; createdAt: string; downloadUrl: string } | null> {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices/${id}/report`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch report.");
  }
  return data.report;
}

/**
 * Download the report file and open the share sheet (Save / Open in Excel).
 */
export async function downloadAndShareReport(downloadUrl: string, fileName: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require("expo-file-system/legacy");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require("expo-sharing");
  const safeName = fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  const target = `${FileSystem.documentDirectory}${safeName}`;
  const dl = await FileSystem.downloadAsync(downloadUrl, target);
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(dl.uri, {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: "Excel report",
  });
}

/**
 * 15. Per-invoice conversation thread with the office.
 */
export async function getInvoiceMessages(id: string): Promise<InvoiceMessage[]> {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices/${id}/messages`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch messages.");
  }
  return data.messages;
}

export async function sendInvoiceMessage(id: string, body: string): Promise<InvoiceMessage> {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ body, kind: "text" }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to send message.");
  }
  return data.message;
}

/**
 * One-tap "please share the Excel report for this invoice".
 */
export async function requestInvoiceReport(id: string): Promise<InvoiceMessage> {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind: "request_report" }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to request report.");
  }
  return data.message;
}

export type TeamMember = {
  id: string;
  name: string;
  username: string;
  isActive: boolean;
  /** Outlet/branch this member works at (null = all/unspecified) */
  outletId?: string | null;
  outletName?: string | null;
  createdAt: string;
};

/**
 * 12. Team management (client OWNER only — staff get 403).
 */
export async function getTeam(): Promise<TeamMember[]> {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-team`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch team.");
  }
  return data.team;
}

export async function addTeamMember(
  name: string,
  username: string,
  pin: string,
  outletId?: string | null
) {
  const token = requireAuth();
  const body: Record<string, unknown> = { name, username, pin };
  if (outletId) body.outletId = outletId;
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-team`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to add team member.");
  }
  return data;
}

export async function updateTeamMember(
  id: string,
  update: { name?: string; pin?: string; isActive?: boolean; outletId?: string | null }
) {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-team/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(update),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to update team member.");
  }
  return data;
}

/**
 * 13. Team staff change their OWN PIN (owner uses Account screen instead).
 */
export async function changeMyPin(oldPin: string, newPin: string) {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-team/change-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ oldPin, newPin }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to change PIN.");
  }
  return data;
}

/**
 * 7. Confirm Upload with backend (idempotent per s3Key — safe to retry).
 * Optional overall note + per-page notes (index-aligned with PDF pages)
 * + optional outlet the invoice belongs to.
 */
export async function confirmInvoiceUpload(
  s3Key: string,
  note?: string,
  pageNotes?: string[],
  outletId?: string,
  category?: InvoiceCategory,
  categoryDetail?: string
) {
  if (!clientAuthToken) {
    throw new Error("Client is not authenticated. Please log in first.");
  }

  const trimmedNote = note?.trim() ? note.trim() : undefined;
  const trimmedPages = pageNotes?.map((n) => (n || "").trim().slice(0, 500));
  const body: Record<string, unknown> = { s3Key };
  if (trimmedNote) body.note = trimmedNote;
  if (trimmedPages && trimmedPages.some((n) => n.length > 0)) body.pageNotes = trimmedPages;
  if (outletId) body.outletId = outletId;
  if (category) body.category = category;
  if (category === "other" && categoryDetail?.trim()) {
    body.categoryDetail = categoryDetail.trim().slice(0, 200);
  }
  const response = await apiFetch(`${currentApiBaseUrl}/api/invoices/confirm-upload`, {
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

function requireAuth(): string {
  if (!clientAuthToken) {
    throw new Error("Client is not authenticated. Please log in first.");
  }
  return clientAuthToken;
}

/**
 * 8. Signed view URL for my own invoice document (image or PDF).
 */
export async function getMyInvoiceViewUrl(invoiceId: string) {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices/${invoiceId}/image-url`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to load document.");
  }
  return data as { url: string; expiresIn: number; contentType: string; isPdf: boolean };
}

export type ClientInvoiceUpdate = {
  note?: string | null;
  pageNotes?: string[];
  outletId?: string | null;
  category?: InvoiceCategory;
  categoryDetail?: string | null;
};

/**
 * 9. Edit my own invoice (notes/outlet). Only before the office takes it —
 * server returns 409 once assigned or beyond.
 */
export async function updateMyInvoice(invoiceId: string, update: ClientInvoiceUpdate) {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices/${invoiceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(update),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to update invoice.");
  }
  return data;
}

/**
 * 10. Withdraw my own upload (deletes record + file). Only before the
 * office takes it — server returns 409 once assigned or beyond.
 */
export async function deleteMyInvoice(invoiceId: string) {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-invoices/${invoiceId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to withdraw invoice.");
  }
  return data;
}

/**
 * 11. Change my own login password.
 */
export async function changeMyPassword(oldPassword: string, newPassword: string) {
  const token = requireAuth();
  const response = await apiFetch(`${currentApiBaseUrl}/api/client-auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to change password.");
  }
  return data;
}
