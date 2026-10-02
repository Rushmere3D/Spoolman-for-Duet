import { readFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "server");
const distDir = path.join(root, "dist");
const pkg = JSON.parse(await readFile(path.join(serverDir, "package.json"), "utf8"));
const outputZip = path.join(distDir, `spoolman-for-duet-bridge-${pkg.version}.zip`);
await mkdir(distDir, { recursive: true });
if (existsSync(outputZip)) await rm(outputZip);
const includeList = ["src", "package.json", "Dockerfile"];
const result = process.platform === "win32"
  ? spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path ${includeList.map(x => `"${path.join(serverDir,x)}"`).join(",")} -DestinationPath "${outputZip}"`], { stdio: "inherit" })
  : spawnSync("zip", ["-r", outputZip, ...includeList], { cwd: serverDir, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Bridge artifact created: ${outputZip}`);
