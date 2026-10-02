#!/usr/bin/env bash
# Install Spoolman for Duet Bridge (latest stable GitHub release).
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Rushmere3D/Spoolman-for-Duet/main/scripts/install-bridge.sh | sudo bash
set -euo pipefail

GITHUB_REPO="${SPOOLMAN_BRIDGE_REPO:-Rushmere3D/Spoolman-for-Duet}"
INSTALL_DIR="${SPOOLMAN_BRIDGE_INSTALL_DIR:-/opt/spoolman-bridge}"
SERVICE_NAME="${SPOOLMAN_BRIDGE_SERVICE:-spoolman-bridge}"
PORT="${SPOOLMAN_BRIDGE_PORT:-9377}"
SERVICE_USER="${SPOOLMAN_BRIDGE_USER:-spoolman-bridge}"

log() { printf '[install-bridge] %s\n' "$*" >&2; }
die() { printf '[install-bridge] ERROR: %s\n' "$*" >&2; exit 1; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root (example: curl ... | sudo bash)"
  fi
}

require_command() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || die "Missing required command: ${cmd}"
}

install_node_if_needed() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "${major}" -ge 20 ]]; then
      log "Node.js $(node -v) detected"
      return
    fi
    log "Node.js $(node -v) is too old; installing Node.js 20..."
  else
    log "Node.js not found; installing Node.js 20..."
  fi

  require_command curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  log "Installed Node.js $(node -v)"
}

fetch_latest_asset_url() {
  require_command curl
  require_command python3

  local api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
  log "Resolving latest stable release from ${GITHUB_REPO}..."

  local release_json
  release_json="$(curl -fsSL -H "Accept: application/vnd.github+json" "${api_url}")"

  printf '%s' "${release_json}" | python3 -c '
import json
import sys

release = json.load(sys.stdin)
tag = release.get("tag_name", "")
version = tag.lstrip("v")

for asset in release.get("assets", []):
    name = asset.get("name", "")
    if name.startswith("spoolman-bridge-server-") and name.endswith(".zip"):
        print(asset["browser_download_url"])
        print(version)
        sys.exit(0)

print("No spoolman-bridge-server zip asset found in latest release.", file=sys.stderr)
sys.exit(1)
'
}

install_release() {
  local asset_url="$1"
  local version="$2"

  log "Installing bridge server ${version} to ${INSTALL_DIR}..."

  require_command unzip
  mkdir -p "${INSTALL_DIR}"

  local tmp_dir
  tmp_dir="$(mktemp -d)"

  curl -fsSL "${asset_url}" -o "${tmp_dir}/spoolman-bridge-server.zip"
  unzip -qo "${tmp_dir}/spoolman-bridge-server.zip" -d "${tmp_dir}/extract"

  rm -rf "${INSTALL_DIR:?}/"*
  cp -a "${tmp_dir}/extract/." "${INSTALL_DIR}/"
  mkdir -p "${INSTALL_DIR}/data"
  rm -rf "${tmp_dir}"

  cd "${INSTALL_DIR}"
  npm install --omit=dev
}

setup_service_user() {
  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    log "Creating service user ${SERVICE_USER}..."
    useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
  chmod -R u+rwX "${INSTALL_DIR}/data" 2>/dev/null || true
}

setup_systemd() {
  log "Creating systemd service ${SERVICE_NAME}..."
  cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Spoolman for Duet Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=PORT=${PORT}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
}

print_success() {
  local version="$1"
  log "Installation complete (${version})"
  log "Service: systemctl status ${SERVICE_NAME}"
  log "Health:  curl http://127.0.0.1:${PORT}/api/v1/health"
  log "URL:     http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}"
  log "mDNS:    http://spoolman-bridge.local:${PORT} (if supported on your network)"
}

main() {
  require_root
  require_command apt-get

  if [[ "$(uname -s)" != "Linux" ]]; then
    die "This installer supports Linux (Debian/Ubuntu) only"
  fi

  apt-get update -qq
  apt-get install -y curl unzip python3 ca-certificates

  install_node_if_needed

  mapfile -t release_info < <(fetch_latest_asset_url)
  local asset_url="${release_info[0]:-}"
  local version="${release_info[1]:-}"

  if [[ ! "${asset_url}" =~ ^https:// ]]; then
    die "Failed to resolve stable download URL. Is a stable release published?"
  fi

  install_release "${asset_url}" "${version}"
  setup_service_user
  setup_systemd
  print_success "${version}"
}

main "$@"
