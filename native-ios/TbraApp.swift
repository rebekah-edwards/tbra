import SwiftUI

@main
struct TbraApp: App {
    init() {
        Theme.configureNavigationBarAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Theme.accent)
        }
    }
}
