function sanitizeBaseUrl(url) {
  return (url ?? "").trim().replace(/\/+$/, "");
}

function normalizeExtruderPositions(payload) {
  const move = payload?.result ?? payload?.move ?? payload;

  if (Array.isArray(move?.extruders)) {
    return move.extruders.map((value) => {
      if (typeof value === "number") {
        return Number(value) || 0;
      }
      if (value && typeof value === "object") {
        // RRF commonly returns objects like { position: 123.45, ... }.
        if (typeof value.position === "number" || typeof value.position === "string") {
          return Number(value.position) || 0;
        }
        if (typeof value.machinePosition === "number" || typeof value.machinePosition === "string") {
          return Number(value.machinePosition) || 0;
        }
      }
      return 0;
    });
  }

  if (Array.isArray(move?.axes)) {
    return move.axes.filter((axis) => axis?.letter === "E").map((axis) => Number(axis.machinePosition) || 0);
  }

  return [];
}

export function createRrfClient(config) {
  const baseUrl = sanitizeBaseUrl(config?.baseUrl);
  const password = config?.password ?? "";
  let sessionKey = "";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function connect() {
    if (!baseUrl) {
      throw new Error("RRF base URL is not configured");
    }

    const authQuery = password ? `?password=${encodeURIComponent(password)}&sessionKey=yes` : "?sessionKey=yes";
    const response = await fetch(`${baseUrl}/rr_connect${authQuery}`);
    if (!response.ok) {
      throw new Error(`RRF connect failed (${response.status})`);
    }
    const payload = await response.json();
    sessionKey = payload?.sessionKey ?? "";
  }

  async function fetchMoveModel() {
    if (!baseUrl) {
      throw new Error("RRF base URL is not configured");
    }

    if (!sessionKey) {
      await connect();
    }

    const headers = sessionKey ? { "X-Session-Key": sessionKey } : {};
    const retryDelaysMs = [0, 300, 800];

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      if (retryDelaysMs[attempt] > 0) {
        await sleep(retryDelaysMs[attempt]);
      }

      const response = await fetch(`${baseUrl}/rr_model?key=move`, { headers });
      if (response.status === 401 || response.status === 403) {
        sessionKey = "";
        await connect();
        return fetchMoveModel();
      }

      // RRF/DSF can intermittently return 503 while object model is busy.
      // Retry a couple of times and degrade gracefully if it persists.
      if (response.status === 503) {
        if (attempt < retryDelaysMs.length - 1) {
          continue;
        }
        return {
          raw: null,
          extruderPositions: []
        };
      }

      if (!response.ok) {
        throw new Error(`RRF rr_model failed (${response.status})`);
      }

      const payload = await response.json();
      return {
        raw: payload,
        extruderPositions: normalizeExtruderPositions(payload)
      };
    }

    return {
      raw: null,
      extruderPositions: []
    };
  }
  async function fetchStateModel() {
    if (!baseUrl) {
      throw new Error("RRF base URL is not configured");
    }

    if (!sessionKey) {
      await connect();
    }

    const headers = sessionKey ? { "X-Session-Key": sessionKey } : {};
    const retryDelaysMs = [0, 300, 800];

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      if (retryDelaysMs[attempt] > 0) {
        await sleep(retryDelaysMs[attempt]);
      }

      const response = await fetch(`${baseUrl}/rr_model?key=state`, { headers });

      if (response.status === 401 || response.status === 403) {
        sessionKey = "";
        await connect();
        return fetchStateModel();
      }

      if (response.status === 503) {
        if (attempt < retryDelaysMs.length - 1) {
          continue;
        }

        return {
          raw: null,
          status: ""
        };
      }

      if (!response.ok) {
        throw new Error(`RRF state rr_model failed (${response.status})`);
      }

      const payload = await response.json();
      const state = payload?.result ?? payload?.state ?? payload;

      return {
        raw: payload,
        status: String(state?.status ?? "")
      };
    }

    return {
      raw: null,
      status: ""
    };
  }
  return {
    connect,
    fetchMoveModel,
    fetchStateModel
  };
}
