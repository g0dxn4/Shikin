#!/usr/bin/env sh
set -eu

REPO="${SHIKIN_REPO:-g0dxn4/Shikin}"
VERSION="${SHIKIN_VERSION:-}"
INSTALL_KIND="${SHIKIN_INSTALL_KIND:-choose}"
REQUESTED_INSTALL_KIND="$INSTALL_KIND"
NO_SUDO="${SHIKIN_NO_SUDO:-0}"
INSTALL_DIR="${SHIKIN_INSTALL_DIR:-}"
OS_RELEASE_FILE="${SHIKIN_OS_RELEASE_FILE:-/etc/os-release}"
ASSET_DEB_PATTERN='_amd64\.deb'
ASSET_RPM_PATTERN='x86_64\.rpm'
ASSET_APPIMAGE_PATTERN='_amd64\.AppImage'
DETECTED_ARCH=""
DETECTED_DISTRO_NAME="Linux"
DETECTED_DISTRO_ID="unknown"
DETECTED_DISTRO_ID_LIKE=""

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  CYAN="$(printf '\033[0;36m')"
  GREEN="$(printf '\033[0;32m')"
  YELLOW="$(printf '\033[1;33m')"
  NC="$(printf '\033[0m')"
else
  BOLD=""
  DIM=""
  CYAN=""
  GREEN=""
  YELLOW=""
  NC=""
fi

if [ -n "$VERSION" ]; then
  case "$VERSION" in
    v*) RELEASE_TAG="$VERSION" ;;
    *) RELEASE_TAG="v${VERSION}" ;;
  esac
  API_URL="${SHIKIN_RELEASE_API:-https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}}"
else
  API_URL="${SHIKIN_RELEASE_API:-https://api.github.com/repos/${REPO}/releases/latest}"
fi

usage() {
  printf '%s\n' 'Usage: install-linux.sh [--choose|--auto|--deb|--rpm|--appimage] [--no-sudo]'
  printf '%s\n' ''
  printf '%s\n' 'Installs the latest Shikin Linux desktop release.'
  printf '%s\n' ''
  printf '%s\n' 'Options:'
  printf '%s\n' '  --choose     Ask whether to install the .deb, .rpm, or AppImage (default)'
  printf '%s\n' '  --auto       Use .deb on Debian/Ubuntu, .rpm on RPM distros, AppImage elsewhere'
  printf '%s\n' '  --deb        Force the Debian/Ubuntu .deb installer; may require sudo'
  printf '%s\n' '  --rpm        Force the RPM installer; may require sudo'
  printf '%s\n' '  --appimage   Force the portable AppImage installer; does not use sudo'
  printf '%s\n' '  --no-sudo    Install the AppImage under your home directory; never calls sudo'
  printf '%s\n' '  --sudo       Allow sudo prompts for native packages (default)'
  printf '%s\n' '  -h, --help   Show this help'
  printf '%s\n' ''
  printf '%s\n' 'Environment:'
  printf '%s\n' '  SHIKIN_INSTALL_DIR   AppImage install directory (default: ~/Applications)'
  printf '%s\n' '  SHIKIN_INSTALL_KIND  choose, auto, deb, rpm, or appimage'
  printf '%s\n' '  SHIKIN_NO_SUDO       1/yes/true to force the no-sudo AppImage path'
  printf '%s\n' '  SHIKIN_REPO          GitHub repo owner/name (default: g0dxn4/Shikin)'
  printf '%s\n' '  SHIKIN_VERSION       Release version, for example 0.2.6 or v0.2.6'
}

die() {
  printf 'shikin installer: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '==> %s\n' "$*"
}

print_banner() {
  printf '\n'
  printf '%s%s+--------------------------------------------------+%s\n' "$CYAN" "$BOLD" "$NC"
  printf '%s%s|                  Shikin Installer               |%s\n' "$CYAN" "$BOLD" "$NC"
  printf '%s%s|       Local-first finance for your desktop       |%s\n' "$CYAN" "$BOLD" "$NC"
  printf '%s%s+--------------------------------------------------+%s\n' "$CYAN" "$BOLD" "$NC"
  printf '\n'
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --auto)
      INSTALL_KIND="auto"
      ;;
    --choose | --interactive)
      INSTALL_KIND="choose"
      ;;
    --deb)
      INSTALL_KIND="deb"
      ;;
    --rpm)
      INSTALL_KIND="rpm"
      ;;
    --appimage)
      INSTALL_KIND="appimage"
      ;;
    --no-sudo)
      NO_SUDO="1"
      ;;
    --sudo)
      NO_SUDO="0"
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

