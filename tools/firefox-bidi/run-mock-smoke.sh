#!/usr/bin/env bash
set -eu

mock_host="${MB_MOCK_QUORA_HOST:-127.0.0.1}"
mock_port="${MB_MOCK_QUORA_PORT:-18765}"
bidi_port="${MB_FIREFOX_BIDI_PORT:-9225}"
profile_dir="${MB_FIREFOX_PROFILE:-/scratch/dbrower/mute-block-firefox-bidi-profile}"
base_url="http://${mock_host}:${mock_port}"
firefox_log="${MB_FIREFOX_BIDI_LOG:-/tmp/mb-firefox-bidi.log}"

mock_pid=""
firefox_pid=""

cleanup() {
  if [ -n "$firefox_pid" ]; then
    kill "$firefox_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$mock_pid" ]; then
    kill "$mock_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting mock Quora at $base_url"
MB_MOCK_QUORA_HOST="$mock_host" MB_MOCK_QUORA_PORT="$mock_port" \
  node tools/mock-quora/server.js &
mock_pid="$!"

for _ in $(seq 1 30); do
  if curl --noproxy '*' --max-time 1 -sS "$base_url/space/muteblockdevelopment" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo "Starting dedicated Firefox BiDi profile on port $bidi_port"
: > "$firefox_log"
MB_FIREFOX_PROFILE="$profile_dir" MB_FIREFOX_BIDI_PORT="$bidi_port" \
  tools/firefox-bidi/launch-dedicated-firefox.sh "$base_url/" >"$firefox_log" 2>&1 &
firefox_pid="$!"

echo "Waiting for Firefox BiDi"
for attempt in $(seq 1 40); do
  if MB_FIREFOX_BIDI_PORT="$bidi_port" MB_FIREFOX_BIDI_CONNECT_TIMEOUT_MS=750 node tools/firefox-bidi/target-summary.js >/tmp/mb-firefox-bidi-summary.json 2>/tmp/mb-firefox-bidi-summary.err; then
    cat /tmp/mb-firefox-bidi-summary.json
    break
  fi
  if [ "$attempt" = "40" ]; then
    cat /tmp/mb-firefox-bidi-summary.err >&2 || true
    cat "$firefox_log" >&2 || true
    echo "Firefox BiDi did not become ready" >&2
    exit 1
  fi
  sleep 0.5
done

MB_FIREFOX_BIDI_PORT="$bidi_port" MB_MOCK_QUORA_BASE_URL="$base_url" \
  node tools/firefox-bidi/mock-smoke.js

MB_FIREFOX_BIDI_PORT="$bidi_port" \
  node tools/firefox-bidi/extract-mblock.js "$base_url/space/shared-blocks"
