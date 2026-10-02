# Changelog

## 1.0.0-beta.1

- Port DWC frontend to the DWC 3.7 `window.DWC` / Vue 3 plugin API.
- Preserve bridge-driven spool listing, assignment, settings and filament tracking.
- Prefer stable bridge port 9377 while retaining 9378 compatibility.
- Probe bridge health during discovery instead of assuming a port is live.
- Rebrand the maintained fork as Spoolman for Duet.
- Separate plugin and bridge version identity.
- Improve bridge discovery ordering and shutdown fallback.
- Harden installer ownership of persistent bridge data.
