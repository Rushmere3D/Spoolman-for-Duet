# Changelog

## 1.0.0-beta.2

- Add RRF printer-state tracking for reliable print-session detection.
- Reset per-print filament counters when a new print starts.
- Keep manual idle extrusion reported to Spoolman without adding it to per-print counters.
- Preserve active print counters across bridge restarts.
- Preserve completed print totals while the printer is idle.
- Ignore implausible RRF extrusion-coordinate jumps to prevent false filament usage.
- Preserve the last known printer state when an RRF state response is temporarily unavailable.
- Use atomic writes for persistent bridge data to prevent truncated state files during shutdown or upgrades.
- Recover safely from empty or invalid tracking-state files instead of entering a restart loop.
- Add regression tests for print-session tracking and persistent-state recovery.
- Allow a test-specific bridge data directory for isolated storage testing.

## 1.0.0-beta.1

- Port DWC frontend to the DWC 3.7 `window.DWC` / Vue 3 plugin API.
- Preserve bridge-driven spool listing, assignment, settings and filament tracking.
- Prefer stable bridge port 9377 while retaining 9378 compatibility.
- Probe bridge health during discovery instead of assuming a port is live.
- Rebrand the maintained fork as Spoolman for Duet.
- Separate plugin and bridge version identity.
- Improve bridge discovery ordering and shutdown fallback.
- Harden installer ownership of persistent bridge data.
