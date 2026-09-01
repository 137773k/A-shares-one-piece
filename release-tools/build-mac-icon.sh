#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
source_png="$project_root/expo-app/assets/icon.png"
output_dir="$project_root/.cache/mac-icon"
output_icns="$output_dir/app.icns"
temp_root="$(mktemp -d "${TMPDIR:-/tmp}/a-share-mac-icon.XXXXXX")"
iconset="$temp_root/app.iconset"

cleanup() {
  rm -rf "$temp_root"
}
trap cleanup EXIT

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "mac icon generation requires macOS" >&2
  exit 1
fi
if [[ ! -f "$source_png" ]]; then
  echo "icon source is missing: $source_png" >&2
  exit 1
fi

mkdir -p "$iconset" "$output_dir"

render_icon() {
  local pixels="$1"
  local name="$2"
  sips -z "$pixels" "$pixels" "$source_png" --out "$iconset/$name" >/dev/null
}

render_icon 16 icon_16x16.png
render_icon 32 icon_16x16@2x.png
render_icon 32 icon_32x32.png
render_icon 64 icon_32x32@2x.png
render_icon 128 icon_128x128.png
render_icon 256 icon_128x128@2x.png
render_icon 256 icon_256x256.png
render_icon 512 icon_256x256@2x.png
render_icon 512 icon_512x512.png
render_icon 1024 icon_512x512@2x.png

iconutil -c icns "$iconset" -o "$output_icns"
if [[ ! -s "$output_icns" ]]; then
  echo "mac icon generation failed" >&2
  exit 1
fi

echo "$output_icns"
