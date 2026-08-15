import SwiftUI

@main
struct TbraApp: App {
    /// "dark" (web default) · "light" · "system" — set from the hamburger
    /// menu's Theme row, mirroring the web ThemeToggle.
    @AppStorage("themeOverride") private var themeOverride = "dark"

    init() {
        Theme.configureNavigationBarAppearance()
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
                RootView()
                    .tint(Theme.accent)
            }
            // No .preferredColorScheme here: @AppStorage in an App struct
            // doesn't re-evaluate the Scene, so this level pinned the LAUNCH
            // theme and overrode live toggles (dark→light needed an app
            // kill). RootView applies the theme via the UIKit window
            // override instead — single source of truth.
        }
    }
}
