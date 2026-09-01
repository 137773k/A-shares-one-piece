#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
release_dir="${2:-$project_root/release}"
output_dir="${3:-$project_root/release-validation-output}"
arch="${1:-}"

if [[ "$arch" != "arm64" && "$arch" != "x64" ]]; then
  echo "usage: Test-MacDmg.sh <arm64|x64> [release-dir] [output-dir]" >&2
  exit 1
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS DMG validation must run on macOS" >&2
  exit 1
fi

version="$(cd "$project_root" && node -p "require('./package.json').version")"
dmg="$release_dir/A-shares-one-piece-$version-mac-$arch.dmg"
report="$output_dir/macos-dmg-validation-$arch.json"
machine="$(uname -m)"
expected_machine="$arch"
if [[ "$arch" == "x64" ]]; then expected_machine="x86_64"; fi
if [[ "$machine" != "$expected_machine" ]]; then
  echo "runner architecture mismatch: expected $expected_machine, got $machine" >&2
  exit 1
fi
if [[ ! -f "$dmg" ]]; then
  echo "DMG is missing: $dmg" >&2
  exit 1
fi

temp_base="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
test_root="$(mktemp -d "$temp_base/a-share-macos-$arch.XXXXXX")"
mount_point="$test_root/mount"
installed_root="$test_root/Applications"
installed_app="$installed_root/A股短线模型.app"
user_data="$test_root/UserData"
runtime_temp="$test_root/Temp"
mkdir -p "$mount_point" "$installed_root" "$user_data" "$runtime_temp" "$output_dir"

mounted=0
app_pid=""

stop_application() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if kill -0 "$app_pid" 2>/dev/null; then kill -9 "$app_pid" 2>/dev/null || true; fi
    wait "$app_pid" 2>/dev/null || true
  fi
  app_pid=""
}

