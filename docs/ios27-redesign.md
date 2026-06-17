# iOS 27 / WWDC 2026 — redesign research for tbr*a

> Researched 2026-06-17 via multi-source, fact-checked deep research. **iOS 27 and Xcode 27 are in BETA as of June 2026** — details may shift before the fall release. Confidence levels and caveats noted per item.

## TL;DR — the strategic call

iOS 27 is an **evolution, not a revolution**: it *refines* the iOS 26 "Liquid Glass" design language rather than replacing it. That means:

1. **You do NOT need a SwiftUI rewrite.** Ship the existing Next.js/React PWA wrapped in **Capacitor** — Capacitor has first-class support for one codebase running as both a native iOS app and a web PWA (high confidence). The web core inherits most of the *look* for free.
2. **The "fresh, native, human-edited" feel comes from a few targeted native-Swift additions**, not from rebuilding the app. The marquee iOS 27 features (on-device AI, App Intents/Siri, widgets, layered icons) are **native-only Swift APIs a WebView cannot reach** — but you reach them with small **custom Capacitor plugins** that bridge to Swift, while keeping the whole app otherwise web.

**Recommended architecture: Capacitor web core + selective native Swift plugins.** Not a SwiftUI rewrite.

## 1. Design language — Liquid Glass, refined (high confidence)

