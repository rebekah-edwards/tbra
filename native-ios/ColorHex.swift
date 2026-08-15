import SwiftUI
import UIKit

// Color helpers shared by the app (Theme.swift) and the TbraWidgets
// extension. They live in their own file because the widget target compiles
// a hand-picked source list and cannot take all of Theme.swift — while
// duplicating these two initialisers would redeclare them inside the app.

extension Color {
    /// Hex like "a3e635".
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&v)
        self.init(
            red: Double((v >> 16) & 0xff) / 255,
            green: Double((v >> 8) & 0xff) / 255,
            blue: Double(v & 0xff) / 255
        )
    }

    /// A color that follows the system light/dark appearance,
    /// mirroring the web app's [data-theme] switch.
    init(dark: String, light: String) {
        self.init(uiColor: UIColor { trait in
            let hex = trait.userInterfaceStyle == .dark ? dark : light
            var v: UInt64 = 0
            Scanner(string: hex).scanHexInt64(&v)
            return UIColor(
                red: CGFloat((v >> 16) & 0xff) / 255,
                green: CGFloat((v >> 8) & 0xff) / 255,
                blue: CGFloat(v & 0xff) / 255,
                alpha: 1
            )
        })
    }
}
