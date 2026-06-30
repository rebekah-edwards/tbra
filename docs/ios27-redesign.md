# iOS 27 / WWDC 2026 — redesign + native-app plan for tbr*a

> Originally researched 2026-06-17 via multi-source, fact-checked deep research.
> **Strategy revised 2026-06-30** (see Decision Log): the plan is now a **native SwiftUI iOS app**, not a Capacitor wrapper. iOS 27 and Xcode 27 are in **BETA as of June 2026** — details may shift before the fall release. Confidence levels and caveats noted per item.

## Decision Log

- **2026-06-17** — Initial research recommended **Capacitor** (wrap the existing Next.js/React PWA, add a few native Swift plugins). Rationale at the time: maximize UI reuse, minimize cost.
- **2026-06-30** — **Reversed to native SwiftUI.** The user is committing to Apple-specific design and recent WWDC 2026 features (notably the new drag-and-drop). Those features — real Liquid Glass, the `reorderable()`/drag-container APIs, Foundation Models, App Intents, widgets — are **SwiftUI-native and unreachable from a WebView**. Capacitor could only *imitate* them. Going native is the only path that actually uses them. The Capacitor analysis is preserved below as the **rejected alternative**.

## TL;DR — the strategic call (revised)

Build a **native SwiftUI iOS app** as a **second client** alongside the existing web app. This is **additive — nothing in the web app is deleted or rewritten.**

1. **Web app (Next.js/React)** keeps serving web + PWA users exactly as today. Untouched.
2. **SwiftUI app** is a brand-new Xcode project — the home for native Liquid Glass, the WWDC 2026 drag-and-drop, Foundation Models, App Intents, and widgets, all first-class with no plugin bridging.
3. **Shared layer** = the **Turso database, enrichment pipeline, and backend logic.** Both clients read/write the same books, shelves, reviews, and reading state.

**The two real costs (that Capacitor avoided):**
- **A JSON API layer.** tbr*a leans heavily on **Next.js server actions** (34 `'use server'` files: `shelves.ts`, `up-next.ts`, `reading-state.ts`, `rating.ts`, `review.ts`, `follows.ts`, `favorites.ts`, …). Server actions are RPC functions **only React can call** — a SwiftUI client cannot invoke them. The core user actions need JSON endpoints. (~50 `/api/*` routes already exist, but mostly for search/admin/enrichment, not core user actions.)
- **The full UI, rebuilt in Swift.** React components don't translate; every screen is rebuilt natively. Zero UI reuse — that's the price of authentically native, and also the payoff.

**Standing cost to accept:** **two UIs to maintain forever** — every future feature is built once in React and once in Swift.

## Architecture (revised) — native front end + shared backend

```
┌─────────────────┐     ┌──────────────────────┐
│  Web app        │     │  SwiftUI iOS app     │
│  Next.js/React  │     │  (new Xcode project) │
│  (untouched)    │     │  native Liquid Glass │
└────────┬────────┘     └──────────┬───────────┘
         │ server actions          │ JSON API (/api/*)
         └───────────┬─────────────┘
                     ▼
        ┌──────────────────────────┐
        │  Shared backend logic     │
        │  + enrichment pipeline    │
        │  + Turso database         │
        └──────────────────────────┘
```

**The no-duplication refactor pattern.** Don't fork business logic. For each core action, extract the body into a plain function, then call it from **both**:
- the existing `'use server'` wrapper (web — unchanged behavior), **and**
- a thin `/api/*` route (native client).

One source of truth, two callers. The web app keeps working byte-for-byte while the API surface grows.

## What native buys you vs the rejected Capacitor path

| Concern | Capacitor (rejected) | Native SwiftUI (chosen) |
|---|---|---|
| Web app | untouched | untouched |
| UI reuse | ~90% (React in WebView) | 0% (rebuilt in Swift) |
| API work | minimal | **build JSON API for core actions** |
| WWDC 2026 drag-and-drop | ❌ imitation only | ✅ the real `reorderable()` API |
| Liquid Glass / Foundation Models / widgets | via plugins (a step removed) | native, first-class |
| Ongoing maintenance | one UI | **two UIs forever** |
| "Feels native" for App Store review | good | best |

## 1. Design language — Liquid Glass, refined (high confidence)

