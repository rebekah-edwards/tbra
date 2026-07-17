# Google Play listing assets + submission notes (prepared 2026-07-17)

App is a TWA wrapping https://thebasedreader.app (PWA manifest already
compliant: maskable icon, standalone, portrait).

## Assets in this folder
- `listing-icon-512.png` — store icon (512×512)
- `feature-graphic.png` — 1024×500 feature graphic
- `shot-*.png` — phone screenshots (412×915); capture more with:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=out.png --window-size=412,915 <url>`

## Still needed on account day (user has Play Console access)
1. `brew install --cask temurin` (JDK) then `npm i -g @bubblewrap/cli`;
   `bubblewrap init --manifest https://thebasedreader.app/manifest.webmanifest`
   (package id suggestion: app.tbra.twa), `bubblewrap build` → signed AAB.
2. Deploy `/.well-known/assetlinks.json` to prod with the signing key's
   SHA-256 fingerprint (bubblewrap prints it; also in Play Console →
   App integrity after upload if Play App Signing re-signs).
3. Play policy: Stripe purchase surfaces are already hidden in the TWA
   (useIsTwa gate, 2026-07-17) — the app sells nothing in-app.

## Listing copy (draft)
- Short description (80 chars max):
  "Know what's in a book before you read it — content details + reading tracker."
- Privacy policy URL: https://thebasedreader.app/privacy

## Data safety form (draft answers)
- Collects: email address (account management, required), name/username
  (account, required), photos (profile photo, optional), app activity =
  in-app actions (reading activity — core functionality), approximate
  location? NO (user-entered free-text location only → "Other info", optional).
- Analytics: Google Analytics (usage data, not shared for ads).
- Payments: none in-app (purchases happen off-app on the website).
- Data shared with third parties: none for advertising; processors only
  (Stripe/Resend/Vercel/Turso/Google) — Play's definition of "sharing"
  excludes service providers, so answer NOT shared.
- Security: data encrypted in transit; users can request deletion
  (self-serve in Settings → Danger Zone; also delete-account URL can be
  the /settings anchor).
- Account deletion URL (required for the form): https://thebasedreader.app/settings
