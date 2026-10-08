import { spawn } from "node:child_process";

process.env.HOSTNAME ??= "0.0.0.0";
process.env.PORT ??= "3000";

const child = spawn(process.execPath, [".next/standalone/server.js"], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
