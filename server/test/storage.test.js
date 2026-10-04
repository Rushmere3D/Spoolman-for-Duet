import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function createTestStorage() {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "spoolman-storage-test-")
  );

  process.env.SPOOLMAN_DATA_DIR = dataDir;

  const moduleUrl = new URL(
    `../src/lib/storage.js?test=${Date.now()}-${Math.random()}`,
    import.meta.url
  );

  const storage = await import(moduleUrl.href);

  return {
    dataDir,
    storage
  };
}

test("tracking state recovers from an empty file", async () => {
  const { dataDir, storage } = await createTestStorage();

  try {
    const trackingFile = path.join(dataDir, "tracking-state.json");

    await fs.writeFile(trackingFile, "", "utf-8");

    const state = await storage.loadTrackingState();

    assert.equal(state.trackingEnabled, true);
    assert.deepEqual(state.lastExtruderPositions, []);
    assert.deepEqual(state.totalTrackedMmByTool, {});
    assert.deepEqual(state.totalReportedMmByTool, {});
    assert.equal(state.lastMachineStatus, "");
    assert.equal(state.lastPollAt, null);
    assert.equal(state.lastError, null);
    assert.equal(state.lastEvent, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("tracking state recovers from invalid JSON", async () => {
  const { dataDir, storage } = await createTestStorage();

  try {
    const trackingFile = path.join(dataDir, "tracking-state.json");

    await fs.writeFile(
      trackingFile,
      "{ this is not valid json",
      "utf-8"
    );

    const state = await storage.loadTrackingState();

    assert.equal(state.trackingEnabled, true);
    assert.deepEqual(state.lastExtruderPositions, []);
    assert.deepEqual(state.totalTrackedMmByTool, {});
    assert.deepEqual(state.totalReportedMmByTool, {});
    assert.equal(state.lastMachineStatus, "");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("valid tracking state loads normally", async () => {
  const { dataDir, storage } = await createTestStorage();

  try {
    const trackingFile = path.join(dataDir, "tracking-state.json");

    await fs.writeFile(
      trackingFile,
      JSON.stringify({
        trackingEnabled: true,
        lastExtruderPositions: [123.4],
        totalTrackedMmByTool: { T0: 50 },
        totalReportedMmByTool: { T0: 49 },
        lastMachineStatus: "processing",
        lastPollAt: "2026-10-04T12:00:00.000Z",
        lastError: null,
        lastEvent: "Test event"
      }),
      "utf-8"
    );

    const state = await storage.loadTrackingState();

    assert.deepEqual(state.lastExtruderPositions, [123.4]);
    assert.equal(state.totalTrackedMmByTool.T0, 50);
    assert.equal(state.totalReportedMmByTool.T0, 49);
    assert.equal(state.lastMachineStatus, "processing");
    assert.equal(state.lastEvent, "Test event");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("saving tracking state produces valid JSON", async () => {
  const { dataDir, storage } = await createTestStorage();

  try {
    const trackingFile = path.join(dataDir, "tracking-state.json");

    await storage.saveTrackingState({
      trackingEnabled: true,
      lastExtruderPositions: [456.7],
      totalTrackedMmByTool: { T0: 100 },
      totalReportedMmByTool: { T0: 100 },
      lastMachineStatus: "processing",
      lastPollAt: "2026-10-04T12:00:00.000Z",
      lastError: null,
      lastEvent: "Saved successfully"
    });

    const content = await fs.readFile(trackingFile, "utf-8");
    const parsed = JSON.parse(content);

    assert.deepEqual(parsed.lastExtruderPositions, [456.7]);
    assert.equal(parsed.totalTrackedMmByTool.T0, 100);
    assert.equal(parsed.totalReportedMmByTool.T0, 100);
    assert.equal(parsed.lastMachineStatus, "processing");

    await assert.rejects(
      fs.access(`${trackingFile}.tmp`)
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
