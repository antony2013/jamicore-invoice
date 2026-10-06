/**
 * Credential rotation after the hash-exposure fix.
 * Hashes were served to browsers, so every credential must be rotated once
 * the fix is deployed.
 *
 *   npx tsx src/db/rotate-credentials.ts                       # dry run (DEFAULT)
 *   npx tsx src/db/rotate-credentials.ts --apply               # rotate for real
 *   npx tsx src/db/rotate-credentials.ts --apply --scope=staff # or clients|all (default all)
 *
 * staff scope:  sets a NEW random password per row (printed ONCE to stdout
 *               as a table — copy it now, it is never logged to files),
 *               bumps token_version (kills live sessions).
 * clients scope: sets clients.password_hash NULL + bumps token_version
 *               (owner cannot log in until admin sets a new password in
 *               /admin/clients); sets client_staff.pin_hash to a bcrypt hash
 *               of a random string + bumps token_version (owner resets PINs
 *               in the Team screen).
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import * as dotenv from "dotenv";
dotenv.config(); // local .env; production env passes through untouched
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, clientStaff, staff } from "@/db/schema";

function randomPassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

async function rotateStaff(apply: boolean) {
  const rows = await db.query.staff.findMany({ columns: { id: true, email: true, name: true } });
  console.log(`[rotate] staff rows: ${rows.length}`);
  const table: Array<{ email: string; newPassword: string }> = [];
  for (const row of rows) {
    const pw = randomPassword();
    table.push({ email: row.email, newPassword: pw });
    if (apply) {
      await db
        .update(staff)
        .set({ passwordHash: await bcrypt.hash(pw, 12), tokenVersion: sql`token_version + 1` })
        .where(eq(staff.id, row.id));
    }
  }
  if (apply) {
    console.log("[rotate] NEW STAFF PASSWORDS (copy now — shown once, never logged):");
    console.table(table);
  } else {
    console.log(`[rotate] dry run — ${rows.length} staff password(s) would rotate.`);
  }
}

async function rotateClients(apply: boolean) {
  const owners = await db.query.clients.findMany({ columns: { id: true, username: true, name: true } });
  const members = await db.query.clientStaff.findMany({ columns: { id: true, username: true, name: true } });
  console.log(`[rotate] client owners: ${owners.length}, team members: ${members.length}`);
  if (apply) {
    for (const o of owners) {
      await db
        .update(clients)
        .set({ passwordHash: null, tokenVersion: sql`token_version + 1` })
        .where(eq(clients.id, o.id));
    }
    for (const m of members) {
      const junk = await bcrypt.hash(randomPassword(), 12);
      await db
        .update(clientStaff)
        .set({ pinHash: junk, tokenVersion: sql`token_version + 1` })
        .where(eq(clientStaff.id, m.id));
    }
    console.log("[rotate] owners locked (password NULL — admin must set new passwords in /admin/clients).");
    console.log("[rotate] member PINs randomized (owner must reset PINs in the Team screen).");
  } else {
    console.log("[rotate] dry run — owners would lock, member PINs would randomize.");
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const scopeArg = process.argv.find((a) => a.startsWith("--scope="))?.split("=")[1] ?? "all";
  if (!["staff", "clients", "all"].includes(scopeArg)) {
    console.error("[rotate] --scope must be staff|clients|all");
    process.exit(1);
  }
  console.log(`[rotate] mode: ${apply ? "APPLY" : "dry-run"}, scope: ${scopeArg}`);
  if (!apply) {
    console.log("[rotate] WARNING: hashes were exposed — run with --apply after deploying the fix.");
  }
  if (scopeArg === "staff" || scopeArg === "all") await rotateStaff(apply);
  if (scopeArg === "clients" || scopeArg === "all") await rotateClients(apply);
  console.log("[rotate] done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[rotate] fatal:", e);
  process.exit(1);
});
