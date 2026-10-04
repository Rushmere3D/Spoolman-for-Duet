import { createRrfClient } from "../lib/rrf-client.js";
import { createSpoolmanClient } from "../lib/spoolman-client.js";

function toolKey(toolIndex) {
  return `T${toolIndex}`;
}
function isPrintActive(status) {
  return [
    "processing",
    "paused",
    "pausing",
    "resuming"
  ].includes(String(status ?? "").toLowerCase());
}

const MAX_REASONABLE_DELTA_MM = 1000;
export function createTracker({ getSettings, saveSettings, getTrackingState, saveTrackingState }) {
  let intervalHandle = null;
  let running = false;

  async function pollOnce() {
    const settings = getSettings();
    const trackingState = getTrackingState();

    if (!trackingState.trackingEnabled) {
      return;
    }
    if (!settings.spoolmanBaseUrl || !settings.rrf.baseUrl) {
      return;
    }

    const rrf = createRrfClient(settings.rrf);
    const spoolman = createSpoolmanClient(settings.spoolmanBaseUrl);
    const stateModel = await rrf.fetchStateModel();
    const moveModel = await rrf.fetchMoveModel();

    const positions = moveModel.extruderPositions;
    const currentStatus = stateModel.status;
    const previousStatus = trackingState.lastMachineStatus ?? "";
    const currentlyPrinting = isPrintActive(currentStatus);
    const previouslyPrinting = isPrintActive(previousStatus);

    const newPrintStarted =
      String(currentStatus).toLowerCase() === "processing" &&
      String(previousStatus).toLowerCase() === "idle";

    const countTowardPrint = currentlyPrinting || previouslyPrinting;
    if (!positions.length) {
      return;
    }
    if ((Number(settings.hotendCount) || 0) !== positions.length) {
      await saveSettings({
        ...settings,
        hotendCount: positions.length
      });
    }

    const previous = trackingState.lastExtruderPositions;

    const nextTotals = newPrintStarted
      ? {}
      : { ...trackingState.totalTrackedMmByTool };

    const nextReportedTotals = newPrintStarted
      ? {}
      : { ...trackingState.totalReportedMmByTool };

    const pollEvents = [];

    if (newPrintStarted) {
      pollEvents.push(`New print detected (${previousStatus || "unknown"} -> ${currentStatus}); counters reset`);
    }
    let pollError = null;
    let hadPositiveDelta = false;

    for (let i = 0; i < positions.length; i += 1) {
      const current = Number(positions[i]) || 0;
      const last = Number(previous[i] ?? current);
      const delta = current - last;

      if (delta <= 0) {
        continue;
      }

      if (delta > MAX_REASONABLE_DELTA_MM) {
        pollEvents.push(
          `${toolKey(i)}: ignored implausible ${delta.toFixed(2)}mm extrusion jump`
        );
        continue;
      }

      hadPositiveDelta = true;

      const assignedSpoolId = Number(settings.toolSpoolMap[toolKey(i)]);
      const key = toolKey(i);
      if (countTowardPrint) {
      nextTotals[key] = (Number(nextTotals[key]) || 0) + delta;
      }

      if (assignedSpoolId > 0) {
        try {
      await spoolman.useSpoolLengthMm(assignedSpoolId, delta);

      if (countTowardPrint) {
      nextReportedTotals[key] = (Number(nextReportedTotals[key]) || 0) + delta;
      }

      pollEvents.push(`${key}: reported ${delta.toFixed(2)}mm to spool #${assignedSpoolId}`);
        } catch (error) {
          pollError = `${key}: failed to report to spool #${assignedSpoolId}: ${error.message}`;
          pollEvents.push(`${key}: report failed`);
        }
      } else {
        pollEvents.push(`${key}: measured ${delta.toFixed(2)}mm (no spool assigned)`);
      }
    }

    if (!hadPositiveDelta) {
      pollEvents.push("No positive extrusion delta detected");
    }

    await saveTrackingState({
      ...trackingState,
      lastExtruderPositions: positions,
      lastMachineStatus: currentStatus || previousStatus,
      totalTrackedMmByTool: nextTotals,
      totalReportedMmByTool: nextReportedTotals,
      lastPollAt: new Date().toISOString(),
      lastError: pollError,
      lastEvent: pollEvents.join(" | ")
    });
  }

  async function safePoll() {
    try {
      await pollOnce();
    } catch (error) {
      const state = getTrackingState();
      if (!state.trackingEnabled) {
        await saveTrackingState({
          ...state,
          lastError: null,
          lastEvent: "Tracking disabled",
          lastPollAt: new Date().toISOString()
        });
        return;
      }
      await saveTrackingState({
        ...state,
        lastError: error.message,
        lastEvent: `Poll failed: ${error.message}`,
        lastPollAt: new Date().toISOString()
      });
    }
  }

  function start() {
    if (running) {
      return;
    }
    running = true;

    const pollIntervalMs = Math.max(1000, Number(getSettings().rrf.pollIntervalMs) || 4000);
    intervalHandle = setInterval(() => {
      void safePoll();
    }, pollIntervalMs);
    void safePoll();
  }

  function stop() {
    running = false;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function isRunning() {
    return running;
  }

  return {
    start,
    stop,
    isRunning,
    pollNow: safePoll
  };
}
