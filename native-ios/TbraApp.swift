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
            RootView()
                .tint(Theme.accent)
                .preferredColorScheme(
                    themeOverride == "light" ? .light :
                    themeOverride == "system" ? nil : .dark
                )
        }
    }
}