iOS 27 keeps Liquid Glass and polishes it: refreshed materials, refined typography, **unified tab + navigation bars**, a system **transparency slider** (ultra-clear → fully tinted, replacing the binary Reduce-Transparency toggle), improved content diffusion + darkened edges + brighter specular highlights for readability, a uniform top toolbar when content scrolls under floating bars, **search re-integrated into the tab bar** (reversing iOS 26's split search), full-screen Home Screen widgets, and **layered Liquid Glass app icons**.

- Liquid Glass is becoming **effectively mandatory**: Apple will disable the legacy opt-out/deferral flags once Xcode 27 ships, and apps already using it inherit the iOS 27 improvements automatically at runtime. *(Caveat: opt-out removal is stated intent for the unreleased Xcode 27.)*
- **For tbr*a (native):** a SwiftUI app using standard iOS chrome (`TabView`, navigation bars) gets Liquid Glass for free, and `.glassEffect()` / `UIGlassEffect` give custom surfaces the same material. Apply the lime/blue/purple accent over glass materials.
- Sources: developer.apple.com/wwdc26/guides/ios, macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27, appleinsider (mandatory).

## 2. ⭐ WWDC 2026 drag-and-drop — the feature driving this plan (high confidence)

iOS 27's marquee SwiftUI win for a list-heavy app: a new **reordering + drag-container API** that replaces piles of manual coordination code. Headline session: *"Code-along: Build powerful drag and drop in SwiftUI"* (WWDC26 session 271).

**Reordering modifiers:**
- `reorderable()` — marks dynamic content (e.g. a `ForEach`) as drag-to-reorder participants. **Works in any container** now — `List`, `LazyVStack`, `LazyVGrid`, custom layouts (previously basically `List`-only).
- `reorderContainer(for:)` — applied to the enclosing container; hands you a `ReorderDifference` (`sources` = moved IDs; `destination.position` = `.before(value)` or `.end`) so your code just applies the change to the model. Requires items to be `Identifiable` (or use `reorderContainer(for:itemID:)`).
- `reorderable(collectionID:)` / `reorderContainer(for:in:)` — reordering **across multiple collections** in one container (e.g. moving a book from one shelf to another, with `destination.collectionID` identifying the receiving shelf).

**Drag-container modifiers (new to iPhone/iPad — were macOS-only):**
- `dragContainer(for:)` + `draggable(containerItemID:)` — the draggable item carries only its **ID**, not the payload; the framework lazily requests the real transferable values only when the drag actually starts.
- `dragContainerSelection(_:)` — drag a **multi-selection** as one group.
- `onDragSessionUpdated(_:)` — observe the live `DragSession` (location, dragged index, `draggedItemIDs(for:)`).
- `dropDestination(for:isEnabled:action:)` — receives the dropped values + `DropSession`.

**System handles** the drag preview, the insertion placeholder, and the drop animation automatically — that's the native "feel" you can't get in the WebView.

**Where it lands in tbr*a:**
- **Up Next** — reorder the queue with real Apple drag physics (replaces today's CSS-imitation drag-to-reorder in the web app).
- **Shelves** — reorder books within a shelf, and **drag a book from one shelf to another** via the multi-collection variant. Multi-select drag to move several books at once.

**Caveat:** SwiftUI-native — **a WebView/Capacitor build cannot use this.** This single fact is why the plan moved to native SwiftUI.

- Sources: nilcoalescing.com (New SwiftUI APIs for reordering and drag and drop on iOS 27), developer.apple.com/videos/play/wwdc2026/271, /269, livsycode.com, dev.to/arshtechpro WWDC26 SwiftUI breakdown.

## 3. Other high-value native features (ranked for a reading/discovery app)

### ⭐ A. Foundation Models — on-device Apple Intelligence, FREE under 2M downloads (high confidence)
Native Swift API for direct on-device access to Apple's model: **multimodal text+image prompts**, and the model can **call Vision tools (OCR, barcode readers) on-device**. If you're in the **App Store Small Business Program with <2M total first-time downloads** (you qualify), you get the next-gen models on **Private Cloud Compute at *no* cloud-API cost**.
- **tbr*a uses:** on-device **ISBN/barcode scanning to add books**, **OCR of covers/spines** to identify titles, on-device generation of **content-rating summaries / blurbs** — potentially offloading part of the enrichment pipeline to zero-cost on-device/PCC inference.
- **Native:** direct SwiftUI/Swift API (no plugin needed now). **Effort: medium.** **Access:** Apple Developer account + Small Business Program enrollment + Private Cloud Compute entitlement.
- **Caveats:** framework debuted in 2025; WWDC26 adds the *free PCC tier*. >2M downloads triggers a 6-month migration with no paid tier. Daring Fireball calls third-party PCC access "severely limited" — validate against actual enrichment needs before betting the pipeline on it.

### ⭐ B. App Intents + Spotlight semantic index + new Siri (high confidence; Siri UI medium)
App Intents gains **entity schemas** that contribute content to **Spotlight's semantic index** (with attribution), **intent schemas** for natural-language actions, and a **View Annotations API** mapping on-screen views to entities.
- **tbr*a uses:** expose **books, shelves, reviews, reading-status** as App Intent entities → they surface in **Spotlight semantic search** and the redesigned Siri ("add this to my TBR", "what did I rate this book", "what's on my shelf"). Biggest "feels native + magic" win for a discovery app.
- **Native:** direct Swift API. **Effort: medium.** **Access:** Apple Developer account.
- **Caveat:** new card-based, Dynamic-Island Siri UI rests partly on secondary press. A separate **unconfirmed leak** (Gurman) says the iOS 27 beta has a backend-disabled "Extensions" framework to let users pick a third-party AI for Siri — not shown at WWDC, subject to change.

### B+. Full-screen / extra-large widgets — WidgetKit (high confidence)
iOS 27 adds an **extra-large (4×6) widget that fills a full Home Screen page.**
- **tbr*a uses:** current-reading progress, TBR shelf, or daily discovery picks as a full-page widget.
- **Native:** WidgetKit target; data fed from the app via **App Groups**. **Effort: medium.**

### B++. Layered Liquid Glass app icon — Icon Composer (high confidence, low effort)
iOS 27 icons use a **layered Liquid Glass** treatment (parallax/specular highlights).
- **tbr*a uses:** rebuild the asterisk icon as a **layered icon in Icon Composer** (background charcoal layer + foreground gradient asterisk). **Effort: low.** Master already in `design/`.

## 4. What you still get "for free" at the platform baseline
The native app inherits iOS 27 system chrome (tab/nav bars, Liquid Glass materials, the transparency slider, Dynamic Type, Screen Time) automatically. Sign in with Apple, passkeys, and APNS push are first-class native APIs (no Capacitor plugin needed).

## 5. What needs to happen FIRST — native SwiftUI kickoff order

**Phase 0 — Accounts & scaffold (prerequisites, mostly paperwork):**
1. **Apple Developer account** ($99/yr) — still not created; blocks everything native (`ROADMAP.md`).
2. **App Store Small Business Program** enrollment (unlocks the free Foundation Models / PCC tier).
3. New **Xcode 27 project** (SwiftUI), bundle ID, signing. No app code yet — just a buildable shell on a device.

**Phase 1 — The backend the app talks to (do this before UI):**
4. **Stand up the JSON API for core user actions.** Use the no-duplication pattern: extract each server-action body into a shared function, expose it at `/api/*`, keep the `'use server'` wrapper calling the same function. Start with exactly what shelves + Up Next need: auth/session, list shelves, list a shelf's books, reorder within a shelf, move a book between shelves, read/reorder Up Next.
5. **Token auth for native.** Web uses JWT-in-cookie (jose). Native needs a token flow (e.g. bearer token issued at sign-in) + **Sign in with Apple** (App Store requires it once any other social login — Google — is offered; see `ROADMAP.md`).

**Phase 2 — First native screens (the showcase, small + self-contained):**
6. **Build Shelves + Up Next natively first** — they're the surfaces the new drag-and-drop shines on, and small enough to prove out the whole stack (API + auth + Liquid Glass + `reorderable()`) before committing to the full UI port.
   - Up Next: `reorderable()` + `reorderContainer(for:)` over the queue.
   - Shelves: per-shelf reorder, plus cross-shelf drag via `reorderable(collectionID:)` / `reorderContainer(for:in:)`; multi-select drag with `dragContainer(for:)`.
7. **Layered app icon** via Icon Composer (parallel, low effort, any time).

**Phase 3 — Expand the native UI** screen by screen (library, book page, discover, profile, reviews), then layer in the differentiators (App Intents/Spotlight/Siri, Foundation Models barcode/OCR add-book, full-page widget).

> **Why shelves + Up Next first:** smallest footprint that exercises the entire native stack end-to-end, and it's exactly where the WWDC 2026 drag-and-drop is most visible. If the API + auth + Liquid Glass + drag pattern works there, the rest of the UI port is repetition, not unknowns.

## Rejected alternative — Capacitor (kept for the record)

The 2026-06-17 research recommended a Capacitor wrapper (web core in a WKWebView + a handful of native Swift plugins for Foundation Models / App Intents / WidgetKit). **Why it was rejected (2026-06-30):** the features the user actually wants — the WWDC 2026 drag-and-drop, real Liquid Glass on custom UI — are SwiftUI-native and a WebView can only imitate them. Capacitor's advantage was ~90% UI reuse at low cost; that advantage is moot once the goal is authentic native interaction. Feasibility matrix at the time:

| Feature | Web/Capacitor reachable? |
|---|---|
| Liquid Glass *look* (native chrome) | ✅ inherited |
| Liquid Glass *look* (custom UI) | ✅ restyle via `backdrop-filter` |
| WWDC 2026 drag-and-drop | ❌ native only |
| Foundation Models (on-device AI) | ❌ native only |
| App Intents / Spotlight / Siri | ❌ native only |
| Full-screen widgets (WidgetKit) | ❌ native only |
| Layered app icon | ❌ build asset |

## Caveats / where sources conflict
- **iOS 27 + Xcode 27 are beta** (June 2026); specifics (including drag-and-drop API signatures) may change by fall.
- `.glassEffect()` / `UIGlassEffect` APIs actually **debuted in iOS 26 (WWDC25)**; iOS 27 refines Liquid Glass rather than introducing it.
- The **Siri "Extensions" third-party-AI framework is an unconfirmed leak**, backend-disabled, not announced at WWDC.
- **Free PCC tier** has real limits (>2M-download cliff, no paid tier, third-party skepticism) — validate before depending on it for enrichment.
