import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../data");
const settingsFile = path.join(dataDir, "settings.json");
const trackingStateFile = path.join(dataDir, "tracking-state.json");

const defaultSettings = Object.freeze({
  version: "1.0.0-beta.1",
  language: "auto",
  spoolmanBaseUrl: "",
  hotendCount: 1,
  toolSpoolMap: {},
  rrf: {
    baseUrl: "",
    password: "reprap",
    pollIntervalMs: 4000
  }
});

const defaultTrackingState = Object.freeze({
  trackingEnabled: true,
  lastExtruderPositions: [],
  totalTrackedMmByTool: {},
  totalReportedMmByTool: {},
  lastPollAt: null,
  lastError: null,
  lastEvent: null
});

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function readJson(filePath, fallbackValue) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return structuredClone(fallbackValue);
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export async function loadSettings() {
  const loaded = await readJson(settingsFile, defaultSettings);
  return mergeSettings(loaded);
}

export async function saveSettings(nextSettings) {
  const merged = mergeSettings(nextSettings);
  await writeJson(settingsFile, merged);
  return merged;
}

export async function loadTrackingState() {
  const loaded = await readJson(trackingStateFile, defaultTrackingState);
  return mergeTrackingState(loaded);
}

export async function saveTrackingState(nextState) {
  const merged = mergeTrackingState(nextState);
  await writeJson(trackingStateFile, merged);
  return merged;
}

export function mergeSettings(input) {
  return {
    ...defaultSettings,
    ...input,
    toolSpoolMap: { ...(input?.toolSpoolMap ?? {}) },
    rrf: {
      ...defaultSettings.rrf,
      ...(input?.rrf ?? {})
    }
  };
}

export function mergeTrackingState(input) {
  return {
    ...defaultTrackingState,
    ...input,
    totalTrackedMmByTool: { ...(input?.totalTrackedMmByTool ?? {}) },
    totalReportedMmByTool: { ...(input?.totalReportedMmByTool ?? {}) },
    lastExtruderPositions: Array.isArray(input?.lastExtruderPositions)
      ? [...input.lastExtruderPositions]
      : []
  };
}
