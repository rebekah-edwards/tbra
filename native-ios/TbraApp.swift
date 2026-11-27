import SwiftUI

@main
struct TbraApp: App {
    /// "dark" (web default) · "light" · "system" — set from the hamburger
    /// menu's Theme row, mirroring the web ThemeToggle.
    @AppStorage("themeOverride") private var themeOverride = "dark"

    init() {
        // Book covers are the app's heaviest repeated payload. The default
        // shared URLCache is small enough that scrolling a large library
        // evicts covers faster than they're re-shown, which — combined with
        // AsyncImage's lack of retry — produced permanently blank rows
        // (tester report 2b67d3ea). CoverImageCache holds decoded images;
        // this keeps the encoded bytes off the network on relaunch too.
        URLCache.shared = URLCache(memoryCapacity: 32 * 1024 * 1024,
                                   diskCapacity: 256 * 1024 * 1024)
        Theme.configureNavigationBarAppearance()
        // Must run before any view: it tells a fresh install from an update.
        WhatsNew.prepareOnLaunch()
        #if DEBUG && targetEnvironment(simulator)
        // Headless light-mode verification: SIMCTL_CHILD_TBRA_DEBUG_THEME=light
        if let t = ProcessInfo.processInfo.environment["TBRA_DEBUG_THEME"] {
            UserDefaults.standard.set(t, forKey: "themeOverride")
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            // Debug-only: render every widget size instead of the app, for
            // headless layout review (see WidgetPreviewHarness).
            if ProcessInfo.processInfo.environment["TBRA_DEBUG_WIDGET_PREVIEW"] != nil {
                WidgetPreviewHarness()
            } else {
                // Blocks the app when this build is below the server's
                // minimum. Fails OPEN on any uncertainty — see UpdateGate.
                UpdateGate {
                    RootView()
                }
                // System-drawn chrome (alert / confirmation-dialog buttons,
                // default Buttons, text cursors) takes this tint. Lime on the
                // light-mode dialog was unreadable ("Mark as finished",
                // every alert's OK — Rebekah, 2026-11-27), so it's lime in
                // dark and near-black in light, like the web's text-accent.
                // Switches keep the lime fill in both modes (below).
                .tint(Theme.accentText)
                .toggleStyle(SwitchToggleStyle(tint: Theme.accent))
            }
            // No .preferredColorScheme here: @AppStorage in an App struct
            // doesn't re-evaluate the Scene, so this level pinned the LAUNCH
            // theme and overrode live toggles (dark→light needed an app
            // kill). RootView applies the theme via the UIKit window
            // override instead — single source of truth.
        }
    }
}
