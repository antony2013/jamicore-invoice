import dotenv from "dotenv";
// NOTE: this repo keeps local config in `.env` (not `.env`), so load it
// explicitly. `dotenv/config` default-path loading would silently miss it.
dotenv.config({ path: ".env" });
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, closeDb } from "./index";
import { staff } from "./schema";

async function seed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
    console.error("Refusing to seed in production without ALLOW_SEED=true.");
    process.exit(1);
  }
  console.log("Seeding database with initial admin and staff users...");

  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@jamicore.com";
  const staffEmail = process.env.SEED_STAFF_EMAIL || "staff@jamicore.com";

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const staffPassword = process.env.SEED_STAFF_PASSWORD;
  if (!adminPassword || !staffPassword) {
    if (process.env.NODE_ENV === "production") {
      console.error("SEED_ADMIN_PASSWORD / SEED_STAFF_PASSWORD must be set in production.");
      process.exit(1);
    }
    console.warn("Using dev-only seed passwords (set SEED_*_PASSWORD to override).");
  }
  const passwordHash = await bcrypt.hash(adminPassword || "dev-admin-only-do-not-use", 10);
  const staffPasswordHash = await bcrypt.hash(staffPassword || "dev-staff-only-do-not-use", 10);

  // Check admin
  const existingAdmin = await db.query.staff.findFirst({
    where: eq(staff.email, adminEmail),
  });

  if (!existingAdmin) {
    await db.insert(staff).values({
      name: "System Admin",
      email: adminEmail,
      role: "admin",
      passwordHash: passwordHash,
    });
    console.log(`Created Admin: ${adminEmail} (password from SEED_ADMIN_PASSWORD)`);
  } else {
    console.log(`Admin user already exists: ${adminEmail}`);
  }

  // Check staff
  const existingStaff = await db.query.staff.findFirst({
    where: eq(staff.email, staffEmail),
  });

  if (!existingStaff) {
    await db.insert(staff).values({
      name: "Operations Staff",
      email: staffEmail,
      role: "staff",
      passwordHash: staffPasswordHash,
    });
    console.log(`Created Staff: ${staffEmail} (password from SEED_STAFF_PASSWORD)`);
  } else {
    console.log(`Staff user already exists: ${staffEmail}`);
  }

  console.log("Seeding completed successfully!");
  await closeDb();
}

seed().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
});