cleanup() {
  stop_application
  if [[ "$mounted" == "1" ]]; then
    hdiutil detach -force "$mount_point" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

hdiutil verify "$dmg" >/dev/null
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_point" >/dev/null
mounted=1

source_app="$mount_point/A股短线模型.app"
if [[ ! -d "$source_app" ]]; then
  echo "application bundle is missing from DMG" >&2
  exit 1
fi
ditto "$source_app" "$installed_app"

plist="$installed_app/Contents/Info.plist"
bundle_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
if [[ "$bundle_version" != "$version" ]]; then
  echo "bundle version mismatch: $bundle_version" >&2
  exit 1
fi
if [[ "$bundle_id" != "com.ashare.tradingmodel" ]]; then
  echo "bundle identifier mismatch: $bundle_id" >&2
  exit 1
fi

binary="$installed_app/Contents/MacOS/A股短线模型"
if [[ ! -x "$binary" ]]; then
  echo "application executable is missing" >&2
  exit 1
fi
binary_description="$(file "$binary")"
if [[ "$arch" == "arm64" && "$binary_description" != *"arm64"* ]]; then
  echo "application binary is not arm64: $binary_description" >&2
  exit 1
fi
if [[ "$arch" == "x64" && "$binary_description" != *"x86_64"* ]]; then
  echo "application binary is not x86_64: $binary_description" >&2
  exit 1
fi

set +e
codesign --verify --deep --strict "$installed_app" >"$test_root/codesign.log" 2>&1
codesign_exit=$?
spctl --assess --type execute "$installed_app" >"$test_root/gatekeeper.log" 2>&1
gatekeeper_exit=$?
set -e
if grep -q 'Authority=Developer ID Application' "$test_root/codesign.log"; then
  echo "unexpected Developer ID signature in unsigned build" >&2
  exit 1
fi

current_port=""
current_history_count=""
run_application() {
  local run_number="$1"
  local app_log="$test_root/app-run-$run_number.log"
  local cloud_json="$test_root/cloud-run-$run_number.json"
  current_port=""
  TMPDIR="$runtime_temp" \
    HOT_STOCKS_AUTO_REFRESH_START_DELAY_MS=3600000 \
    HOT_STOCKS_AUTO_REFRESH_CHECK_MS=3600000 \
    "$binary" --user-data-dir="$user_data" --disable-gpu >"$app_log" 2>&1 &
  app_pid=$!

  for _ in $(seq 1 120); do
    if ! kill -0 "$app_pid" 2>/dev/null; then
      cat "$app_log" >&2
      echo "application exited before opening a listener" >&2
      exit 1
    fi
    while IFS= read -r candidate_port; do
      if [[ "$candidate_port" =~ ^[0-9]+$ ]] &&
         (( candidate_port >= 5173 && candidate_port <= 5202 )) &&
         curl --silent --fail --max-time 2 "http://127.0.0.1:$candidate_port/" | grep -q '<title>'; then
        current_port="$candidate_port"
        break
      fi
    done < <(lsof -nP -a -p "$app_pid" -iTCP -sTCP:LISTEN -Fn 2>/dev/null | sed -nE 's/^n.*:([0-9]+)$/\1/p')
    if [[ -n "$current_port" ]]; then break; fi
    sleep 0.5
  done
  if [[ -z "$current_port" ]]; then
    cat "$app_log" >&2
    echo "application did not open a verified local listener" >&2
    exit 1
  fi

  curl --silent --fail --max-time 10 \
    "http://127.0.0.1:$current_port/api/cloud-current-sync/status" >"$cloud_json"
  node -e '
    const fs = require("fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (payload.ok !== true || payload.sync?.configured !== false || payload.sync?.status !== "disabled") {
      throw new Error("cloud current sync is not disabled by default");
    }
  ' "$cloud_json"

  history_root="$user_data/runtime/data/history"
  current_history_count=0
  if [[ -d "$history_root" ]]; then
    current_history_count="$(find "$history_root" -type f -name '*.json' -print | wc -l | tr -d ' ')"
  fi
  if [[ "$current_history_count" != "0" ]]; then
    echo "macOS package seeded private history" >&2
    exit 1
  fi
  stop_application
}

run_application 1
run1_port="$current_port"
run1_history_count="$current_history_count"
marker="$user_data/runtime/ci-persistence-marker.txt"
printf '%s' 'macos-dmg-validation' >"$marker"
run_application 2
run2_port="$current_port"
run2_history_count="$current_history_count"
if [[ ! -f "$marker" ]]; then
  echo "runtime marker did not persist across restart" >&2
  exit 1
fi

if [[ -f "$runtime_temp/a-share-desktop-startup.log" ]]; then
  cp "$runtime_temp/a-share-desktop-startup.log" "$output_dir/macos-desktop-startup-$arch.log"
fi

hdiutil detach "$mount_point" >/dev/null
mounted=0
dmg_sha256="$(shasum -a 256 "$dmg" | awk '{print $1}')"

MAC_VALIDATION_REPORT="$report" \
MAC_VALIDATION_ARCH="$arch" \
MAC_VALIDATION_MACHINE="$machine" \
MAC_VALIDATION_VERSION="$version" \
MAC_VALIDATION_BUNDLE_ID="$bundle_id" \
MAC_VALIDATION_DMG_NAME="$(basename "$dmg")" \
MAC_VALIDATION_DMG_SHA256="$dmg_sha256" \
MAC_VALIDATION_BINARY="$binary_description" \
MAC_VALIDATION_CODESIGN_EXIT="$codesign_exit" \
MAC_VALIDATION_GATEKEEPER_EXIT="$gatekeeper_exit" \
MAC_VALIDATION_RUN1_PORT="$run1_port" \
MAC_VALIDATION_RUN2_PORT="$run2_port" \
MAC_VALIDATION_RUN1_HISTORY="$run1_history_count" \
MAC_VALIDATION_RUN2_HISTORY="$run2_history_count" \
node <<'NODE'
const fs = require("fs");
const report = {
  schemaVersion: 1,
  status: "passed",
  platform: `macos-${process.env.MAC_VALIDATION_ARCH}`,
  runnerArchitecture: process.env.MAC_VALIDATION_MACHINE,
  version: process.env.MAC_VALIDATION_VERSION,
  bundleIdentifier: process.env.MAC_VALIDATION_BUNDLE_ID,
  artifact: {
    name: process.env.MAC_VALIDATION_DMG_NAME,
    sha256: process.env.MAC_VALIDATION_DMG_SHA256,
  },
  binaryDescription: process.env.MAC_VALIDATION_BINARY,
  signing: {
    developerIdSigned: false,
    notarized: false,
    codesignVerifyExitCode: Number(process.env.MAC_VALIDATION_CODESIGN_EXIT),
    gatekeeperAssessmentExitCode: Number(process.env.MAC_VALIDATION_GATEKEEPER_EXIT),
  },
  checks: {
    dmgVerified: true,
    dmgMountedReadOnly: true,
    bundleIdentityMatched: true,
    nativeArchitectureMatched: true,
    firstLaunchHttp200: true,
    secondLaunchHttp200: true,
    cloudDisabledByDefault: true,
    privateHistoryCountZero: true,
    runtimePersistsAcrossRestart: true,
    dmgDetached: true,
  },
  runs: [
    { runNumber: 1, port: Number(process.env.MAC_VALIDATION_RUN1_PORT), historyJsonCount: Number(process.env.MAC_VALIDATION_RUN1_HISTORY) },
    { runNumber: 2, port: Number(process.env.MAC_VALIDATION_RUN2_PORT), historyJsonCount: Number(process.env.MAC_VALIDATION_RUN2_HISTORY) },
  ],
};
fs.writeFileSync(process.env.MAC_VALIDATION_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
NODE
