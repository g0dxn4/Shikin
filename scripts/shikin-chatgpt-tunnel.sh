#!/bin/bash
# macOS supervisor for OpenAI's tunnel-client and an existing Shikin Docker MCP.
# Compatible with the system Bash 3.2. Does not build or replace Shikin.
set -euo pipefail
set +x
umask 077

LABEL=com.asf.shikin.chatgpt-tunnel
STATE_DIR="${SHIKIN_TUNNEL_DIR:-${HOME}/Library/Application Support/com.asf.shikin/chatgpt-tunnel}"
AGENT_DIR="${SHIKIN_TUNNEL_AGENT_DIR:-${HOME}/Library/LaunchAgents}"
CONTAINER=shikin-web
NODE_PATH=/opt/shikin-cli/runtime/bin/node
MCP_PATH=/opt/shikin-cli/dist/mcp-server.js
DATA_DIR=/opt/shikin-home/.local/share/com.asf.shikin
TUNNEL_ID=
KEY_SOURCE=

die() { printf 'Shikin tunnel: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*" >&2; }
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
xml() { printf '%s' "$1" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'; }

usage() {
  cat <<'HELP'
Usage: bash scripts/shikin-chatgpt-tunnel.sh COMMAND [OPTIONS]

  setup       Check the existing container, configure the tunnel, install/start
              a login LaunchAgent. Prompts for a runtime key without echoing it.
  check       Check container/files/database presence without starting MCP.
  doctor      Run the official client's connection diagnostics.
  start       Enable automatic login startup and start the tunnel.
  stop        Stop the tunnel and disable automatic login startup.
  status      Report service state and tunnel readiness separately.
  logs        Show the last 60 lines of the local tunnel log.
  uninstall   Stop the tunnel; remove its installed files and local runtime key.

Setup options:
  --tunnel-id ID       Exact ID from OpenAI Platform tunnel settings (required).
  --key-file PATH      Copy a local runtime-key file instead of prompting.
  --container NAME    Existing container (default: shikin-web).
  --node-path PATH    Node executable inside the container.
  --mcp-path PATH     Installed mcp-server.js inside the container.
  --data-dir PATH     Existing app-data directory ending in /com.asf.shikin.

All commands:
  --state-dir PATH    Local installation directory (normally not needed).

Requires macOS, Docker CLI and the official tunnel-client:
  brew install openai/tools/tunnel-client

Setup leaves Docker, Compose, Shikin versions and Tailscale configuration intact.
It uses the installed MCP tool catalog, including write tools. ChatGPT plugin
creation, permissions and a successful live tool call remain separate steps.
HELP
}

COMMAND="${1:-help}"
[ "$#" -eq 0 ] || shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    --state-dir|--tunnel-id|--key-file|--container|--node-path|--mcp-path|--data-dir)
      [ "$#" -ge 2 ] && [ -n "$2" ] || die "Missing value for $1"
      case "$1" in
        --state-dir) STATE_DIR="$2" ;;
        --tunnel-id) TUNNEL_ID="$2" ;;
        --key-file) KEY_SOURCE="$2" ;;
        --container) CONTAINER="$2" ;;
        --node-path) NODE_PATH="$2" ;;
        --mcp-path) MCP_PATH="$2" ;;
        --data-dir) DATA_DIR="$2" ;;
      esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

case "$COMMAND" in help|--help|-h) usage; exit 0 ;; esac
case "$COMMAND" in setup|check|doctor|start|stop|status|logs|uninstall|run|mcp) ;; *) die "Unknown command: $COMMAND" ;; esac

validate_path() {
  case "$2" in /*) ;; *) die "$1 must be an absolute path" ;; esac
  case "$2" in *$'\n'*|*$'\r'*|*$'\t'*) die "$1 cannot contain control characters" ;; esac
}
validate_path 'State directory' "$STATE_DIR"
validate_path 'LaunchAgent directory' "$AGENT_DIR"
[ ! -L "$STATE_DIR" ] || die 'State directory must not be a symlink'
CONFIG="$STATE_DIR/settings.sh"
INSTALLED="$STATE_DIR/shikin-chatgpt-tunnel.sh"
KEY_PATH="$STATE_DIR/runtime-key"
PROFILE_DIR="$STATE_DIR/profiles"
LOG_PATH="$STATE_DIR/tunnel.log"
URL_PATH="$STATE_DIR/health-url"

require_macos() {
  [ "$(uname -s)" = Darwin ] || die 'This helper runs on the macOS Docker host.'
  [ "$(id -u)" != 0 ] || die 'Run as the macOS user who runs Docker, without sudo.'
}

load_config() {
  [ -f "$CONFIG" ] && [ ! -L "$CONFIG" ] || die 'Run setup first.'
  # This private, generated file contains shell-quoted settings, never a key.
  . "$CONFIG"
}

validate_target() {
  [[ "$CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || die 'Invalid container name'
  validate_path 'Node path' "$NODE_PATH"
  validate_path 'MCP path' "$MCP_PATH"
  validate_path 'Data directory' "$DATA_DIR"
  case "$DATA_DIR" in */com.asf.shikin) ;; *) die 'Data directory must end in /com.asf.shikin' ;; esac
}