case "$INSTALL_KIND" in
  auto | choose | deb | rpm | appimage) ;;
  *) die "SHIKIN_INSTALL_KIND must be choose, auto, deb, rpm, or appimage" ;;
esac

case "$NO_SUDO" in
  1 | yes | YES | true | TRUE | on | ON)
    NO_SUDO="1"
    ;;
  0 | no | NO | false | FALSE | off | OFF | "")
    NO_SUDO="0"
    ;;
  *) die "SHIKIN_NO_SUDO must be 1, 0, yes, no, true, or false" ;;
esac
REQUESTED_INSTALL_KIND="$INSTALL_KIND"

[ "$(uname -s)" = "Linux" ] || die "this installer only supports Linux"

DETECTED_ARCH="$(uname -m)"
case "$DETECTED_ARCH" in
  x86_64 | amd64) ;;
  *) die "only amd64 Linux release assets are currently published; use the release page or build from source" ;;
esac

command_exists curl || die "curl is required"
command_exists sed || die "sed is required"
command_exists head || die "head is required"
command_exists mktemp || die "mktemp is required"
command_exists tr || die "tr is required"

TMP_DIR="$(mktemp -d)"
RELEASE_JSON="${TMP_DIR}/release.json"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

detect_linux_distro() {
  if [ -r "$OS_RELEASE_FILE" ]; then
    PRETTY_NAME=""
    NAME=""
    ID=""
    ID_LIKE=""

    # /etc/os-release is the standard Linux distribution identity file.
    # shellcheck disable=SC1090,SC1091
    . "$OS_RELEASE_FILE"

    DETECTED_DISTRO_NAME="${PRETTY_NAME:-${NAME:-Linux}}"
    DETECTED_DISTRO_ID="${ID:-unknown}"
    DETECTED_DISTRO_ID_LIKE="${ID_LIKE:-}"
  fi
}

is_debian_like() {
  case "${DETECTED_DISTRO_ID} ${DETECTED_DISTRO_ID_LIKE}" in
    *debian* | *ubuntu*) return 0 ;;
  esac

  return 1
}

is_rpm_like() {
  case "${DETECTED_DISTRO_ID} ${DETECTED_DISTRO_ID_LIKE}" in
    *fedora* | *rhel* | *centos* | *suse* | *opensuse*) return 0 ;;
  esac

  return 1
}

describe_detection() {
  info "Detected Linux distro: ${DETECTED_DISTRO_NAME} (${DETECTED_DISTRO_ID})"
  [ -z "$DETECTED_DISTRO_ID_LIKE" ] || info "Detected distro family: ${DETECTED_DISTRO_ID_LIKE}"
  info "Detected CPU architecture: ${DETECTED_ARCH}; using amd64/x86_64 release assets"
}

describe_install_choice() {
  case "$INSTALL_KIND" in
    deb)
      if [ "$REQUESTED_INSTALL_KIND" = "auto" ]; then
        info "Selected .deb install because this looks like Debian/Ubuntu and apt-get is available"
      elif [ "$REQUESTED_INSTALL_KIND" = "choose" ]; then
        info "Selected .deb install from your choice"
      else
        info "Selected .deb install because it was requested explicitly"
      fi
      ;;
    rpm)
      if [ "$REQUESTED_INSTALL_KIND" = "auto" ]; then
        info "Selected .rpm install because this looks like an RPM distro"
      elif [ "$REQUESTED_INSTALL_KIND" = "choose" ]; then
        info "Selected .rpm install from your choice"
      else
        info "Selected .rpm install because it was requested explicitly"
      fi
      ;;
    appimage)
      if [ "$NO_SUDO" = "1" ]; then
        info "Selected AppImage install because sudo was disabled"
      elif [ "$REQUESTED_INSTALL_KIND" = "auto" ]; then
        info "Selected AppImage install because no native package manager match was detected"
      elif [ "$REQUESTED_INSTALL_KIND" = "choose" ]; then
        info "Selected AppImage install from your choice"
      else
        info "Selected AppImage install because it was requested explicitly"
      fi
      ;;
  esac
}

read_terminal_answer() {
  prompt="$1"
  TERMINAL_ANSWER=""

  if [ -t 0 ] && [ -t 1 ]; then
    printf '%s' "$prompt"
    IFS= read -r TERMINAL_ANSWER || return 1
  elif [ -t 1 ] && { : </dev/tty >/dev/tty; } 2>/dev/null; then
    printf '%s' "$prompt" >/dev/tty
    IFS= read -r TERMINAL_ANSWER </dev/tty || return 1
  else
    return 2
  fi
}

