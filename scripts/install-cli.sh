#!/usr/bin/env sh
set -eu

REPO="${SHIKIN_REPO:-g0dxn4/Shikin}"
VERSION="${SHIKIN_VERSION:-}"
INSTALL_DIR="${SHIKIN_CLI_INSTALL_DIR:-}"
BIN_DIR="${SHIKIN_CLI_BIN_DIR:-}"
RELEASE_TAG=""
TMP_DIR=""
STAGE_DIR=""

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[0;32m')"
  YELLOW="$(printf '\033[1;33m')"
  NC="$(printf '\033[0m')"
else
  BOLD=""
  DIM=""
  GREEN=""
  YELLOW=""
  NC=""
fi

usage() {
  printf '%s\n' 'Usage: install-cli.sh [--version VERSION] [--install-dir DIR] [--bin-dir DIR]'
  printf '%s\n' ''
  printf '%s\n' 'Installs Shikin CLI/MCP automation and hosted-web support.'
  printf '%s\n' ''
  printf '%s\n' 'Options:'
  printf '%s\n' '  --version VERSION  Install CLI support from a release tag, for example 0.2.6 or v0.2.6'
  printf '%s\n' '  --install-dir DIR  Install support files here (default: app data cli-support directory)'
  printf '%s\n' '  --bin-dir DIR      Write optional helper shims here (default: ~/.local/bin)'
  printf '%s\n' '  --repo OWNER/NAME  GitHub repo to download from (default: g0dxn4/Shikin)'
  printf '%s\n' '  -h, --help         Show this help'
  printf '%s\n' ''
  printf '%s\n' 'Environment:'
  printf '%s\n' '  SHIKIN_VERSION          Same as --version'
  printf '%s\n' '  SHIKIN_CLI_INSTALL_DIR  Same as --install-dir'
  printf '%s\n' '  SHIKIN_CLI_BIN_DIR      Same as --bin-dir'
  printf '%s\n' '  SHIKIN_REPO             Same as --repo'
}

die() {
  printf 'shikin cli installer: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

cleanup() {
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
  [ -z "$STAGE_DIR" ] || rm -rf "$STAGE_DIR"
}
trap cleanup EXIT INT TERM

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      shift
      [ "$#" -gt 0 ] || die '--version requires a value'
      VERSION="$1"
      ;;
    --version=*)
      VERSION="${1#--version=}"
      ;;
    --install-dir)
      shift
      [ "$#" -gt 0 ] || die '--install-dir requires a value'
      INSTALL_DIR="$1"
      ;;
    --install-dir=*)
      INSTALL_DIR="${1#--install-dir=}"
      ;;
    --bin-dir)
      shift
      [ "$#" -gt 0 ] || die '--bin-dir requires a value'
      BIN_DIR="$1"
      ;;
    --bin-dir=*)
      BIN_DIR="${1#--bin-dir=}"
      ;;
    --repo)
      shift
      [ "$#" -gt 0 ] || die '--repo requires a value'
      REPO="$1"
      ;;
    --repo=*)
      REPO="${1#--repo=}"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

PLATFORM="$(uname -s)"
case "$PLATFORM" in
  Linux | Darwin) ;;
  *) die 'this installer supports Linux and macOS' ;;
esac
[ -n "${HOME:-}" ] || die 'HOME must be set'

command_exists curl || die 'curl is required'
command_exists head || die 'head is required'
command_exists mktemp || die 'mktemp is required'
command_exists node || die 'Node.js is required'
command_exists npm || die 'npm is required as a fallback when Corepack is unavailable'
node -e "const major = Number(process.versions.node.split('.')[0]); process.exit(Number.isFinite(major) && major >= 18 ? 0 : 1)" \
  || die 'Node.js >= 18 is required'
command_exists sed || die 'sed is required'
if ! command_exists sha256sum && ! command_exists shasum; then
  die 'sha256sum or shasum is required'
fi
command_exists tar || die 'tar is required'
command_exists tr || die 'tr is required'

if [ "$PLATFORM" = "Darwin" ]; then
  DATA_HOME="${HOME}/Library/Application Support"
