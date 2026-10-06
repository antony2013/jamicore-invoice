/**
 * Opaque keyset cursor: base64url(JSON { createdAt, id }).
 * Lists order by created_at DESC, id DESC; the cursor resumes strictly
 * after the last returned row (stable under concurrent inserts).
 */
export type ListCursor = { createdAt: string; id: string };

export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
  return Buffer.from(JSON.stringify({ createdAt: iso, id }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): ListCursor | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<ListCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
