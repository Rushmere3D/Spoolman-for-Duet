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
  ? spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `
    $ErrorActionPreference = 'Stop';
    Add-Type -AssemblyName System.IO.Compression;
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $source = '${pluginDir.replace(/'/g, "''")}';
    $destination = '${outputZip.replace(/'/g, "''")}';
    $archive = [System.IO.Compression.ZipFile]::Open($destination, 'Create');
    try {
      Get-ChildItem -LiteralPath $source -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($source.Length + 1).Replace('\\', '/');
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
          $archive, $_.FullName, $relative
        ) | Out-Null;
      };
    } finally {
      if ($null -ne $archive) {
        $archive.Dispose();
      }
    }
    `
  ], { stdio: "inherit" })
  : spawnSync("zip", ["-r", outputZip, "."], { cwd: pluginDir, stdio: "inherit" });
if (result.error) {
  console.error("Plugin ZIP build failed:", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("Plugin ZIP build failed.");
  process.exit(result.status ?? 1);
}
console.log(`Plugin artifact created: ${outputZip}`);