else
  DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
  case "$DATA_HOME" in
    /*) ;;
    *) DATA_HOME="${HOME}/.local/share" ;;
  esac
fi

INSTALL_DIR="${INSTALL_DIR:-${DATA_HOME}/com.asf.shikin/cli-support}"
BIN_DIR="${BIN_DIR:-${HOME}/.local/bin}"

case "$INSTALL_DIR" in
  '') die 'install directory cannot be empty' ;;
esac

case "$BIN_DIR" in
  '') die 'bin directory cannot be empty' ;;
esac

TMP_DIR="$(mktemp -d)"
RELEASE_JSON="${TMP_DIR}/release.json"
SOURCE_DIR="${TMP_DIR}/source"

if [ -n "$VERSION" ]; then
  case "$VERSION" in
    v*) RELEASE_TAG="$VERSION" ;;
    *) RELEASE_TAG="v${VERSION}" ;;
  esac
else
  info 'Fetching latest Shikin release metadata'
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" -o "$RELEASE_JSON"
  RELEASE_TAG="$(tr -d '\n\r' <"$RELEASE_JSON" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1)"
  [ -n "$RELEASE_TAG" ] || die 'could not determine latest release tag'
fi

ASSET_NAME="shikin-cli-source-${RELEASE_TAG}.tar.gz"
ARCHIVE_FILE="${TMP_DIR}/${ASSET_NAME}"
CHECKSUM_FILE="${ARCHIVE_FILE}.sha256"
SOURCE_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${ASSET_NAME}"
CHECKSUM_URL="${SOURCE_URL}.sha256"

printf '\n'
printf '%s%sShikin CLI/MCP support%s\n' "$BOLD" "$GREEN" "$NC"
printf '%sRelease:%s %s\n' "$DIM" "$NC" "$RELEASE_TAG"
printf '%sInstall dir:%s %s\n' "$DIM" "$NC" "$INSTALL_DIR"
printf '%sHelper shims:%s %s\n' "$DIM" "$NC" "$BIN_DIR"
printf '\n'

info 'Downloading checksummed Shikin CLI source archive'
curl -fL "$SOURCE_URL" -o "$ARCHIVE_FILE"
curl -fL "$CHECKSUM_URL" -o "$CHECKSUM_FILE"
[ -s "$ARCHIVE_FILE" ] || die 'downloaded source archive is empty'
[ -s "$CHECKSUM_FILE" ] || die 'downloaded checksum is empty'
if command_exists sha256sum; then
  (cd "$TMP_DIR" && sha256sum -c "${ASSET_NAME}.sha256") \
    || die 'source archive checksum verification failed'
else
  (cd "$TMP_DIR" && shasum -a 256 -c "${ASSET_NAME}.sha256") \
    || die 'source archive checksum verification failed'
fi

mkdir -p "$SOURCE_DIR"
tar -xzf "$ARCHIVE_FILE" -C "$SOURCE_DIR"

SOURCE_ROOT=""
for candidate in "$SOURCE_DIR"/*; do
  if [ -f "$candidate/package.json" ] \
    && [ -f "$candidate/pnpm-lock.yaml" ] \
    && [ -f "$candidate/pnpm-workspace.yaml" ] \
    && [ -f "$candidate/cli/package.json" ] \
    && [ -f "$candidate/packages/finance-core/package.json" ]; then
    SOURCE_ROOT="$candidate"
    break
  fi
done
[ -n "$SOURCE_ROOT" ] || die 'could not find the complete pnpm workspace in the source archive'

PNPM_SPEC="$(node -e "const p=require(process.argv[1]); const spec=p.packageManager || ''; if(!spec.startsWith('pnpm@') || /\\s/.test(spec)) process.exit(1); process.stdout.write(spec)" "$SOURCE_ROOT/package.json")" \
  || die 'source package.json does not pin pnpm through packageManager'
PNPM_VERSION="${PNPM_SPEC#pnpm@}"

run_pnpm() {
  if command_exists corepack; then
    corepack pnpm "$@"
  else
    npx --yes "pnpm@${PNPM_VERSION}" "$@"
  fi
}

ACTUAL_PNPM_VERSION="$(cd "$SOURCE_ROOT" && run_pnpm --version)"
[ "$ACTUAL_PNPM_VERSION" = "$PNPM_VERSION" ] \
  || die "expected repository-pinned pnpm ${PNPM_VERSION}, received ${ACTUAL_PNPM_VERSION}"

INSTALL_PARENT="${INSTALL_DIR%/*}"
[ "$INSTALL_PARENT" != "$INSTALL_DIR" ] || INSTALL_PARENT='.'
mkdir -p "$INSTALL_PARENT"

info "Installing complete workspace with pnpm ${PNPM_VERSION}"
(cd "$SOURCE_ROOT" && run_pnpm install --frozen-lockfile)

info 'Building CLI support'
(cd "$SOURCE_ROOT" && run_pnpm --dir cli build)

STAGE_DIR="${INSTALL_DIR}.tmp.$$"
rm -rf "$STAGE_DIR"
info 'Deploying self-contained production CLI support'
(cd "$SOURCE_ROOT" && run_pnpm --filter @shikin/cli deploy --prod "$STAGE_DIR")

[ -f "$STAGE_DIR/package.json" ] || die 'deployment omitted package.json'
[ -f "$STAGE_DIR/dist/cli.js" ] || die 'deployment omitted dist/cli.js'
[ -f "$STAGE_DIR/dist/mcp-server.js" ] || die 'deployment omitted dist/mcp-server.js'
[ -f "$STAGE_DIR/web/index.html" ] || die 'deployment omitted packaged web/index.html'
[ -d "$STAGE_DIR/node_modules" ] || die 'deployment omitted production node_modules'

NODE_BIN="$(command -v node)"
case "$NODE_BIN" in
  /*) ;;
  *) die 'could not resolve Node.js to an absolute executable path' ;;
esac
printf '%s\n' "$NODE_BIN" >"$STAGE_DIR/node-path"
chmod 600 "$STAGE_DIR/node-path"

rm -rf "$INSTALL_DIR"
mv "$STAGE_DIR" "$INSTALL_DIR"
STAGE_DIR=""

shell_quote() {
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

write_node_shim() {
  name="$1"
  script_path="$2"
  shim_path="${BIN_DIR}/${name}"
  quoted_node_path="$(shell_quote "$NODE_BIN")"
  quoted_script_path="$(shell_quote "$script_path")"

  mkdir -p "$BIN_DIR"
  {
    printf '%s\n' '#!/usr/bin/env sh'
    printf "exec '%s' '%s' \"\$@\"\n" "$quoted_node_path" "$quoted_script_path"
  } >"$shim_path"
  chmod +x "$shim_path"
}

write_node_shim 'shikin-bridge' "${INSTALL_DIR}/dist/cli.js"
write_node_shim 'shikin-mcp' "${INSTALL_DIR}/dist/mcp-server.js"

if [ "$PLATFORM" = "Darwin" ]; then
  SHIKIN_SHIM="${BIN_DIR}/shikin"
  quoted_node_path="$(shell_quote "$NODE_BIN")"
  quoted_cli_path="$(shell_quote "${INSTALL_DIR}/dist/cli.js")"
  quoted_mcp_path="$(shell_quote "${INSTALL_DIR}/dist/mcp-server.js")"
  mkdir -p "$BIN_DIR"
  {
    printf '%s\n' '#!/usr/bin/env sh'
    printf '%s\n' 'if [ "$#" -eq 0 ]; then'
    printf '%s\n' '  exec open -a Shikin'
    printf '%s\n' 'fi'
    printf '%s\n' 'if [ "${1:-}" = "mcp" ]; then'
    printf '%s\n' '  shift'
    printf "  exec '%s' '%s' \"\$@\"\n" "$quoted_node_path" "$quoted_mcp_path"
    printf '%s\n' 'fi'
    printf "exec '%s' '%s' \"\$@\"\n" "$quoted_node_path" "$quoted_cli_path"
  } >"$SHIKIN_SHIM"
  chmod +x "$SHIKIN_SHIM"
fi

case ":${PATH:-}:" in
  *":${BIN_DIR}:"*) ;;
  *) warn "${BIN_DIR} is not on PATH; direct shikin-bridge/shikin-mcp helpers may not work, but shikin commands still use the app data install" ;;
esac

info "CLI support installed under ${INSTALL_DIR}"
if [ "$PLATFORM" = "Darwin" ]; then
  info "The macOS shikin helper was installed at ${BIN_DIR}/shikin"
else
  info 'The desktop-owned shikin command will use this support'
fi
info 'Try: shikin list-accounts or shikin web --port 8480'
