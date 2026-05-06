#!/usr/bin/env sh
set -eu

REPO="${SHIKIN_REPO:-g0dxn4/Shikin}"
VERSION="${SHIKIN_VERSION:-}"
SKILL_NAME="shikin-cli-mcp"
TMP_DIR=""
SOURCE_FILE=""
INSTALL_PORTABLE="yes"
INSTALL_OPENCODE="no"
INSTALL_CLAUDE="no"
INSTALL_AGENTS="no"
CUSTOM_DIR=""

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[0;32m')"
  NC="$(printf '\033[0m')"
else
  BOLD=""
  DIM=""
  GREEN=""
  NC=""
fi

usage() {
  printf '%s\n' 'Usage: install-skill.sh [--version VERSION] [--portable] [--opencode] [--claude] [--agents] [--all] [--dir DIR]'
  printf '%s\n' ''
  printf '%s\n' 'Installs the portable Shikin CLI/MCP Skill.md package for AI tools.'
  printf '%s\n' ''
  printf '%s\n' 'Default:'
  printf '%s\n' '  Installs a portable copy under Shikin app data: ~/.local/share/com.asf.shikin/skills/'
  printf '%s\n' ''
  printf '%s\n' 'Targets:'
  printf '%s\n' '  --portable        Install to Shikin app data skill directory (default)'
  printf '%s\n' '  --opencode        Install to ~/.config/opencode/skills/'
  printf '%s\n' '  --claude          Install to ~/.claude/skills/'
  printf '%s\n' '  --agents          Install to ~/.agents/skills/'
  printf '%s\n' '  --all             Install to portable, OpenCode, Claude, and Agents skill directories'
  printf '%s\n' '  --dir DIR         Install to a custom skills root as DIR/shikin-cli-mcp/SKILL.md'
  printf '%s\n' ''
  printf '%s\n' 'Source:'
  printf '%s\n' '  --version VERSION Install skill from a release tag, for example 0.2.6 or v0.2.6'
  printf '%s\n' '  --repo OWNER/NAME GitHub repo to download from (default: g0dxn4/Shikin)'
  printf '%s\n' '  -h, --help        Show this help'
  printf '%s\n' ''
  printf '%s\n' 'Environment:'
  printf '%s\n' '  SHIKIN_VERSION    Same as --version'
  printf '%s\n' '  SHIKIN_REPO       Same as --repo'
}

die() {
  printf 'shikin skill installer: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '==> %s\n' "$*"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

cleanup() {
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
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
    --repo)
      shift
      [ "$#" -gt 0 ] || die '--repo requires a value'
      REPO="$1"
      ;;
    --repo=*)
      REPO="${1#--repo=}"
      ;;
    --portable)
      INSTALL_PORTABLE="yes"
      ;;
    --opencode)
      INSTALL_OPENCODE="yes"
      INSTALL_PORTABLE="no"
      ;;
    --claude)
      INSTALL_CLAUDE="yes"
      INSTALL_PORTABLE="no"
      ;;
    --agents)
      INSTALL_AGENTS="yes"
      INSTALL_PORTABLE="no"
      ;;
    --all)
      INSTALL_PORTABLE="yes"
      INSTALL_OPENCODE="yes"
      INSTALL_CLAUDE="yes"
      INSTALL_AGENTS="yes"
      ;;
    --dir)
      shift
      [ "$#" -gt 0 ] || die '--dir requires a value'
      CUSTOM_DIR="$1"
      INSTALL_PORTABLE="no"
      ;;
    --dir=*)
      CUSTOM_DIR="${1#--dir=}"
      INSTALL_PORTABLE="no"
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

[ -n "${HOME:-}" ] || die 'HOME must be set'

LOCAL_SKILL=""
case "$0" in
  */*)
    SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" 2>/dev/null && pwd || pwd)"
    LOCAL_SKILL="${SCRIPT_DIR}/../skills/${SKILL_NAME}/SKILL.md"
    ;;
esac

if [ -n "$LOCAL_SKILL" ] && [ -f "$LOCAL_SKILL" ]; then
  SOURCE_FILE="$LOCAL_SKILL"
else
  command_exists curl || die 'curl is required'
  command_exists head || die 'head is required'
  command_exists mktemp || die 'mktemp is required'
  command_exists sed || die 'sed is required'
  command_exists tr || die 'tr is required'

  TMP_DIR="$(mktemp -d)"
  RELEASE_JSON="${TMP_DIR}/release.json"
  SOURCE_FILE="${TMP_DIR}/SKILL.md"

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

  curl -fsSL "https://raw.githubusercontent.com/${REPO}/${RELEASE_TAG}/skills/${SKILL_NAME}/SKILL.md" -o "$SOURCE_FILE"
  [ -s "$SOURCE_FILE" ] || die 'downloaded skill file is empty'
fi

DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
case "$DATA_HOME" in
  /*) ;;
  *) DATA_HOME="${HOME}/.local/share" ;;
esac

CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
case "$CONFIG_HOME" in
  /*) ;;
  *) CONFIG_HOME="${HOME}/.config" ;;
esac

install_skill_to_root() {
  root_dir="$1"
  target_dir="${root_dir}/${SKILL_NAME}"
  mkdir -p "$target_dir"
  cp "$SOURCE_FILE" "${target_dir}/SKILL.md"
  chmod 0644 "${target_dir}/SKILL.md"
  printf '%s\n' "${target_dir}/SKILL.md"
}

printf '\n'
printf '%s%sShikin AI skill%s\n' "$BOLD" "$GREEN" "$NC"
printf '%sSkill:%s %s\n' "$DIM" "$NC" "$SKILL_NAME"
printf '\n'

INSTALLED_PATHS=""

if [ "$INSTALL_PORTABLE" = "yes" ]; then
  path="$(install_skill_to_root "${DATA_HOME}/com.asf.shikin/skills")"
  INSTALLED_PATHS="${INSTALLED_PATHS}${path}
"
fi

if [ "$INSTALL_OPENCODE" = "yes" ]; then
  path="$(install_skill_to_root "${CONFIG_HOME}/opencode/skills")"
  INSTALLED_PATHS="${INSTALLED_PATHS}${path}
"
fi

if [ "$INSTALL_CLAUDE" = "yes" ]; then
  path="$(install_skill_to_root "${HOME}/.claude/skills")"
  INSTALLED_PATHS="${INSTALLED_PATHS}${path}
"
fi

if [ "$INSTALL_AGENTS" = "yes" ]; then
  path="$(install_skill_to_root "${HOME}/.agents/skills")"
  INSTALLED_PATHS="${INSTALLED_PATHS}${path}
"
fi

if [ -n "$CUSTOM_DIR" ]; then
  path="$(install_skill_to_root "$CUSTOM_DIR")"
  INSTALLED_PATHS="${INSTALLED_PATHS}${path}
"
fi

[ -n "$INSTALLED_PATHS" ] || die 'no install target selected'

info 'Installed skill file(s):'
printf '%s' "$INSTALLED_PATHS" | while IFS= read -r installed_path; do
  [ -n "$installed_path" ] || continue
  printf '  %s\n' "$installed_path"
done

info "Use this Skill.md with any AI tool that supports file-based skills, or copy it into that tool's skill directory."
