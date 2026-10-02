import { readFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "plugin");
const distDir = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(pluginDir, "plugin.json"), "utf8"));
const outputZip = path.join(distDir, `Spoolman-for-Duet-${manifest.version}.zip`);
await mkdir(distDir, { recursive: true });
if (existsSync(outputZip)) await rm(outputZip);
const result = process.platform === "win32"
  ? spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path "${path.join(pluginDir, "*")}" -DestinationPath "${outputZip}"`], { stdio: "inherit" })
  : spawnSync("zip", ["-r", outputZip, "."], { cwd: pluginDir, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Plugin artifact created: ${outputZip}`);
