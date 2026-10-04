# Spoolman for Duet

Spoolman integration for Duet printers running RepRapFirmware and Duet Web Control (DWC) 3.7.

> **Status:** `1.0.0-beta.2` — tested during development with a Fysetc BigDipper, RepRapFirmware 3.7.0-beta.3 and DWC 3.7.0-beta.3.

This project is a maintained fork/derivative of **Spoolman-DuetWebControl** by Emil Vitus. It keeps the server-driven tracking architecture while porting the DWC frontend to the DWC 3.7 plugin API. See [NOTICE](NOTICE) for attribution.

## Features

- DWC 3.7 Job-page integration
- Bridge discovery plus manual bridge URL
- Spoolman spool listing
- Tool-to-spool assignment
- Server-side filament consumption tracking (browser may be closed)
- Persistent settings and tracking state
- RRF `rr_connect` / `rr_model` integration
- Spoolman `/api/v1` integration
- English / Danish / automatic language selection inherited from the upstream project

## Repository layout

- `plugin/` — installable DWC plugin payload
- `server/` — Node.js bridge service
- `scripts/` — build and Linux installation helpers
- `docs/` — API and migration notes

## Requirements

- DWC 3.7 / RRF 3.7 (current beta target: `3.7.0-beta.3`)
- Node.js 20+ for the bridge
- Network access from the bridge to both the Duet and Spoolman
- Spoolman server (default port is normally 7912)

## Bridge defaults

The bridge uses port `9377` by default for both stable and nightly installations.

The DWC plugin can discover/test supported bridge ports and also accepts a complete manual URL such as:

```text
http://192.168.1.148:9377
```

For many standalone RRF installations the HTTP API password is the default `reprap`, even when the DWC UI does not prompt for a password. Configure the bridge to match your printer.

## Build

```bash
npm install
npm test
npm run build
```

Artifacts are written to `dist/`:

- `Spoolman-for-Duet-<version>.zip`
- `spoolman-for-duet-bridge-<version>.zip`

## DWC plugin installation

Build or download the plugin ZIP, then in DWC open **Settings → Plugins** and upload the ZIP. Open **Job → Spoolman** and connect to the bridge.

## Bridge installation

For stable releases, the bridge can be installed or updated with:

```bash
curl -fsSL https://raw.githubusercontent.com/Rushmere3D/Spoolman-for-Duet/main/scripts/install-bridge.sh | sudo bash
```
> **Note:** The stable installer only installs full stable releases. Beta and other prerelease versions should be installed using the nightly/development installer while testing.

### Nightly / development builds

To install or update to the latest nightly bridge build:

```bash
curl -fsSL https://github.com/Rushmere3D/Spoolman-for-Duet/releases/download/nightly/install-bridge-nightly.sh | sudo bash
```

Nightly builds contain the latest development changes and may be unstable. For normal use, install the latest tagged release.

The service runs as the dedicated `spoolman-bridge` user and stores persistent files under `/opt/spoolman-bridge/data` by default.

Useful checks:

```bash
sudo systemctl status spoolman-bridge --no-pager
curl -s http://127.0.0.1:9377/api/v1/health
```

## Known beta notes

- This is a new DWC 3.7 port and should be treated as beta until tested on a wider range of Duet/RRF configurations.
- If migrating an existing bridge installation, ensure `data/settings.json` is writable by the service user (`spoolman-bridge`).

## License and attribution

GPL-3.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Based on [Spoolman-DuetWebControl](https://github.com/EmilVitus/Spoolman-DuetWebControl) by Emil Vitus.