# Guard the existing database before MCP can open SQLite (and create a new DB).
# These are presence/readability checks, not schema migrations or finance reads.
GUARD='set -eu
  [ -d "$1" ] && [ -s "$1/shikin.db" ] && [ -r "$1/shikin.db" ] || {
    echo "Existing Shikin database is missing, empty or unreadable; refusing to start MCP." >&2; exit 1;
  }
  [ -x "$2" ] && [ -r "$3" ] || {
    echo "Installed Node or MCP entrypoint is unavailable; check --node-path and --mcp-path." >&2; exit 1;
  }
  [ "$4" = check ] || exec "$2" "$3"
'

docker_args() {
  # Use the running container's user and installed runtime. Pin its XDG data root
  # to the existing volume, preventing fallback into a second empty database.
  DOCKER_ARGS=(exec -i
    --env "XDG_DATA_HOME=${DATA_DIR%/com.asf.shikin}"
    --env SHIKIN_RESPECT_XDG_DATA_HOME=1
    --env SHIKIN_MIGRATE_LEGACY_DATA=0
    "$CONTAINER" /bin/sh -c "$GUARD" shikin-mcp "$DATA_DIR" "$NODE_PATH" "$MCP_PATH")
}

check_target() {
  validate_target
  [ "$("$DOCKER_BIN" inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = true ] ||
    die "Docker/container $CONTAINER is unavailable. Start it and retry."
  docker_args
  "$DOCKER_BIN" "${DOCKER_ARGS[@]}" check </dev/null
}

service_target() { printf 'gui/%s/%s' "$(id -u)" "$LABEL"; }

start_service() {
  require_macos
  launchctl enable "$(service_target)"
  if ! launchctl print "$(service_target)" >/dev/null 2>&1; then
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  fi
  info 'Tunnel login service enabled. Run status to check actual tunnel readiness.'
}

stop_service() {
  require_macos
  launchctl disable "$(service_target)"
  if launchctl print "$(service_target)" >/dev/null 2>&1; then
    launchctl bootout "$(service_target)"
  fi
  rm -f "$URL_PATH"
  info 'Tunnel stopped; automatic login startup disabled. Shikin remains running.'
}

if [ "$COMMAND" = setup ]; then
  require_macos
  [ ! -e "$CONFIG" ] || die 'Already configured. Use start/status, or uninstall before reconfiguring.'
  [[ "$TUNNEL_ID" =~ ^tunnel_[a-z0-9_]+$ ]] || die 'Pass the full --tunnel-id from OpenAI Platform.'
  DOCKER_BIN="$(command -v docker)" || die 'Docker CLI not found in PATH.'
  CLIENT_BIN="$(command -v tunnel-client)" || die 'Install the official client: brew install openai/tools/tunnel-client'
  check_target
  [ -z "$KEY_SOURCE" ] || { validate_path 'Key file' "$KEY_SOURCE"; [ -s "$KEY_SOURCE" ] || die 'Key file is empty or missing.'; }
  mkdir -p "$STATE_DIR" "$PROFILE_DIR" "$AGENT_DIR"
  chmod 700 "$STATE_DIR" "$PROFILE_DIR"
  PLIST_PATH="$AGENT_DIR/$LABEL.plist"
  [ ! -e "$PLIST_PATH" ] && [ ! -L "$PLIST_PATH" ] || die "Existing LaunchAgent at $PLIST_PATH; inspect it before setup."
  for item in "$INSTALLED" "$KEY_PATH" "$CONFIG" "$PROFILE_DIR/shikin.yaml"; do
    [ ! -e "$item" ] && [ ! -L "$item" ] || die "Existing setup file: $item; inspect or uninstall before retrying."
  done
  # Refuse partial overwrites. A failure keeps only these private files for
  # diagnostics; uninstall can remove them even before settings.sh exists.
  cp "$0" "$INSTALLED"
  chmod 700 "$INSTALLED"
  if [ -n "$KEY_SOURCE" ]; then
    cat "$KEY_SOURCE" > "$KEY_PATH"
  else
    printf 'OpenAI tunnel runtime API key (hidden): ' > /dev/tty
    IFS= read -r -s RUNTIME_KEY < /dev/tty || die 'Could not read a key. Use --key-file with a local protected file.'
    printf '\n' > /dev/tty
    [ -n "$RUNTIME_KEY" ] || die 'The runtime key cannot be empty.'
    printf '%s' "$RUNTIME_KEY" > "$KEY_PATH"
    unset RUNTIME_KEY
  fi
  chmod 600 "$KEY_PATH"
  {
    for setting in CONTAINER NODE_PATH MCP_PATH DATA_DIR TUNNEL_ID DOCKER_BIN CLIENT_BIN PLIST_PATH; do
      printf '%s=' "$setting"
      quote "${!setting}"
      printf '\n'
    done
  } > "$CONFIG"
  chmod 600 "$CONFIG"
  MCP_COMMAND="/bin/bash $(quote "$INSTALLED") mcp --state-dir $(quote "$STATE_DIR")"
  "$CLIENT_BIN" init --sample sample_mcp_stdio_local --profile shikin \
    --profile-dir "$PROFILE_DIR" --tunnel-id "$TUNNEL_ID" \
    --control-plane-api-key-ref "file:$KEY_PATH" \
    --health-listen-addr 127.0.0.1:0 --mcp-command "$MCP_COMMAND"
  chmod 600 "$PROFILE_DIR/shikin.yaml"
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>$(xml "$INSTALLED")</string>
    <string>run</string><string>--state-dir</string><string>$(xml "$STATE_DIR")</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml "$LOG_PATH")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG_PATH")</string>
