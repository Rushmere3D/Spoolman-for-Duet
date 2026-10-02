#!/usr/bin/env bash
# Install or upgrade Spoolman for Duet Bridge from a specific GitHub prerelease.
#
# The release version is taken from SPOOLMAN_BRIDGE_VERSION.
#
# Example:
#   curl -fsSL <installer-url> | sudo SPOOLMAN_BRIDGE_VERSION=1.0.0-beta.1 bash

set -euo pipefail

GITHUB_REPO="${SPOOLMAN_BRIDGE_REPO:-Rushmere3D/Spoolman-for-Duet}"
VERSION="${SPOOLMAN_BRIDGE_VERSION:-}"
INSTALL_DIR="${SPOOLMAN_BRIDGE_INSTALL_DIR:-/opt/spoolman-bridge}"
SERVICE_NAME="${SPOOLMAN_BRIDGE_SERVICE:-spoolman-bridge}"
PORT="${SPOOLMAN_BRIDGE_PORT:-9377}"
SERVICE_USER="${SPOOLMAN_BRIDGE_USER:-spoolman-bridge}"

log() {
  printf '[install-bridge-prerelease] %s\n' "$*" >&2
}

die() {
  printf '[install-bridge-prerelease] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root (example: curl ... | sudo SPOOLMAN_BRIDGE_VERSION=1.0.0-beta.1 bash)"
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

validate_version() {
  [[ -n "${VERSION}" ]] || die \
    "No version specified. Set SPOOLMAN_BRIDGE_VERSION, for example: 1.0.0-beta.1"

  if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9.-]+$ ]]; then
    die "Invalid prerelease version: ${VERSION}"
  fi
}

prepare_release() {
  require_command curl
  require_command unzip

  local tag="v${VERSION}"
  local asset="spoolman-for-duet-bridge-${VERSION}.zip"
  local asset_url="https://github.com/${GITHUB_REPO}/releases/download/${tag}/${asset}"

  log "Preparing Spoolman for Duet Bridge ${VERSION}..."

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT

  mkdir -p "${TMP_DIR}/extract"
  mkdir -p "${TMP_DIR}/prepared"

  log "Downloading ${asset}..."
  curl -fL "${asset_url}" -o "${TMP_DIR}/${asset}"

  log "Extracting release..."
  unzip -qo "${TMP_DIR}/${asset}" -d "${TMP_DIR}/extract"

  [[ -f "${TMP_DIR}/extract/package.json" ]] || \
    die "Downloaded bridge package does not contain package.json"

  [[ -f "${TMP_DIR}/extract/src/index.js" ]] || \
    die "Downloaded bridge package does not contain src/index.js"

  # Never allow release contents to replace persistent runtime data.
  rm -rf "${TMP_DIR}/extract/data"

  cp -a "${TMP_DIR}/extract/." "${TMP_DIR}/prepared/"

  log "Installing production dependencies before touching the running bridge..."
  (
    cd "${TMP_DIR}/prepared"
    npm install --omit=dev
  )

  [[ -d "${TMP_DIR}/prepared/node_modules" ]] || \
    die "Dependency installation failed"

  PREPARED_DIR="${TMP_DIR}/prepared"
}

setup_service_user() {
  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    log "Creating service user ${SERVICE_USER}..."
    useradd --system \
      --home "${INSTALL_DIR}" \
      --shell /usr/sbin/nologin \
      "${SERVICE_USER}"
  fi
}

stop_existing_service() {
  if systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    log "Stopping existing ${SERVICE_NAME} service..."
    systemctl stop "${SERVICE_NAME}"
  fi
}

install_prepared_release() {
  log "Installing bridge ${VERSION} to ${INSTALL_DIR}..."

  mkdir -p "${INSTALL_DIR}" "${INSTALL_DIR}/data"

  # Persistent data is deliberately retained.
  find "${INSTALL_DIR}" \
    -mindepth 1 \
    -maxdepth 1 \
    ! -name data \
    -exec rm -rf -- {} +

  cp -a "${PREPARED_DIR}/." "${INSTALL_DIR}/"

  mkdir -p "${INSTALL_DIR}/data"

  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
  chmod -R u+rwX "${INSTALL_DIR}/data" 2>/dev/null || true
}

setup_systemd() {
  log "Creating systemd service ${SERVICE_NAME}..."

  local node_bin
  node_bin="$(command -v node)"
  [[ -n "${node_bin}" ]] || die "Unable to locate Node.js executable"

  log "Using Node.js executable: ${node_bin}"

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
ExecStart=${node_bin} src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
}

print_success() {
  log "Installation complete (${VERSION})"
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

  validate_version

  apt-get update -qq
  apt-get install -y curl unzip ca-certificates

  install_node_if_needed
  setup_service_user

  # Download, extract and install npm dependencies before stopping
  # the currently working bridge.
  prepare_release

  stop_existing_service
  install_prepared_release
  setup_systemd
  print_success
}

main "$@"
