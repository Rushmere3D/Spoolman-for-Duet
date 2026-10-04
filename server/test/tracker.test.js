import test from "node:test";
import assert from "node:assert/strict";
import { createTracker } from "../src/tracking/tracker.js";

test("tracker sends positive filament deltas to spoolman", async () => {
  const calls = [];
  let connectCalls = 0;
  let modelCalls = 0;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes("/rr_connect")) {
      connectCalls += 1;
      return {
        ok: true,
        json: async () => ({ sessionKey: "abc123" })
      };
    }
if (url.includes("/rr_model?key=state")) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: { status: "processing" } })
  };
}

if (url.includes("/rr_model?key=move")) {
  modelCalls += 1;
  const extruders = modelCalls === 1 ? [100, 20] : [106, 19];
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: { extruders } })
  };
}
    if (url.includes("/api/v1/spool/")) {
      return {
        ok: true,
        json: async () => ({ ok: true })
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  let settings = {
    spoolmanBaseUrl: "http://spoolman:7912",
    toolSpoolMap: { T0: 10, T1: 11 },
    rrf: { baseUrl: "http://duet", password: "", pollIntervalMs: 5000 }
  };
  let state = {
    trackingEnabled: true,
    lastExtruderPositions: [],
    totalTrackedMmByTool: {},
    totalReportedMmByTool: {},
    lastMachineStatus: "processing"
  };

  const tracker = createTracker({
    getSettings: () => settings,
    saveSettings: async (next) => {
      settings = next;
      return settings;
    },
    getTrackingState: () => state,
    saveTrackingState: async (next) => {
      state = next;
      return state;
    }
  });

  await tracker.pollNow();
  await tracker.pollNow();

  const useCalls = calls.filter((entry) => entry.url.includes("/api/v1/spool/"));
  assert.equal(connectCalls >= 1, true);
  assert.equal(useCalls.length, 1);
  assert.equal(useCalls[0].url.includes("/api/v1/spool/10/use"), true);
  assert.equal(JSON.parse(useCalls[0].options.body).use_length, 6);
  assert.equal(state.totalTrackedMmByTool.T0, 6);
});
test("idle extrusion is reported to spoolman but not counted toward print totals", async () => {
  const calls = [];
  let modelCalls = 0;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes("/rr_connect")) {
      return {
        ok: true,
        json: async () => ({ sessionKey: "abc123" })
      };
    }

    if (url.includes("/rr_model?key=state")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { status: "idle" } })
      };
    }

    if (url.includes("/rr_model?key=move")) {
      modelCalls += 1;
      const extruders = modelCalls === 1 ? [100] : [106];

      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { extruders } })
      };
    }

    if (url.includes("/api/v1/spool/")) {
      return {
        ok: true,
        json: async () => ({ ok: true })
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  let settings = {
    spoolmanBaseUrl: "http://spoolman:7912",
    toolSpoolMap: { T0: 10 },
    rrf: { baseUrl: "http://duet", password: "", pollIntervalMs: 5000 }
  };

  let state = {
    trackingEnabled: true,
    lastExtruderPositions: [],
    totalTrackedMmByTool: {},
    totalReportedMmByTool: {},
    lastMachineStatus: "idle"
  };

  const tracker = createTracker({
    getSettings: () => settings,
    saveSettings: async (next) => {
      settings = next;
      return settings;
    },
    getTrackingState: () => state,
    saveTrackingState: async (next) => {
      state = next;
      return state;
    }
  });

  await tracker.pollNow();
  await tracker.pollNow();

  const useCalls = calls.filter((entry) =>
    entry.url.includes("/api/v1/spool/")
  );

  assert.equal(useCalls.length, 1);
  assert.equal(JSON.parse(useCalls[0].options.body).use_length, 6);

  assert.equal(state.totalTrackedMmByTool.T0, undefined);
  assert.equal(state.totalReportedMmByTool.T0, undefined);
  assert.equal(state.lastMachineStatus, "idle");
});


test("idle to processing starts a new print and resets previous counters", async () => {
  const calls = [];
  let stateCalls = 0;
  let modelCalls = 0;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes("/rr_connect")) {
      return {
        ok: true,
        json: async () => ({ sessionKey: "abc123" })
      };
    }

    if (url.includes("/rr_model?key=state")) {
      stateCalls += 1;
      const status = stateCalls === 1 ? "idle" : "processing";

      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { status } })
      };
    }

    if (url.includes("/rr_model?key=move")) {
      modelCalls += 1;
      const extruders = modelCalls === 1 ? [100] : [106];

      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { extruders } })
      };
    }

    if (url.includes("/api/v1/spool/")) {
      return {
        ok: true,
        json: async () => ({ ok: true })
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  let settings = {
    spoolmanBaseUrl: "http://spoolman:7912",
    toolSpoolMap: { T0: 10 },
    rrf: { baseUrl: "http://duet", password: "", pollIntervalMs: 5000 }
  };

  let state = {
    trackingEnabled: true,
    lastExtruderPositions: [],
    totalTrackedMmByTool: { T0: 500 },
    totalReportedMmByTool: { T0: 500 },
    lastMachineStatus: "idle"
  };

  const tracker = createTracker({
    getSettings: () => settings,
    saveSettings: async (next) => {
      settings = next;
      return settings;
    },
    getTrackingState: () => state,
    saveTrackingState: async (next) => {
      state = next;
      return state;
    }
  });

  await tracker.pollNow();

  // The printer is still idle, so the previous print totals remain.
  assert.equal(state.totalTrackedMmByTool.T0, 500);
  assert.equal(state.totalReportedMmByTool.T0, 500);

  await tracker.pollNow();

  // idle -> processing starts a new print. The old 500 mm totals
  // are discarded and only the new print's 6 mm is counted.
  assert.equal(state.totalTrackedMmByTool.T0, 6);
  assert.equal(state.totalReportedMmByTool.T0, 6);
  assert.equal(state.lastMachineStatus, "processing");

  const useCalls = calls.filter((entry) =>
    entry.url.includes("/api/v1/spool/")
  );

  assert.equal(useCalls.length, 1);
  assert.equal(JSON.parse(useCalls[0].options.body).use_length, 6);
});