iOS 27 keeps Liquid Glass and polishes it: refreshed materials, refined typography, **unified tab + navigation bars**, a system **transparency slider** (ultra-clear → fully tinted, replacing the binary Reduce-Transparency toggle), improved content diffusion + darkened edges + brighter specular highlights for readability, a uniform top toolbar when content scrolls under floating bars, **search re-integrated into the tab bar** (reversing iOS 26's split search), full-screen Home Screen widgets, and **layered Liquid Glass app icons**.

- Liquid Glass is becoming **effectively mandatory**: Apple will disable the legacy opt-out/deferral flags once Xcode 27 ships, and apps already using it inherit the iOS 27 improvements automatically at runtime. *(Caveat: opt-out removal is stated intent for the unreleased Xcode 27.)*
- **For tbr*a:** a Capacitor app using standard iOS chrome (native tab/nav bars) inherits much of this for free. Your **custom web-rendered UI must be restyled** to match: translucent/blurred surfaces, the tab-bar-integrated search pattern, the lime/blue/purple accent over glass materials. The web layer can genuinely match the glass look via `backdrop-filter` behind a transparent WKWebView (see §5).
- Sources: developer.apple.com/wwdc26/guides/ios, macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27, appleinsider (mandatory).

## 2. High-value developer features (ranked for a reading/discovery app)

### ⭐ A. Foundation Models — on-device Apple Intelligence, FREE under 2M downloads (high confidence)
Native Swift API for direct on-device access to Apple's model: **multimodal text+image prompts** and the model can **call Vision tools (OCR, barcode readers) on-device**. And the big one: if you're in the **App Store Small Business Program with <2M total first-time downloads** (you qualify), you get the next-gen models on **Private Cloud Compute at *no* cloud-API cost**.
- **tbr*a uses:** on-device **ISBN/barcode scanning to add books**, **OCR of covers/spines** to identify titles, and on-device generation of **content-rating summaries / blurbs** — potentially offloading part of your enrichment pipeline to zero-cost on-device/PCC inference.
- **Feasibility:** native-only → needs a Capacitor plugin or a native screen. **Effort: medium.** **Access:** Apple Developer account + App Store Small Business Program enrollment + Private Cloud Compute entitlement.
- **Caveats:** framework itself debuted in 2025; WWDC26 adds the *free PCC tier*. >2M downloads triggers a 6-month migration with no paid tier. Daring Fireball calls third-party PCC access "severely limited" — validate against your actual enrichment needs before betting the pipeline on it.

### ⭐ B. App Intents + Spotlight semantic index + new Siri (high confidence; Siri UI medium)
App Intents gains **entity schemas** that contribute your content to **Spotlight's semantic index** (with attribution), **intent schemas** for natural-language actions ("no specific phrases to define, no code changes as Siri evolves"), and a **View Annotations API** mapping on-screen views to entities.
- **tbr*a uses:** expose **books, shelves, reviews, reading-status** as App Intent entities → they surface in **Spotlight semantic search** and the redesigned Siri ("add this to my TBR", "what did I rate this book", "what's on my shelf"). This is the single biggest "feels native + magic" win for a discovery app.
- **Feasibility:** native-only Swift → Capacitor plugin. **Effort: medium.** **Access:** Apple Developer account.
- **Caveat:** the new card-based, Dynamic-Island-integrated Siri UI rests partly on secondary press. A separate **unconfirmed leak** (Gurman) says the iOS 27 beta has a backend-disabled "Extensions" framework to let users pick a third-party AI (Claude/Gemini/ChatGPT) for Siri — not shown at WWDC, subject to change.

### B+. Full-screen / extra-large widgets — WidgetKit (high confidence)
iOS 27 adds an **extra-large (4×6) widget that fills a full Home Screen page**.
- **tbr*a uses:** current-reading progress, your TBR shelf, or daily discovery picks as a full-page widget.
- **Feasibility:** native-only (WidgetKit/Swift); data fed from the web app via **App Groups**. **Effort: medium.** **Access:** Apple Developer account.

### B++. Layered Liquid Glass app icon — Icon Composer (high confidence, low effort)
iOS 27 icons use a **layered Liquid Glass** treatment (parallax/specular highlights).
- **tbr*a uses:** rebuild the new asterisk icon as a **layered icon in Icon Composer** (background charcoal layer + foreground gradient asterisk) so it gets the glass/parallax treatment instead of a flat PNG. **Effort: low** (design asset, done at native-build time). We already have the master in `design/`.

## 3. Capacitor vs SwiftUI — the feasibility matrix

| Feature | Web/Capacitor reachable? | Path |
|---|---|---|
| Liquid Glass *look* (native chrome) | ✅ inherited | use native tab/nav bars |
| Liquid Glass *look* (your custom UI) | ✅ restyle | `backdrop-filter`, translucency in the web layer |
| Foundation Models (on-device AI) | ❌ native only | custom Capacitor plugin → Swift |
| App Intents / Spotlight / Siri | ❌ native only | custom Capacitor plugin → Swift |
| Full-screen widgets (WidgetKit) | ❌ native only | native widget target + App Groups |
| Layered app icon | ❌ build asset | Icon Composer at build time |
| Native sign-in / passkeys / push | ⚠️ via plugins | existing Capacitor plugins |

**Verdict:** hybrid (web core + a handful of native plugins) captures ~90% of the value at a fraction of a SwiftUI-rewrite's cost.

## 4. What you already get "for free" (iOS 26 baseline, high confidence)
Your Capacitor/WKWebView build inherits the Safari 26 / iOS 26 web platform: every Home-Screen website opens as a web app by default (no manifest required, user-toggleable), **`backdrop-filter` behind a transparent WebView** (directly useful for matching Liquid Glass in your web UI), local/session **storage restoration APIs**, and Screen Time support. *(Digital Credentials in WKWebView was tracked/pending, not confirmed shipped.)*

## 5. Prioritized roadmap for an iOS 27 launch

1. **Foundation: Capacitor wrapper** of the existing PWA + Apple Developer account + App Store Small Business Program enrollment. Ship a native binary that's the PWA today.
2. **Visual parity:** restyle custom UI to Liquid Glass (translucent surfaces via `backdrop-filter`, tab-bar-integrated search, glass materials over the lime/blue/purple accent); use native tab/nav chrome where possible. **Layered app icon** via Icon Composer.
3. **Native differentiator #1 — App Intents / Spotlight / Siri:** expose books/shelves/reviews/status as entities. Highest "feels magic" payoff for discovery.
4. **Native differentiator #2 — Foundation Models:** on-device ISBN/barcode scan + cover OCR to add books; evaluate moving part of enrichment/content-summaries on-device at zero PCC cost.
5. **Native differentiator #3 — full-page widget** (current reading / TBR / daily picks) via WidgetKit + App Groups.
6. **Native sign-in/passkeys/push** via Capacitor plugins (also resolves the iOS-PWA Google-OAuth breakout from earlier — native Google Sign-In just works).

## Caveats / where sources conflict
- **iOS 27 + Xcode 27 are beta** (June 2026); specifics may change by fall.
- `.glassEffect()` / `UIGlassEffect` APIs actually **debuted in iOS 26 (WWDC25)** — one source (TechTimes) conflated them with iOS 27. Liquid Glass itself is iOS 26; iOS 27 refines it.
- The **Siri "Extensions" third-party-AI framework is an unconfirmed leak**, backend-disabled, not announced at WWDC.
- **Free PCC tier** has real limits (>2M-download cliff, no paid tier, third-party skepticism) — validate before depending on it for the enrichment pipeline.
