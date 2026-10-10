/* Spoolman for Duet - DWC 3.7 plugin */
(function () {
  "use strict";

  if (!window.DWC || !window.DWC.Vue || typeof window.DWC.registerRoute !== "function") {
    console.error("Spoolman: DWC 3.7 plugin API is not available");
    return;
  }

  var DWC = window.DWC;

var SpoolmanComponent = {
  name: "Spoolman",
  data: function () {
    return {
      version: "1.0.0-beta.4",
      serverUrl: "",
      bridgeVersion: "",
      manualServerUrl: "",
      connected: false,
      loading: false,
      error: "",
      success: "",
      settings: {
        language: "auto",
        spoolmanBaseUrl: "",
        hotendCount: 1,
        toolSpoolMap: {},
        rrf: {
          baseUrl: "",
          password: "reprap",
          pollIntervalMs: 4000
        }
      },
      resolvedLanguage: "en",
      messages: {},
      trackingRunning: false,
      trackingState: {
        totalTrackedMmByTool: {},
        lastPollAt: null,
        lastError: null
      },
      spools: [],
      openToolDropdown: "",
      spoolSearch: "",
      availableOnly: false,
      lowFilamentThreshold: 100,
      settingsExpanded: false,
      trackingActionBusy: false,
      discoveryBusy: false,
      statusRefreshTimer: null,
      spoolRefreshTimer: null,
      spoolRefreshBusy: false
    };
  },
  methods: {
    apiUrl: function (path) {
      return this.serverUrl.replace(/\/+$/, "") + path;
    },
    browserLocale: function () {
      return navigator.language || "en";
    },
    t: function (key, fallback) {
      var msg = this.messages && this.messages[key];
      return typeof msg === "string" && msg.length > 0 ? msg : (fallback || key);
    },
    formatMessage: function (key, fallback, values) {
      var template = this.t(key, fallback);
      var finalValues = values || {};
      return template.replace(/\{(\w+)\}/g, function (_m, token) {
        return finalValues[token] !== undefined ? String(finalValues[token]) : "";
      });
    },
    normalizeHexColor: function (value) {
      var raw = String(value || "").trim().replace("#", "");
      if (/^[0-9a-fA-F]{3}$/.test(raw)) {
        raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
      }
      if (/^[0-9a-fA-F]{6}$/.test(raw)) {
        return "#" + raw.toUpperCase();
      }
      if (/^[0-9a-fA-F]{8}$/.test(raw)) {
        return "#" + raw.slice(0, 6).toUpperCase();
      }
      return "";
    },
    getSpoolSwatch: function (spool) {
      var filament = spool && spool.filament ? spool.filament : {};
      var raw = filament.multi_color_hexes || filament.multi_color_hexes_csv;
      var values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
      var colors = values.map(this.normalizeHexColor, this).filter(Boolean);
      if (colors.length < 2) {
        return colors[0] || this.normalizeHexColor(filament.color_hex) || "#888888";
      }
      var stops = [];
      colors.forEach(function (color, i) {
        stops.push(color + " " + (100 * i / colors.length) + "%", color + " " + (100 * (i + 1) / colors.length) + "%");
      });
      return "linear-gradient(90deg, " + stops.join(", ") + ")";
    },
    getSpoolPrimaryColor: function (spool) {
      var filament = spool && spool.filament ? spool.filament : {};
      var multi = filament.multi_color_hexes || filament.multi_color_hexes_csv;
      if (typeof multi === "string" && multi.trim()) {
        var first = multi.split(",")[0];
        var parsedMulti = this.normalizeHexColor(first);
        if (parsedMulti) {
          return parsedMulti;
        }
      }
      return this.normalizeHexColor(filament.color_hex);
    },
    getTextColorForBackground: function (hexColor) {
      var normalized = this.normalizeHexColor(hexColor);
      if (!normalized) {
        return "inherit";
      }
      var r = parseInt(normalized.slice(1, 3), 16);
      var g = parseInt(normalized.slice(3, 5), 16);
      var b = parseInt(normalized.slice(5, 7), 16);
      var luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return luminance > 145 ? "#101010" : "#ffffff";
    },
    getToolAssignedSpool: function (toolId) {
      var selectedId = Number(this.settings.toolSpoolMap[toolId]);
      for (var i = 0; i < this.spools.length; i += 1) {
        if (Number(this.spools[i].id) === selectedId) {
          return this.spools[i];
        }
      }
      return null;
    },
    getRemainingGrams: function (spool) {
      var value = spool.remaining_weight;
      if (value === null || value === undefined || value === "") {
        return null;
      }
      var grams = Number(value);
      return Number.isFinite(grams) && grams >= 0 ? grams : null;
    },
    isLowFilament: function (spool) {
      var grams = this.getRemainingGrams(spool);
      return grams !== null && grams < this.lowFilamentThreshold;
    },
    updateLowFilamentThreshold: function (value) {
      var number = Number(value);
      if (!Number.isFinite(number) || number < 0) {
        return;
      }
      this.lowFilamentThreshold = Math.min(10000, number);
      try {
        localStorage.setItem("spoolman_low_filament_threshold", String(this.lowFilamentThreshold));
      } catch (_error) {
        // Keep the setting in memory if browser storage is unavailable.
      }
    },
    spoolMatchesSearch: function (spool) {
      var filament = spool.filament || {};
      var vendor = filament.vendor || {};
      var manufacturer = typeof vendor === "string" ? vendor : vendor.name || "";
      var query = this.spoolSearch.trim().toLowerCase();
      var fields = [spool.id, filament.name, filament.material, manufacturer].join(" ").toLowerCase();
      return (!query || fields.indexOf(query) !== -1) &&
        (!this.availableOnly || this.getRemainingGrams(spool) === null || this.getRemainingGrams(spool) > 0);
    },
    getSpoolDetails: function (spool) {
      var filament = spool && spool.filament ? spool.filament : {};
      var vendor = filament.vendor || {};
      var manufacturer = typeof vendor === "string" ? vendor : vendor.name;
      var name = filament.name || "Unknown filament";
      var material = filament.material || "Unknown material";
      return {
        title: (manufacturer ? manufacturer + " — " : "") + name,
        subtitle: "Spool #" + spool.id + " · " + material,
        color: this.getSpoolPrimaryColor(spool)
      };
    },
    renderSpoolSummary: function (h, spool) {
      var details = this.getSpoolDetails(spool);
      return h("span", { class: "spoolman-spool-summary" }, [
        h("span", {
          class: "spoolman-spool-swatch",
          style: { background: this.getSpoolSwatch(spool) },
          "aria-hidden": "true"
        }),
        h("span", { class: "spoolman-spool-text" }, [
          h("span", { class: "spoolman-spool-title" }, details.title),
          h("span", { class: "spoolman-spool-subtitle" }, details.subtitle),
          h("span", { class: "spoolman-spool-weight" }, this.getRemainingGrams(spool) === null ? "Weight unavailable" : Math.round(this.getRemainingGrams(spool)) + "g remaining"),
          this.isLowFilament(spool) ? h("span", { style: { color: "#d99a24", fontWeight: "600" }, title: "Below the configured low-filament threshold" }, "⚠ Low filament") : null
        ])
      ]);
    },
    getToolTrackedUsageMm: function (toolId) {
      var totals = this.trackingState && this.trackingState.totalTrackedMmByTool ? this.trackingState.totalTrackedMmByTool : {};
      return Number(totals[toolId] || 0);
    },
    getToolReportedUsageMm: function (toolId) {
      var totals = this.trackingState && this.trackingState.totalReportedMmByTool ? this.trackingState.totalReportedMmByTool : {};
      return Number(totals[toolId] || 0);
    },
    formatUsageValue: function (mm) {
      if (!Number.isFinite(mm) || mm <= 0) {
        return this.formatMessage("trackedUsageFormatMm", "{value} mm", { value: "0.0" });
      }
      var meters = mm / 1000;
      if (meters >= 1) {
        return this.formatMessage("trackedUsageFormatMeters", "{meters} m ({mm} mm)", {
          meters: meters.toFixed(3),
          mm: mm.toFixed(1)
        });
      }
      return this.formatMessage("trackedUsageFormatMm", "{value} mm", { value: mm.toFixed(1) });
    },
    formatToolTrackedUsage: function (toolId) {
      var mm = this.getToolTrackedUsageMm(toolId);
      var reportedMm = this.getToolReportedUsageMm(toolId);
      return this.t("usageMeasured", "Measured") + ": " + this.formatUsageValue(mm) + " | " +
        this.t("usageReported", "Reported") + ": " + this.formatUsageValue(reportedMm);
    },
    toggleToolDropdown: function (toolId) {
      this.openToolDropdown = this.openToolDropdown === toolId ? "" : toolId;
      this.spoolSearch = "";
    },
    closeToolDropdown: function () {
      this.openToolDropdown = "";
    },
    selectToolSpool: async function (toolId, spoolId) {
      this.openToolDropdown = "";
      await this.setToolSpool(toolId, spoolId);
    },
    toolList: function () {
      var count = Number(this.settings.hotendCount) || 1;
      var tools = [];
      for (var i = 0; i < count; i += 1) {
        tools.push("T" + i);
      }
      return tools;
    },
    setToast: function (type, message) {
      if (type === "error") {
        this.error = message;
        this.success = "";
      } else {
        this.success = message;
        this.error = "";
      }
    },
    clearToast: function () {
      this.error = "";
      this.success = "";
    },
    rememberBridgeUrl: function (url) {
      try {
        sessionStorage.setItem("spoolman_bridge_last_url", url);
      } catch (_error) {
        // Ignore storage errors.
      }
    },
    getRememberedBridgeUrl: function () {
      try {
        return sessionStorage.getItem("spoolman_bridge_last_url") || "";
      } catch (_error) {
        return "";
      }
    },
    extractSubnetPrefix: function (value) {
      if (!value) {
        return "";
      }
      var host = String(value).trim();
      var fromUrl = host.match(/^https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/i);
      if (fromUrl) {
        return fromUrl[1];
      }
      var direct = host.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
      if (direct) {
        return direct[1];
      }
      return "";
    },
    normalizeBridgeBaseUrl: function (input) {
      var value = String(input || "").trim();
      if (!value) {
        return "";
      }
      if (!/^https?:\/\//i.test(value)) {
        value = "http://" + value;
      }
      try {
        var parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return "";
        }
        if (!parsed.hostname) {
          return "";
        }
        return parsed.origin;
      } catch (_error) {
        return "";
      }
    },
    tryBridgeHealth: async function (base, timeoutMs) {
      var normalized = this.normalizeBridgeBaseUrl(base);
      if (!normalized) {
        return false;
      }

      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) {
          controller.abort();
        }
      }, timeoutMs || 700);
      try {
        var response = await fetch(normalized + "/api/v1/health", {
          method: "GET",
          signal: controller ? controller.signal : undefined
        });
        if (!response.ok) {
          return false;
        }
        var payload = await response.json();
        return Boolean(payload && payload.ok === true);
      } catch (_error) {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    connectToBridge: async function (base) {
      var normalized = this.normalizeBridgeBaseUrl(base);
      if (!normalized) {
        this.connected = false;
        this.serverUrl = "";
        this.stopStatusRefresh();
        this.stopSpoolRefresh();
        this.setToast("error", this.t("invalidBridgeUrl", "Invalid bridge server URL. Use http://IP:9377 (or the port configured on your bridge)"));
        return false;
      }

      var ok = await this.tryBridgeHealth(normalized, 1200);
      if (!ok) {
        this.connected = false;
        this.serverUrl = "";
        this.stopStatusRefresh();
        this.stopSpoolRefresh();
        this.setToast("error", this.formatMessage("unreachableBridgeUrl", "Could not reach bridge server at {url}", { url: normalized }));
        return false;
      }

      this.serverUrl = normalized;
      this.connected = true;
      this.manualServerUrl = normalized;
      this.rememberBridgeUrl(normalized);
      this.setToast("success", this.t("connectedBridge", "Connected to bridge server"));
      return true;
    },
    discoverLocalIPv4Hint: function () {
      return new Promise(function (resolve) {
        var rtc = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (!rtc) {
          resolve("");
          return;
        }

        var connection = new rtc({ iceServers: [] });
        var finished = false;

        function finish(value) {
          if (finished) {
            return;
          }
          finished = true;
          try {
            connection.close();
          } catch (_error) {
            // Ignore close errors.
          }
          resolve(value || "");
        }

        connection.onicecandidate = function (event) {
          if (!event || !event.candidate || !event.candidate.candidate) {
            return;
          }
          var match = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(event.candidate.candidate);
          if (match) {
            finish(match[1]);
          }
        };

        try {
          connection.createDataChannel("spoolman-discovery");
          connection.createOffer().then(function (offer) {
            return connection.setLocalDescription(offer);
          }).catch(function () {
            finish("");
          });
        } catch (_error) {
          finish("");
          return;
        }

        setTimeout(function () {
          finish("");
        }, 1500);
      });
    },
    getSubnetPrefixes: async function () {
      var prefixes = {};
      var self = this;

      function addPrefix(value) {
        var prefix = self.extractSubnetPrefix(value);
        if (prefix) {
          prefixes[prefix] = true;
        }
      }

      addPrefix(window.location.hostname);
      addPrefix(this.manualServerUrl);
      addPrefix(this.getRememberedBridgeUrl());
      addPrefix(await this.discoverLocalIPv4Hint());

      return Object.keys(prefixes);
    },
    buildDiscoveryCandidates: function (includeSubnetScan, subnetPrefixes) {
      var self = this;
      var candidates = [];
      var seen = {};
      var ports = [9377, 9378];
      var priorityHosts = [85, 1, 2, 10, 20, 50, 100, 150, 200, 254];

      function addCandidate(url) {
        var base = self.normalizeBridgeBaseUrl(url);
        if (!base || seen[base]) {
          return;
        }
        seen[base] = true;
        candidates.push(base);
      }

      function addHostOnPrefix(prefix, hostId) {
        for (var p = 0; p < ports.length; p += 1) {
          addCandidate("http://" + prefix + "." + hostId + ":" + ports[p]);
        }
      }

      addCandidate(this.getRememberedBridgeUrl());
      addCandidate(this.manualServerUrl);
      addCandidate("http://spoolman-bridge.local:9377");
      addCandidate("http://spoolman-bridge.local:9378");

      var currentHost = window.location.hostname;
      if (currentHost) {
        addCandidate(window.location.protocol + "//" + currentHost + ":9377");
        addCandidate(window.location.protocol + "//" + currentHost + ":9378");
      }

      if (includeSubnetScan && subnetPrefixes && subnetPrefixes.length) {
        for (var prefixIndex = 0; prefixIndex < subnetPrefixes.length; prefixIndex += 1) {
          var prefix = subnetPrefixes[prefixIndex];
          var hostId;
          for (var priorityIndex = 0; priorityIndex < priorityHosts.length; priorityIndex += 1) {
            addHostOnPrefix(prefix, priorityHosts[priorityIndex]);
          }
          for (hostId = 1; hostId <= 254; hostId += 1) {
            if (priorityHosts.indexOf(hostId) >= 0) {
              continue;
            }
            addHostOnPrefix(prefix, hostId);
          }
        }
      }

      return candidates;
    },
    fetchDiscoveryHintsFromUrl: async function (base) {
      var normalized = this.normalizeBridgeBaseUrl(base);
      if (!normalized) {
        return [];
      }
      try {
        var response = await fetch(normalized + "/api/v1/discovery", { method: "GET" });
        if (!response.ok) {
          return [];
        }
        var payload = await response.json();
        var urls = [];
        if (Array.isArray(payload.suggestedUrls)) {
          urls = urls.concat(payload.suggestedUrls);
        }
        if (Array.isArray(payload.mdnsUrls)) {
          urls = urls.concat(payload.mdnsUrls);
        }
        if (payload.suggestedUrl) {
          urls.push(payload.suggestedUrl);
        }
        return urls;
      } catch (_error) {
        return [];
      }
    },
    fetchDiscoveryHints: async function (initialCandidates) {
      var hints = [];
      var hintSources = [];
      var self = this;
      var currentHost = window.location.hostname;
      if (currentHost) {
        hintSources.push(window.location.protocol + "//" + currentHost + ":9377");
        hintSources.push(window.location.protocol + "//" + currentHost + ":9378");
      }
      hintSources.push(this.getRememberedBridgeUrl());
      hintSources.push(this.manualServerUrl);
      hintSources.push("http://spoolman-bridge.local:9377");
      hintSources.push("http://spoolman-bridge.local:9378");

      if (Array.isArray(initialCandidates)) {
        hintSources = hintSources.concat(initialCandidates.slice(0, 12));
      }

      for (var i = 0; i < hintSources.length; i += 1) {
        var fromSource = await self.fetchDiscoveryHintsFromUrl(hintSources[i]);
        if (fromSource.length) {
          hints = hints.concat(fromSource);
        }
      }
      return hints;
    },
    probeDiscoveryCandidates: async function (candidates) {
      var batchSize = 48;
      for (var start = 0; start < candidates.length; start += batchSize) {
        var batch = candidates.slice(start, start + batchSize);
        var self = this;
        var checks = await Promise.all(batch.map(function (base) {
          return self.tryBridgeHealth(base, 700).then(function (ok) {
            return ok ? base : null;
          });
        }));
        for (var i = 0; i < checks.length; i += 1) {
          if (checks[i]) {
            return checks[i];
          }
        }
      }
      return null;
    },
    loadConnectedData: async function () {
      await Promise.all([this.loadBridgeInfo(), this.loadSettings(), this.loadStatus()]);
      await this.loadSpools();
      this.startStatusRefresh();
      this.startSpoolRefresh();
    },
    startStatusRefresh: function () {
      var self = this;
      this.stopStatusRefresh();
      this.statusRefreshTimer = setInterval(function () {
        if (!self.connected) {
          self.stopStatusRefresh();
          return;
        }
        self.loadStatus();
      }, 2500);
    },
    stopStatusRefresh: function () {
      if (this.statusRefreshTimer) {
        clearInterval(this.statusRefreshTimer);
        this.statusRefreshTimer = null;
      }
    },
    startSpoolRefresh: function () {
      var self = this;
      this.stopSpoolRefresh();
      this.spoolRefreshTimer = setInterval(function () {
        if (!self.connected) {
          self.stopSpoolRefresh();
          return;
        }
        if (document.visibilityState === "hidden") {
          return;
        }
        self.loadSpools();
      }, 60000);
    },
    stopSpoolRefresh: function () {
      if (this.spoolRefreshTimer) {
        clearInterval(this.spoolRefreshTimer);
        this.spoolRefreshTimer = null;
      }
    },
    connectManualServer: async function () {
      var manual = this.normalizeBridgeBaseUrl(this.manualServerUrl);
      if (!manual) {
        this.connected = false;
        this.serverUrl = "";
        this.stopStatusRefresh();
        this.setToast("error", this.t("enterValidUrl", "Enter a valid URL (e.g. http://192.168.1.148:9377)."));
        return false;
      }
      var connected = await this.connectToBridge(manual);
      if (connected) {
        await this.loadConnectedData();
      }
      return connected;
    },
    discoverAndLoad: async function (options) {
      var found = await this.discoverServer(options);
      if (found) {
        await this.loadConnectedData();
      }
      return found;
    },
    discoverServer: async function (options) {
      options = options || {};
      const includeSubnetScan = options.includeSubnetScan !== false;
      this.discoveryBusy = true;
      try {
        const subnetPrefixes = await this.getSubnetPrefixes();
        let quickCandidates = this.buildDiscoveryCandidates(false, subnetPrefixes);
        const hintCandidates = await this.fetchDiscoveryHints(quickCandidates);
        quickCandidates = quickCandidates.concat(hintCandidates);
        let found = await this.probeDiscoveryCandidates(quickCandidates);
        if (found) {
          return this.connectToBridge(found);
        }

        if (includeSubnetScan && subnetPrefixes.length > 0) {
          this.setToast("success", this.t("searchingNetwork", "Searching local network for bridge server..."));
          const subnetCandidates = this.buildDiscoveryCandidates(true, subnetPrefixes);
          found = await this.probeDiscoveryCandidates(subnetCandidates);
          if (found) {
            return this.connectToBridge(found);
          }
        }

        this.connected = false;
        this.stopStatusRefresh();
        this.stopSpoolRefresh();
        this.setToast(
          "error",
          this.t("discoverFailed", "Could not discover server. Enter IP in Manual server URL and click Connect.")
        );
        return false;
      } finally {
        this.discoveryBusy = false;
      }
    },
    loadBridgeInfo: async function () {
      try {
        var response = await fetch(this.apiUrl("/api/v1/info"));
        if (response.ok) {
          var payload = await response.json();
          this.bridgeVersion = payload.version || "";
        }
      } catch (_error) {
        this.bridgeVersion = "";
      }
    },
    loadSettings: async function () {
      this.loading = true;
      this.clearToast();
      try {
        var response = await fetch(this.apiUrl("/api/v1/settings?browserLocale=" + encodeURIComponent(this.browserLocale())));
        if (!response.ok) {
          throw new Error("Failed to load settings");
        }
        var payload = await response.json();
        this.settings = payload.settings;
        this.resolvedLanguage = payload.resolvedLanguage;
        this.messages = payload.messages || {};
      } catch (error) {
        this.setToast("error", error.message);
      } finally {
        this.loading = false;
      }
    },
    setLanguage: async function (languageValue) {
      this.settings.language = languageValue;
      await this.saveSettings();
      await this.loadSettings();
    },
    saveSettings: async function () {
      this.loading = true;
      this.clearToast();
      try {
        var response = await fetch(this.apiUrl("/api/v1/settings"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.settings)
        });
        if (!response.ok) {
          var failedPayload = await response.json();
          throw new Error(failedPayload.error || "Failed to save settings");
        }
        var payload = await response.json();
        this.settings = payload.settings;
        this.setToast("success", this.t("saved", "Settings saved"));
      } catch (error) {
        this.setToast("error", error.message);
      } finally {
        this.loading = false;
      }
    },
    loadStatus: async function () {
      try {
        var response = await fetch(this.apiUrl("/api/v1/status"));
        if (!response.ok) {
          throw new Error("Failed to load status");
        }
        var payload = await response.json();
        this.trackingRunning = payload.trackingRunning;
        this.trackingState = payload.tracking;
      } catch (error) {
        this.setToast("error", error.message);
      }
    },
    loadSpools: async function () {
      if (this.spoolRefreshBusy || !this.connected) {
        return;
      }
      this.spoolRefreshBusy = true;
      try {
        var response = await fetch(this.apiUrl("/api/v1/spools") + "?_=" + Date.now(), { cache: "no-store" });
        if (!response.ok) {
          var body = await response.json();
          throw new Error(body.error || "Failed to load spools");
        }
        var payload = await response.json();
        this.spools = payload.spools || [];
      } catch (error) {
        this.setToast("error", error.message);
      } finally {
        this.spoolRefreshBusy = false;
      }
    },
    setToolSpool: async function (toolId, spoolId) {
      try {
        if (!spoolId) {
          await fetch(this.apiUrl("/api/v1/tools/" + toolId + "/spool"), { method: "DELETE" });
        } else {
          await fetch(this.apiUrl("/api/v1/tools/" + toolId + "/spool"), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spoolId: Number(spoolId) })
          });
        }
        await this.loadSettings();
      } catch (error) {
        this.setToast("error", error.message);
      }
    },
    setTracking: async function (run) {
      this.trackingActionBusy = true;
      try {
        var path = run ? "/api/v1/tracking/start" : "/api/v1/tracking/stop";
        var response = await fetch(this.apiUrl(path), { method: "POST" });
        if (!response.ok) {
          throw new Error("Failed to change tracking state");
        }
        await this.loadStatus();
        this.setToast("success", run ? this.t("trackingStartedMessage", "Tracking started.") : this.t("trackingStoppedMessage", "Tracking stopped."));
      } catch (error) {
        this.setToast("error", error.message);
      } finally {
        this.trackingActionBusy = false;
      }
    },
    toggleTracking: async function () {
      await this.setTracking(!this.trackingRunning);
    },
    pollNow: async function () {
      try {
        await fetch(this.apiUrl("/api/v1/tracking/poll-now"), { method: "POST" });
        await this.loadStatus();
      } catch (error) {
        this.setToast("error", error.message);
      }
    }
  },
  mounted: function () {
    try {
      var storedThreshold = localStorage.getItem("spoolman_low_filament_threshold");
      if (storedThreshold !== null && storedThreshold !== "") {
        this.updateLowFilamentThreshold(storedThreshold);
      }
    } catch (_error) {
      // Use the 100g default if browser storage is unavailable.
    }
    this.manualServerUrl = this.getRememberedBridgeUrl();
    this.discoverAndLoad();
  },
  beforeUnmount: function () {
    this.stopSpoolRefresh();
    this.stopStatusRefresh();
  },
  render: function () {
    var h = DWC.Vue.h;
    var self = this;
    var tools = this.toolList();
    var toolRows = tools.map(function (toolId) {
      var selectedSpool = self.getToolAssignedSpool(toolId);
      var selectedColor = selectedSpool ? self.getSpoolPrimaryColor(selectedSpool) : "";
      var dropdownOpen = self.openToolDropdown === toolId;

      var optionRows = [
        h("button", {
          class: "spoolman-dropdown-option",
          onClick: function () {
            self.selectToolSpool(toolId, "");
          }
        }, self.t("notAssigned", "Not assigned"))
      ];

      for (var i = 0; i < self.spools.length; i += 1) {
        var spool = self.spools[i];
        if (!self.spoolMatchesSearch(spool)) { continue; }
        optionRows.push(h("button", {
          class: "spoolman-dropdown-option",
          key: spool.id,
          onClick: function (spoolId) {
            return function () {
              self.selectToolSpool(toolId, spoolId);
            };
          }(spool.id)
        }, self.renderSpoolSummary(h, spool)));
      }

      if (dropdownOpen) {
        optionRows.unshift(h("div", { class: "spoolman-dropdown-tools" }, [
          h("input", {
            class: "spoolman-input spoolman-search",
            type: "search",
            placeholder: "Search spools...",
            value: self.spoolSearch,
            onInput: function (event) { self.spoolSearch = event.target.value; },
            onClick: function (event) { event.stopPropagation(); }
          }),
          h("label", { class: "spoolman-filter-label" }, [
            h("input", {
              type: "checkbox",
              checked: self.availableOnly,
              onChange: function (event) { self.availableOnly = event.target.checked; }
            }),
            " Hide empty spools"
          ])
        ]));
        if (optionRows.length === 2 && self.spools.length > 0 &&
            !self.spools.some(function (spool) { return self.spoolMatchesSearch(spool); })) {
          optionRows.push(h("div", { class: "spoolman-dropdown-empty" }, "No matching spools"));
        }
      }

      return h("div", { class: "spoolman-row" + (dropdownOpen ? " spoolman-row-dropdown-open" : "") }, [
        h("label", { class: "spoolman-label" }, toolId),
        h("div", { class: "spoolman-dropdown" }, [
          h("button", {
            class: "spoolman-dropdown-trigger",

            
              onClick: function () {
                self.toggleToolDropdown(toolId);
              }
          }, selectedSpool ? self.renderSpoolSummary(h, selectedSpool) : self.t("notAssigned", "Not assigned")),
          dropdownOpen ? h("div", { class: "spoolman-dropdown-menu" }, optionRows) : null
        ]),
        h("span", { class: "spoolman-tool-usage" }, self.formatToolTrackedUsage(toolId))
      ]);
    });

    return h("div", { class: "spoolman-container" }, [
      h("h2", "Spoolman for Duet"),
      h("p", { class: "spoolman-muted" }, "Plugin 1.0.0-beta.4" + (this.bridgeVersion ? " · Bridge " + this.bridgeVersion : "")),
      h("p", this.t("appSubtitle", "Tracking runs on server side. Browser can be closed safely.")),

      this.error ? h("div", { class: "spoolman-error" }, this.error) : null,
      this.success ? h("div", { class: "spoolman-success" }, this.success) : null,

      h("div", { class: "spoolman-card" }, [
        h("h3", this.t("bridgeServer", "Bridge server")),
        h("div", { class: "spoolman-row" }, [
          h("label", { class: "spoolman-label" }, this.t("manualServerUrl", "Manual server URL")),
          h("input", {
            class: "spoolman-input",
             type: "text", placeholder: "http://192.168.x.x:9377" ,
             value: this.manualServerUrl ,
            
              onInput: function (event) {
                self.manualServerUrl = event.target.value;
              }
          })
        ]),
        h("div", { class: "spoolman-row" }, [
          h("button", { class: "spoolman-button",  onClick: function () { self.connectManualServer(); } }, this.t("connect", "Connect")),
          h("button", { class: "spoolman-button",  disabled: this.discoveryBusy ,  onClick: function () { self.discoverAndLoad(); } }, this.discoveryBusy ? this.t("pleaseWait", "Please wait...") : this.t("discoverServer", "Discover server")),
          h("span", { class: "spoolman-status" }, this.connected ? this.t("connectedPrefix", "Connected") + ": " + this.serverUrl : this.t("notConnected", "Not connected"))
        ])
      ]),

      this.connected ? h("div", { class: "spoolman-card" }, [
        h("h3", this.t("toolToSpoolMapping", "Tool to spool mapping")),
        toolRows,
        h("button", { class: "spoolman-button", onClick: this.loadSpools }, this.t("refreshSpools", "Refresh spools"))
      ]) : null,

      this.connected ? h("div", { class: "spoolman-card" }, [
        h("h3", this.t("tracking", "Tracking")),
        h("div", { class: "spoolman-row spoolman-tracking-overview" }, [
          h("span", {
            class: "spoolman-tracking-badge " + (this.trackingRunning ? "is-running" : "is-stopped")
          }, this.trackingRunning ? this.t("trackingRunning", "Tracking: Running") : this.t("trackingStopped", "Tracking: Stopped"))
        ]),
        h("p", { class: "spoolman-muted" }, this.t("lastPoll", "Last poll") + ": " + (this.trackingState.lastPollAt || this.t("never", "Never"))),
        this.trackingRunning && this.trackingState.lastError ? h("p", { class: "spoolman-error" }, this.trackingState.lastError) : null,
        this.trackingState.lastEvent ? h("p", { class: "spoolman-muted" }, this.trackingState.lastEvent) : null,
        h("div", { class: "spoolman-row" }, [
          h("button", {
            class: "spoolman-button " + (this.trackingRunning ? "is-danger" : "is-success"),
             disabled: this.trackingActionBusy ,
             onClick: function () { self.toggleTracking(); }
          }, this.trackingActionBusy ? this.t("pleaseWait", "Please wait...") : (this.trackingRunning ? this.t("stopTracking", "Stop tracking") : this.t("startTracking", "Start tracking"))),
          h("button", { class: "spoolman-button",  onClick: this.pollNow }, this.t("pollNow", "Poll now"))
        ])
      ]) : null,

      this.connected ? h("div", { class: "spoolman-card" }, [
        h("button", { class: "spoolman-settings-toggle", "aria-expanded": this.settingsExpanded, onClick: function () { self.settingsExpanded = !self.settingsExpanded; } }, this.t("settings", "Settings") + (this.settingsExpanded ? " ▾" : " ▸")),
        this.settingsExpanded ? h("div", [
        h("div", { class: "spoolman-row" }, [
          h("label", { class: "spoolman-label" }, "Low-filament warning (g)"),
          h("input", {
            class: "spoolman-input", type: "number", min: 0, max: 10000, step: 1,
            value: this.lowFilamentThreshold,
            onChange: function (event) { self.updateLowFilamentThreshold(event.target.value); }
          }),
          h("span", { class: "spoolman-muted" }, "Warning only · saved in this browser")
        ]),
        h("div", { class: "spoolman-row" }, [
          h("label", { class: "spoolman-label" }, this.t("language", "Language")),
          h("select", {
            class: "spoolman-input",
             value: this.settings.language ,
            
              onChange: function (event) {
                self.setLanguage(event.target.value);
              }
          }, [
            h("option", {  value: "auto"  }, this.t("auto", "Auto")),
            h("option", {  value: "en"  }, this.t("english", "English")),
            h("option", {  value: "da"  }, this.t("danish", "Dansk"))
          ]),
          h("span", { class: "spoolman-muted" }, this.t("resolvedLanguage", "Resolved") + ": " + this.resolvedLanguage)
        ]),
        h("div", { class: "spoolman-row" }, [
          h("label", { class: "spoolman-label" }, this.t("spoolmanUrl", "Spoolman URL")),
          h("input", {
            class: "spoolman-input",
             type: "text", placeholder: "http://spoolman:7912" ,
             value: this.settings.spoolmanBaseUrl || "" ,
             onInput: function (event) { self.settings.spoolmanBaseUrl = event.target.value; }
          })
        ]),
        h("div", { class: "spoolman-row" }, [
          h("label", { class: "spoolman-label" }, this.t("rrfUrl", "RRF URL")),
          h("input", {
            class: "spoolman-input",
             type: "text", placeholder: "http://duet" ,
             value: this.settings.rrf.baseUrl || "" ,
             onInput: function (event) { self.settings.rrf.baseUrl = event.target.value; }
          })
        ]),
        h("div", { class: "spoolman-row" }, [
          h("label", { class: "spoolman-label" }, this.t("rrfPassword", "RRF password")),
          h("input", {
            class: "spoolman-input",
             type: "password", placeholder: "reprap" ,
             value: this.settings.rrf.password || "" ,
             onInput: function (event) { self.settings.rrf.password = event.target.value; }
          })
        ]),
        h("div", { class: "spoolman-row" }, [
          h("label", { class: "spoolman-label" }, this.t("hotendCount", "Hotend count")),
          h("input", {
            class: "spoolman-input",
             type: "number", min: 1, max: 16 ,
             value: this.settings.hotendCount || 1 ,
             onInput: function (event) { self.settings.hotendCount = Number(event.target.value) || 1; }
          })
        ]),
        h("div", { class: "spoolman-row" }, [
          h("button", { class: "spoolman-button",  onClick: this.saveSettings }, this.loading ? this.t("saving", "Saving settings...") : this.t("saveSettings", "Save settings")),
        ])
        ]) : null
      ]) : null
    ]);
  }
};


  DWC.registerRoute(SpoolmanComponent, {
    Job: {
      Spoolman: {
        icon: "mdi-spool",
        caption: "Spoolman",
        path: "/Job/Spoolman",
        order: 60
      }
    }
  });
})();
