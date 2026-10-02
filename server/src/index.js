import express from "express";
import cors from "cors";
import { loadSettings, loadTrackingState, saveSettings, saveTrackingState, mergeSettings } from "./lib/storage.js";
import { resolveLanguage, getMessages } from "./lib/i18n.js";
import { createSpoolmanClient } from "./lib/spoolman-client.js";
import { createTracker } from "./tracking/tracker.js";
import { startMdnsAdvertisement } from "./lib/mdns.js";
import { buildBridgeBaseUrls, getLanIPv4Addresses } from "./lib/network.js";

const SERVER_VERSION = "1.0.0-beta.1";
const PORT = Number(process.env.PORT) || 9377;

const app = express();
app.use(cors());
app.use(express.json());

let settings = await loadSettings();
let trackingState = await loadTrackingState();

const tracker = createTracker({
  getSettings: () => settings,
  saveSettings: async (nextSettings) => {
    settings = await saveSettings(nextSettings);
    return settings;
  },
  getTrackingState: () => trackingState,
  saveTrackingState: async (nextState) => {
    trackingState = await saveTrackingState(nextState);
    return trackingState;
  }
});

function sanitizeSettingsUpdate(input) {
  const next = { ...input };
  if (next.language && !["auto", "en", "da"].includes(next.language)) {
    throw new Error("language must be auto, en or da");
  }
  if (next.hotendCount !== undefined) {
    const parsed = Number(next.hotendCount);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
      throw new Error("hotendCount must be an integer between 1 and 16");
    }
    next.hotendCount = parsed;
  }
  if (next.spoolmanBaseUrl !== undefined && typeof next.spoolmanBaseUrl !== "string") {
    throw new Error("spoolmanBaseUrl must be a string");
  }
  if (next.toolSpoolMap !== undefined && typeof next.toolSpoolMap !== "object") {
    throw new Error("toolSpoolMap must be an object");
  }
  if (next.rrf !== undefined) {
    const merged = { ...settings.rrf, ...next.rrf };
    merged.pollIntervalMs = Math.max(1000, Number(merged.pollIntervalMs) || 4000);
    next.rrf = merged;
  }
  return next;
}

function getDiscoveryPayload() {
  const lanAddresses = getLanIPv4Addresses();
  const knownPorts = Array.from(new Set([PORT, 9377, 9378]));
  const suggestedUrls = [];
  for (const address of lanAddresses) {
    for (const port of knownPorts) {
      suggestedUrls.push(`http://${address}:${port}`);
    }
  }
  return {
    method: "lan-ip-preferred",
    mdnsHostname: "spoolman-bridge.local",
    port: PORT,
    lanAddresses,
    suggestedUrls,
    mdnsUrls: knownPorts.map((port) => `http://spoolman-bridge.local:${port}`),
    fallback: "manual"
  };
}

app.get("/", (_req, res) => {
  const discovery = getDiscoveryPayload();
  res.json({
    service: "Spoolman for Duet Bridge",
    version: SERVER_VERSION,
    health: "/api/v1/health",
    api: "/api/v1",
    ...discovery,
    note: "Root path has no UI. Use /api/v1/health or open this URL in the plugin."
  });
});

app.get("/api/v1/info", (_req, res) => {
  res.json({
    name: "Spoolman for Duet Bridge",
    version: SERVER_VERSION,
    apiVersion: "v1",
    discoveryHost: "spoolman-bridge.local",
    discoveryPort: PORT
  });
});

app.get("/api/v1/health", (_req, res) => {
  res.json({
    ok: true,
    trackingRunning: tracker.isRunning(),
    lastPollAt: trackingState.lastPollAt,
    lastError: trackingState.lastError
  });
});

app.get("/api/v1/settings", (req, res) => {
  const browserLocale = String(req.query.browserLocale ?? "");
  const resolvedLanguage = resolveLanguage(settings.language, browserLocale);
  res.json({
    settings,
    resolvedLanguage,
    messages: getMessages(resolvedLanguage)
  });
});

app.put("/api/v1/settings", async (req, res) => {
  try {
    const updates = sanitizeSettingsUpdate(req.body ?? {});
    settings = await saveSettings(mergeSettings({ ...settings, ...updates }));
    res.json({ settings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/v1/status", (_req, res) => {
  res.json({
    tracking: trackingState,
    trackingRunning: tracker.isRunning(),
    settingsSummary: {
      language: settings.language,
      spoolmanConfigured: Boolean(settings.spoolmanBaseUrl),
      rrfConfigured: Boolean(settings.rrf?.baseUrl),
      hotendCount: settings.hotendCount
    }
  });
});

app.post("/api/v1/tracking/start", async (_req, res) => {
  trackingState = await saveTrackingState({
    ...trackingState,
    trackingEnabled: true,
    lastEvent: "Tracking enabled"
  });
  tracker.start();
  res.json({ ok: true, trackingRunning: tracker.isRunning() });
});

app.post("/api/v1/tracking/stop", async (_req, res) => {
  trackingState = await saveTrackingState({
    ...trackingState,
    trackingEnabled: false,
    lastError: null,
    lastEvent: "Tracking stopped by user"
  });
  tracker.stop();
  res.json({ ok: true, trackingRunning: tracker.isRunning() });
});

app.post("/api/v1/tracking/poll-now", async (_req, res) => {
  await tracker.pollNow();
  res.json({ ok: true, trackingState });
});

app.get("/api/v1/spools", async (_req, res) => {
  if (!settings.spoolmanBaseUrl) {
    res.status(400).json({ error: "spoolmanBaseUrl is not configured" });
    return;
  }
  try {
    const client = createSpoolmanClient(settings.spoolmanBaseUrl);
    const [info, health, spools] = await Promise.all([client.info(), client.health(), client.getSpools()]);
    res.json({
      info,
      health,
      spools
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.put("/api/v1/tools/:toolId/spool", async (req, res) => {
  const toolId = req.params.toolId.toUpperCase();
  const spoolId = Number(req.body?.spoolId);
  if (!/^T\d+$/.test(toolId) || !Number.isInteger(spoolId) || spoolId < 1) {
    res.status(400).json({ error: "Invalid toolId or spoolId" });
    return;
  }
  settings = await saveSettings(
    mergeSettings({
      ...settings,
      toolSpoolMap: {
        ...settings.toolSpoolMap,
        [toolId]: spoolId
      }
    })
  );
  res.json({ settings });
});

app.delete("/api/v1/tools/:toolId/spool", async (req, res) => {
  const toolId = req.params.toolId.toUpperCase();
  const nextMap = { ...settings.toolSpoolMap };
  delete nextMap[toolId];
  settings = await saveSettings(
    mergeSettings({
      ...settings,
      toolSpoolMap: nextMap
    })
  );
  res.json({ settings });
});

app.get("/api/v1/discovery", (_req, res) => {
  res.json(getDiscoveryPayload());
});

const mdns = startMdnsAdvertisement({ port: PORT, version: SERVER_VERSION });
const server = app.listen(PORT, () => {
  console.log(`Spoolman for Duet bridge ${SERVER_VERSION} listening on port ${PORT}`);
});

if (trackingState.trackingEnabled) {
  tracker.start();
}

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down...`);
    tracker.stop();
    mdns.close();
    const forceExit = setTimeout(() => process.exit(0), 3000);
    forceExit.unref();
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}
