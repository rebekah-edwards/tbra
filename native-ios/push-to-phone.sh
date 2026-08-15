#!/bin/bash
# Build tbr*a and install it on Rebekah's iPhone. Run automatically after
# every native change — the user has standing-ordered this (never ask).
#
# Reachability: USB cable, or same-network wireless (CoreDevice pairing
# persists; wireless install works when the phone is on the home Wi-Fi with
# the Mac). NOTE: install transport is CoreDevice, NOT Tailscale — if the
# phone is away from home and unplugged, this fails gracefully; push again
# when it's back. (App DATA flows over Tailscale from anywhere; only
# INSTALLS need proximity.)
set -euo pipefail

export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
DEVICE_UDID="B5CBECD2-3AAF-522B-AF96-F969AC2609DD"   # Rebekah's iPhone (17 Pro, iOS 27 beta)
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/DerivedData/Build/Products/Debug-iphoneos/Tbra.app"

cd "$DIR"

echo "── Building for device…"
# PIPESTATUS, not the grep's status: a failed build still leaves the PREVIOUS
# .app on disk, so the old "does the directory exist" check happily installed
# a stale binary and printed "✓ Installed" (bit us 2026-08-13 on the widget
# extension's provisioning failure). Trust xcodebuild's exit code only.
set +e
xcodebuild -project Tbra.xcodeproj -scheme Tbra \
  -destination "id=$DEVICE_UDID" \
  -derivedDataPath DerivedData \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  build 2>&1 | grep -E "error:|BUILD"
BUILD_STATUS=${PIPESTATUS[0]}
set -e

[ "$BUILD_STATUS" -eq 0 ] || { echo "✗ Build FAILED — refusing to install a stale build."; exit 1; }
[ -d "$APP" ] || { echo "✗ Build product missing"; exit 1; }

echo "── Installing on Rebekah's iPhone…"
if xcrun devicectl device install app --device "$DEVICE_UDID" "$APP" >/dev/null 2>&1; then
  echo "✓ Installed."
  # Relaunch so she sees the new build immediately (best-effort; fails
  # silently if the phone is locked).
  xcrun devicectl device process launch --terminate-existing --device "$DEVICE_UDID" app.tbra.ios >/dev/null 2>&1 \
    && echo "✓ Relaunched." || echo "· Installed; will show on next open (phone locked or app closed)."
else
  echo "✗ Phone not reachable (not on the home network / not plugged in). Push again when it's back."
  exit 2
fi
