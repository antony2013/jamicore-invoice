import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const jobs = [
  [".next/static", ".next/standalone/.next/static"],
  ["public", ".next/standalone/public"],
];

for (const [from, to] of jobs) {
  const src = path.join(root, from);
  const dst = path.join(root, to);
  try {
    await fs.access(src);
  } catch {
    continue;
  }
  await fs.rm(dst, { recursive: true, force: true });
  await fs.cp(src, dst, { recursive: true });
}
