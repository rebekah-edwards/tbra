import SwiftUI

@main
struct TbraApp: App {
    /// "dark" (web default) · "light" · "system" — set from the hamburger
    /// menu's Theme row, mirroring the web ThemeToggle.
    @AppStorage("themeOverride") private var themeOverride = "dark"

    init() {
        Theme.configureNavigationBarAppearance()
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
