#!/usr/bin/env bash
set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# MINGW*/MSYS* is Git Bash, CYGWIN* is Cygwin's bash -- both are "Windows"
# for launch purposes: no X11/Wayland display server, native chrome.exe
# instead of a `google-chrome` binary on PATH, and argv paths need explicit
# conversion to Windows form (via cygpath) rather than relying on the
# MSYS/Cygwin POSIX-path-in-argv auto-mangling heuristic, which is
# inconsistent about rewriting paths embedded after `--flag=`.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) is_windows=1 ;;
  *) is_windows=0 ;;
esac

if [ "$is_windows" -eq 1 ]; then
  default_chrome_bin=""
  for candidate in \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "$HOME/AppData/Local/Google/Chrome/Application/chrome.exe"
  do
    if [ -f "$candidate" ]; then
      default_chrome_bin="$candidate"
      break
    fi
  done
else
  default_chrome_bin="google-chrome"
fi

chrome_bin="${MB_CHROME_BIN:-$default_chrome_bin}"
profile_dir="${MB_CHROME_PROFILE:-$HOME/.local/share/mute-block-chrome-dev-profile}"
port="${MB_CDP_PORT:-9222}"
extension_dir="${MB_EXTENSION_PATH:-$repo_root/chrome-dev}"
start_url="${1:-chrome://extensions/}"
log_file="${MB_CHROME_LAUNCH_LOG:-$profile_dir.launch.log}"

if [ -z "$chrome_bin" ]; then
  echo "could not find a Chrome binary; set MB_CHROME_BIN explicitly" >&2
  exit 1
fi

if [ ! -f "$extension_dir/manifest.json" ]; then
  echo "no unpacked dev extension at $extension_dir; run 'npm run prod && npm run build:chrome-dev' first" >&2
  exit 1
fi

ozone_args=()
if [ "$is_windows" -eq 1 ]; then
  : # No X11/Wayland concept on Windows -- Chrome uses its native backend.
else
  # Trust whatever GUI environment the invoking shell already has -- do not
  # guess a display. This machine can have more than one X/Wayland session
  # alive at once (e.g. a login-greeter session on a different VT), and
  # defaulting to a socket that merely *exists* can silently point Chrome at
  # a session the user isn't actually looking at, producing a window that
  # "launches" but is never visible. If neither is set, fail loudly instead.
  : "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
  export XDG_RUNTIME_DIR
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "neither DISPLAY nor WAYLAND_DISPLAY is set in this shell; refusing to guess a display." >&2
    echo "run this from a terminal on your actual desktop session." >&2
    exit 1
  fi
  # If only X11 is present, force Chrome to use it rather than risk it picking
  # a Wayland backend from some other, unrelated session's leftover socket.
  if [ -n "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    ozone_args=(--ozone-platform=x11)
  fi
fi

mkdir -p "$profile_dir"

# Native chrome.exe doesn't understand MSYS/Cygwin POSIX paths -- convert
# explicitly rather than trust argv auto-mangling for `--flag=value` forms.
if [ "$is_windows" -eq 1 ]; then
  profile_dir_native="$(cygpath -w "$profile_dir")"
  extension_dir_native="$(cygpath -w "$extension_dir")"
else
  profile_dir_native="$profile_dir"
  extension_dir_native="$extension_dir"
fi

echo "Launching local Chrome with Mute Block dev extension"
echo "  platform:          $([ "$is_windows" -eq 1 ] && echo windows || echo linux) ($(uname -s))"
echo "  chrome:            $chrome_bin"
echo "  profile:           $profile_dir_native"
echo "  extension:         $extension_dir_native"
echo "  CDP:               http://127.0.0.1:$port/json/version"
echo "  URL:               $start_url"
if [ "$is_windows" -eq 0 ]; then
  echo "  DISPLAY:           ${DISPLAY:-<unset>}"
  echo "  WAYLAND_DISPLAY:   ${WAYLAND_DISPLAY:-<unset>}"
  echo "  XDG_RUNTIME_DIR:   $XDG_RUNTIME_DIR"
fi
echo "  log file:          $log_file"

"$chrome_bin" \
  --user-data-dir="$profile_dir_native" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$port" \
  --no-first-run \
  --no-default-browser-check \
  "${ozone_args[@]}" \
  --load-extension="$extension_dir_native" \
  --new-window \
  "$start_url" \
  > "$log_file" 2>&1 &
chrome_pid=$!

echo "Chrome pid: $chrome_pid (waiting up to 15s for CDP on port $port)"

up=0
for _ in $(seq 1 30); do
  if ! kill -0 "$chrome_pid" 2>/dev/null; then
    echo "Chrome process exited early (pid $chrome_pid gone). Log tail:"
    tail -n 20 "$log_file" 2>/dev/null
    exit 1
  fi
  if curl -sS --max-time 1 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; then
    up=1
    break
  fi
  sleep 0.5
done

if [ "$up" -eq 1 ]; then
  echo "CDP is up on 127.0.0.1:$port (pid $chrome_pid, still running in background)."
  echo "If you don't see a Chrome window on screen, this is a display/window-manager"
  echo "issue rather than a launch failure -- check DISPLAY/WAYLAND_DISPLAY above."
  exit 0
else
  echo "Chrome pid $chrome_pid is running but CDP never came up on port $port after 15s."
  echo "Log tail:"
  tail -n 20 "$log_file" 2>/dev/null
  exit 1
fi
