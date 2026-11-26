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

export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # Xcode 27.2 (released) since 2026-11-25
DEVICE_UDID="B5CBECD2-3AAF-522B-AF96-F969AC2609DD"   # Rebekah's iPhone (17 Pro, iOS 27.2)
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/DerivedData/Build/Products/Debug-iphoneos/Tbra.app"

cd "$DIR"

# Preflight (2026-11-16): say WHY the phone can't be reached instead of dying
# on xcodebuild's "Unable to find a destination". Two causes seen so far:
#  1. Xcode's bundled device-support packages (MobileDevice.pkg /
#     CoreTypes.pkg) are missing or stale — a macOS update replaces them. Only
#     the Xcode GUI can reinstall them (needs an admin click); the phone stays
#     "unavailable" until then.
#  2. After (1), or after the phone updates iOS, the wireless link needs ONE
#     cable connection to re-establish; it then works over Wi-Fi again.
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  echo "✗ Xcode's device-support components need installing."
  echo "  Fix: open /Applications/Xcode.app once and accept 'Install' on the components prompt, then re-run."
  exit 1
fi
if xcrun devicectl list devices 2>/dev/null | grep "$DEVICE_UDID" | grep -q "unavailable"; then
  echo "✗ The Mac can't see Rebekah's iPhone (CoreDevice state: unavailable)."
  echo "  It must be unlocked and on the home Wi-Fi. If it already is, the wireless link has dropped:"
  echo "  plug it into the Mac by cable once (unlocked) — wireless installs work again afterwards."
  echo "  If a cable doesn't fix it, open Xcode once and install any components it offers."
  exit 1
fi

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