choose_install_kind() {
  recommended_kind="$1"
  default_choice="3"
  if [ "$recommended_kind" = "deb" ]; then
    default_choice="1"
  elif [ "$recommended_kind" = "rpm" ]; then
    default_choice="2"
  fi

  printf '%sWhat would you like to install?%s\n' "$BOLD" "$NC"
  printf '\n'
  printf '  %s1)%s .deb system package       %sDebian/Ubuntu; asks before sudo%s\n' "$BOLD" "$NC" "$DIM" "$NC"
  printf '  %s2)%s .rpm system package       %sFedora/RHEL/openSUSE; asks before sudo%s\n' "$BOLD" "$NC" "$DIM" "$NC"
  printf '  %s3)%s AppImage portable app     %sInstalls under ~/Applications; no sudo%s\n' "$BOLD" "$NC" "$DIM" "$NC"
  printf '\n'
  printf '%sRecommended:%s %s%s%s\n' "$GREEN" "$NC" "$BOLD" "$recommended_kind" "$NC"
  printf '%sTip:%s choose AppImage if you do not want sudo. Native packages ask before sudo and fall back to AppImage if declined.\n' "$YELLOW" "$NC"
  printf '\n'

  if ! read_terminal_answer "Select install type [${default_choice}]: "; then
    die "cannot ask for install choice without an interactive terminal; rerun with --deb, --rpm, or --appimage"
  fi

  case "$TERMINAL_ANSWER" in
    "") TERMINAL_ANSWER="$default_choice" ;;
  esac

  case "$TERMINAL_ANSWER" in
    1 | deb | DEB | .deb) INSTALL_KIND="deb" ;;
    2 | rpm | RPM | .rpm) INSTALL_KIND="rpm" ;;
    3 | appimage | AppImage | APPIMAGE) INSTALL_KIND="appimage" ;;
    *) die "unknown install choice: ${TERMINAL_ANSWER}; expected 1, 2, 3, deb, rpm, or appimage" ;;
  esac
}

find_asset_url() {
  pattern="$1"
  tr -d '\n\r' <"$RELEASE_JSON" \
    | tr '{' '\n' \
    | sed -n "s/.*\"browser_download_url\"[[:space:]]*:[[:space:]]*\"\([^\"]*${pattern}\)\".*/\1/p" \
    | head -n 1
}

request_appimage_fallback() {
  reason="$1"

  case "$REQUESTED_INSTALL_KIND" in
    choose | auto)
      info "$reason"
      info "Continuing with the no-sudo AppImage install instead."
      return 77
      ;;
  esac

  die "${reason}; rerun with --appimage or --no-sudo to avoid sudo"
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if [ "$NO_SUDO" = "1" ]; then
    request_appimage_fallback "Sudo is disabled"
    return $?
  fi

  if ! command_exists sudo; then
    request_appimage_fallback "sudo is not available"
    return $?
  fi

  info "Native package installation requires administrator privileges."
  info "No-sudo alternative: rerun this installer with --appimage to install under your home directory."

  if ! read_terminal_answer 'Continue with sudo package install? [y/N] '; then
    request_appimage_fallback "Cannot ask for sudo confirmation without an interactive terminal"
    return $?
  fi

  case "$TERMINAL_ANSWER" in
    y | Y | yes | YES | Yes) ;;
    *)
      request_appimage_fallback "Sudo package install was declined"
      return $?
      ;;
  esac

  if ! sudo "$@"; then
    die "native package installation failed"
  fi
}

refresh_desktop_database() {
  applications_dir="$1"
  if command_exists update-desktop-database; then
    update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
  fi
}

write_desktop_entry() {
  applications_dir="$1"
  exec_command="$2"
  escaped_exec_command="$(printf '%s' "$exec_command" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  desktop_file="${applications_dir}/Shikin.desktop"

  rm -f "${applications_dir}/shikin.desktop"
  {
    printf '%s\n' '[Desktop Entry]'
    printf '%s\n' 'Type=Application'
    printf '%s\n' 'Name=Shikin'
    printf '%s\n' 'Comment=Local-first personal finance manager'
    printf 'Exec="%s"\n' "$escaped_exec_command"
    printf '%s\n' 'Icon=Shikin'
    printf '%s\n' 'Terminal=false'
    printf '%s\n' 'Categories=Office;Finance;'
    printf '%s\n' 'StartupWMClass=Shikin'
  } >"$desktop_file"
  chmod 644 "$desktop_file"
}

