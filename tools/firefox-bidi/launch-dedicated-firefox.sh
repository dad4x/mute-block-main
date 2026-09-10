#!/usr/bin/env bash
set -eu

firefox_bin="${MB_FIREFOX_BIN:-/bin/firefox}"
profile_dir="${MB_FIREFOX_PROFILE:-/scratch/dbrower/mute-block-firefox-bidi-profile}"
port="${MB_FIREFOX_BIDI_PORT:-9224}"
start_url="${1:-about:blank}"

mkdir -p "$profile_dir"

echo "Launching dedicated Firefox BiDi profile"
echo "  firefox: $firefox_bin"
echo "  profile: $profile_dir"
echo "  BiDi:    ws://127.0.0.1:$port/session"
echo "  URL:     $start_url"

exec "$firefox_bin" \
  --new-instance \
  --profile "$profile_dir" \
  --remote-debugging-port "$port" \
  --remote-allow-hosts 127.0.0.1,localhost \
  "$start_url"