</dict></plist>
PLIST
  chmod 600 "$PLIST_PATH"
  plutil -lint "$PLIST_PATH"
  start_service
  info "Installed helper: $INSTALLED"
  info 'Next: run status/doctor; then create your ChatGPT plugin using Connection: Tunnel.'
  exit 0
fi

if [ "$COMMAND" = uninstall ] && [ ! -f "$CONFIG" ]; then
  PLIST_PATH="$AGENT_DIR/$LABEL.plist"
else
  load_config
fi

case "$COMMAND" in
  check)
    check_target
    info "Existing database and installed MCP found in $CONTAINER. No MCP tools called." ;;
  mcp)
    validate_target
    docker_args
    exec "$DOCKER_BIN" "${DOCKER_ARGS[@]}" mcp ;;
  run)
    require_macos
    rm -f "$URL_PATH"
    check_target
    exec "$CLIENT_BIN" run --profile shikin --profile-dir "$PROFILE_DIR" \
      --health.url-file "$URL_PATH" ;;
  doctor)
    check_target
    exec "$CLIENT_BIN" doctor --profile shikin --profile-dir "$PROFILE_DIR" --explain ;;
  start) start_service ;;
  stop) stop_service ;;
  status)
    require_macos
    if ! launchctl print "$(service_target)" >/dev/null 2>&1; then
      info 'Tunnel service is not loaded. Run start.'; exit 1
    fi
    [ -s "$URL_PATH" ] || { info 'Service loaded, but no health URL yet. Docker may still be starting; check logs.'; exit 1; }
    HEALTH_URL="$(cat "$URL_PATH")"
    [[ "$HEALTH_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || die 'Unexpected local health URL; restart the tunnel.'
    if curl --noproxy '*' --silent --show-error --fail --max-time 3 "$HEALTH_URL/readyz"; then
      info "Tunnel reports ready. Local admin UI: $HEALTH_URL/ui"
      info 'A successful ChatGPT tool call is still needed to verify plugin access.'
    else
      info 'Service loaded, but tunnel is not ready. Run doctor and inspect logs.'; exit 1
    fi ;;
  logs)
    [ -f "$LOG_PATH" ] || die 'No tunnel log yet.'
    tail -n 60 "$LOG_PATH" ;;
  uninstall)
    stop_service
    rm -f "$PLIST_PATH" "$CONFIG" "$KEY_PATH" "$PROFILE_DIR/shikin.yaml" "$URL_PATH" "$LOG_PATH" "$INSTALLED"
    rmdir "$PROFILE_DIR" "$STATE_DIR" 2>/dev/null || true
    info 'Removed tunnel setup and its copied runtime key. Original key file, Docker data and Shikin are untouched.' ;;
esac