configure_user_launcher() {
  exec_command="$1"
  [ -n "${HOME:-}" ] || return 0

  applications_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
  mkdir -p "$applications_dir"
  write_desktop_entry "$applications_dir" "$exec_command"
  refresh_desktop_database "$applications_dir"
}

install_deb() {
  command_exists apt-get || die ".deb installation requires apt-get; rerun with --appimage for portable install"

  deb_url="$(find_asset_url "$ASSET_DEB_PATTERN")"
  [ -n "$deb_url" ] || die "could not find an amd64 .deb asset in the release"

  deb_file="${TMP_DIR}/shikin-latest-amd64.deb"
  info "Downloading Shikin .deb"
  curl -fL "$deb_url" -o "$deb_file"
  [ -s "$deb_file" ] || die "downloaded .deb asset is empty"

  info "Installing Shikin with apt-get"
  if run_as_root apt-get install -y "$deb_file"; then
    :
  else
    status="$?"
    if [ "$status" -eq 77 ]; then
      install_appimage
      return
    fi
    return "$status"
  fi
  configure_user_launcher "shikin"

  info "Shikin installed. Launch it from your app menu."
}

install_rpm() {
  rpm_url="$(find_asset_url "$ASSET_RPM_PATTERN")"
  [ -n "$rpm_url" ] || die "could not find an x86_64 .rpm asset in the release"

  rpm_file="${TMP_DIR}/shikin-latest-x86_64.rpm"
  info "Downloading Shikin .rpm"
  curl -fL "$rpm_url" -o "$rpm_file"
  [ -s "$rpm_file" ] || die "downloaded .rpm asset is empty"

  if command_exists dnf; then
    info "Installing Shikin with dnf"
    if run_as_root dnf install -y "$rpm_file"; then
      :
    else
      status="$?"
      if [ "$status" -eq 77 ]; then
        install_appimage
        return
      fi
      return "$status"
    fi
  elif command_exists zypper; then
    info "Installing Shikin with zypper"
    if run_as_root zypper --non-interactive install "$rpm_file"; then
      :
    else
      status="$?"
      if [ "$status" -eq 77 ]; then
        install_appimage
        return
      fi
      return "$status"
    fi
  elif command_exists rpm; then
    info "Installing Shikin with rpm"
    if run_as_root rpm -Uvh "$rpm_file"; then
      :
    else
      status="$?"
      if [ "$status" -eq 77 ]; then
        install_appimage
        return
      fi
      return "$status"
    fi
  else
    die ".rpm installation requires dnf, zypper, or rpm; rerun with --appimage for portable install"
  fi
  configure_user_launcher "shikin"

  info "Shikin installed. Launch it from your app menu."
}

install_appimage() {
  [ -n "${HOME:-}" ] || die "HOME must be set for AppImage installation"
  appimage_dir="${INSTALL_DIR:-${HOME}/Applications}"

  appimage_url="$(find_asset_url "$ASSET_APPIMAGE_PATTERN")"
  [ -n "$appimage_url" ] || die "could not find an amd64 AppImage asset in the release"

  mkdir -p "$appimage_dir"
  appimage_path="${appimage_dir}/Shikin.AppImage"

  info "Downloading Shikin AppImage to ${appimage_path}"
  curl -fL "$appimage_url" -o "$appimage_path"
  [ -s "$appimage_path" ] || die "downloaded AppImage asset is empty"
  chmod +x "$appimage_path"
  configure_user_launcher "$appimage_path"

  info "Shikin AppImage installed. Launch it from your app menu or run: ${appimage_path}"
}

detect_linux_distro
print_banner
describe_detection

RECOMMENDED_INSTALL_KIND="appimage"
if is_debian_like && command_exists apt-get; then
  RECOMMENDED_INSTALL_KIND="deb"
elif is_rpm_like && { command_exists dnf || command_exists zypper || command_exists rpm; }; then
  RECOMMENDED_INSTALL_KIND="rpm"
fi

if [ "$NO_SUDO" = "1" ] && [ "$INSTALL_KIND" != "appimage" ]; then
  info "Sudo disabled; selecting AppImage."
  INSTALL_KIND="appimage"
elif [ "$INSTALL_KIND" = "choose" ]; then
  choose_install_kind "$RECOMMENDED_INSTALL_KIND"
elif [ "$INSTALL_KIND" = "auto" ]; then
  INSTALL_KIND="$RECOMMENDED_INSTALL_KIND"
fi
describe_install_choice

info "Fetching Shikin release metadata"
curl -fsSL "$API_URL" -o "$RELEASE_JSON"

case "$INSTALL_KIND" in
  deb) install_deb ;;
  rpm) install_rpm ;;
  appimage) install_appimage ;;
esac
