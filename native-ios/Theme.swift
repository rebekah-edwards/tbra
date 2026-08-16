import SwiftUI
import UIKit

// tbr*a design system — translated token-for-token from docs/BRANDING.md
// (verified against src/app/globals.css on deployed main, 2026-07-02).
// Adaptive: every token carries the [data-theme="dark"] and
// [data-theme="light"] values from globals.css. Dark is the brand-defining
// look; light must never darken the lime toward olive.
//
// Rules that MUST hold (see BRANDING.md):
// - Accent is ALWAYS #a3e635. Text on opaque lime is ALWAYS near-black #18181b.
// - The lime→blue→purple gradient appears ONLY on the tbr*a wordmark.
// - Page titles are plain bold foreground (no gradient) in Outfit.
// - Links / tappable text use neon blue, muted text uses --muted.

// Color(hex:) / Color(dark:light:) moved to ColorHex.swift — the widget
// extension needs them too and compiles its own source list.

enum Theme {
    // ── Core surface tokens (globals.css :root / [data-theme="light"]) ──
    static let bg         = Color(dark: "0a0a0f", light: "f5f4f8")
    static let foreground = Color(dark: "e4e2ef", light: "18181b")
    static let surface    = Color(dark: "141420", light: "fbfafd")
    static let surfaceAlt = Color(dark: "1c1c2a", light: "f0eff4")
    static let border     = Color(dark: "2a2a3a", light: "dddce4")
    static let muted      = Color(dark: "7a7890", light: "71717a")
    static let destructive = Color(dark: "ef4444", light: "dc2626")
    /// Cover-blur card scrim — .currently-reading-overlay: black 25% on
    /// dark, white 35% on light (text on it uses Theme.foreground).
    static let scrim = Color(UIColor { trait in
        trait.userInterfaceStyle == .light
            ? UIColor.white.withAlphaComponent(0.35)
            : UIColor.black.withAlphaComponent(0.25)
    })

    // ── Brand colors ──
    static let accent      = Color(hex: "a3e635")   // lime-400, both modes, never olive
    static let accentDark  = Color(hex: "84cc16")   // pressed/hover only
    static let onAccent    = Color(hex: "18181b")   // ALWAYS the text on solid lime
    /// Text sitting on TRANSLUCENT lime (10-20% pills): lime in dark mode,
    /// near-black in light — the web's global text-accent override
    /// (globals.css:184). Fills/borders stay lime; this is for text/icons.
    static let accentText  = Color(dark: "a3e635", light: "18181b")
    static let neonBlue    = Color(dark: "38bdf8", light: "0ea5e9")
    static let neonPurple  = Color(dark: "c084fc", light: "a855f7")

    // ── The wordmark gradient — .logo-gradient, wordmark ONLY ──
    static let logoGradient = LinearGradient(
        colors: [accent, Color(dark: "38bdf8", light: "0ea5e9"), Color(dark: "c084fc", light: "a855f7")],
        startPoint: .leading, endPoint: .trailing
    )

    // ── Fonts (bundled, same families the web loads via next/font) ──

    /// Settings → Text Size, mirroring the web's base font sizes
    /// (14/16/18px → 0.875/1.0/1.125). Read live from UserDefaults; the
    /// AppShell root re-ids on change so the visible tree re-renders.
    /// Logo is exempt (brand mark + top-bar layout stay fixed).
    static var textScale: CGFloat {
        switch UserDefaults.standard.string(forKey: "textSize") {
        case "small": return 0.875
        case "large": return 1.125
        default: return 1.0
        }
    }

    /// Posted by SettingsView when it closes after a text-size change;
    /// AppShell re-ids the tab tree so every screen re-renders at the new
    /// scale. (Not fired on each tap — a rebuild would dismiss the Settings
    /// cover the user is standing in; Settings itself re-renders live.)
    static let textSizeChanged = Notification.Name("tbra.textSizeChanged")

    static func body(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("Plus Jakarta Sans", size: size * textScale).weight(weight)
    }
    static func heading(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font {
        .custom("Outfit", size: size * textScale).weight(weight)
    }
    static func logo(_ size: CGFloat) -> Font {
        .custom("Space Grotesk", size: size).weight(.medium)
    }

    /// Mirror the web nav bars: Outfit titles in plain foreground (no gradient).
    /// Call once at app start.
    // Lexically OUTSIDE the @MainActor func below: a dynamic-provider closure
    // written inside a @MainActor context carries actor isolation and traps
    // if UIKit resolves it off-main (the chromeCircle TestFlight crash).
    private static let navTitleForeground = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0xe4/255, green: 0xe2/255, blue: 0xef/255, alpha: 1)
            : UIColor(red: 0x18/255, green: 0x18/255, blue: 0x1b/255, alpha: 1)
    }

    @MainActor static func configureNavigationBarAppearance() {
        let fg = navTitleForeground
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        if let outfitLarge = UIFont(name: "Outfit", size: 32) {
            appearance.largeTitleTextAttributes = [
                .font: UIFont(descriptor: outfitLarge.fontDescriptor.addingAttributes([
                    .traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.bold]
                ]), size: 32),
                .foregroundColor: fg,
            ]
        }
        if let outfit = UIFont(name: "Outfit", size: 17) {
            appearance.titleTextAttributes = [
                .font: UIFont(descriptor: outfit.fontDescriptor.addingAttributes([
                    .traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.semibold]
                ]), size: 17),
                .foregroundColor: fg,
            ]
        }
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
    }
}

// ── Ambient background — the web app's body::before "neon mesh" ──
// Four fixed radial blobs: purple top-left, light purple top-right,
// blue bottom-right, lime bottom-center (globals.css values; light mode
// runs each ~2% stronger).
struct AmbientBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let boost = scheme == .dark ? 0.0 : 0.02
        ZStack {
            Theme.bg
            GeometryReader { geo in
                let w = geo.size.width, h = geo.size.height
                ZStack {
                    radial(Color(hex: "a855f7"), 0.08 + boost, at: CGPoint(x: 0.15 * w, y: 0.10 * h), r: 0.65 * w)
                    radial(Color(hex: "c084fc"), 0.05 + boost, at: CGPoint(x: 0.85 * w, y: 0.15 * h), r: 0.55 * w)
                    radial(Color(hex: "38bdf8"), 0.07 + boost, at: CGPoint(x: 0.80 * w, y: 0.90 * h), r: 0.70 * w)
                    radial(Color(hex: "a3e635"), 0.04 + boost, at: CGPoint(x: 0.50 * w, y: 0.85 * h), r: 0.55 * w)
                }
            }
        }
        .ignoresSafeArea()
    }

    private func radial(_ color: Color, _ opacity: Double, at center: CGPoint, r: CGFloat) -> some View {
        RadialGradient(colors: [color.opacity(opacity), .clear],
                       center: .center, startRadius: 0, endRadius: r)
            .frame(width: r * 2, height: r * 2)
            .position(center)
    }
}

// ── Primary CTA — solid lime, black text; neutral surface when disabled
// (a disabled CTA must read as neutral, never as darkened/olive green). ──
struct AccentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(16, .bold))
            .foregroundStyle(isEnabled ? Theme.onAccent : Theme.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(isEnabled ? (configuration.isPressed ? Theme.accentDark : Theme.accent) : Theme.surfaceAlt)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)   // .tap-scale
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// ── Branded text field chrome (login) ──
struct BrandedFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(Theme.body(16))
            .foregroundStyle(Theme.foreground)
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
    }
}

extension View {
    func brandedField() -> some View { modifier(BrandedFieldModifier()) }
}

// ── Shared row building blocks ──

/// Web `NoCover` parity: blue→purple gradient, faint crosshatch, centered
/// title + "NO COVER" label (src/components/no-cover.tsx + globals.css).
struct NoCoverView: View {
    let title: String
    var body: some View {
        GeometryReader { geo in
            ZStack {
                LinearGradient(stops: [
                    .init(color: Color(red: 0x3b/255, green: 0x59/255, blue: 0x98/255), location: 0),
                    .init(color: Color(red: 0x6b/255, green: 0x3f/255, blue: 0xa0/255), location: 0.4),
                    .init(color: Color(red: 0x8b/255, green: 0x5c/255, blue: 0xf6/255), location: 0.7),
                    .init(color: Color(red: 0x4c/255, green: 0x6e/255, blue: 0xf5/255), location: 1),
                ], startPoint: .topLeading, endPoint: .bottomTrailing)
                Canvas { ctx, size in
                    var path = Path()
                    let step: CGFloat = 16
                    var x = -size.height
                    while x < size.width {
                        path.move(to: CGPoint(x: x, y: 0))
                        path.addLine(to: CGPoint(x: x + size.height, y: size.height))
                        path.move(to: CGPoint(x: x + size.height, y: 0))
                        path.addLine(to: CGPoint(x: x, y: size.height))
                        x += step
                    }
                    ctx.stroke(path, with: .color(.white.opacity(0.07)), lineWidth: 1)
                }
                VStack(spacing: max(2, geo.size.height * 0.02)) {
                    Text(title)
                        .font(Theme.body(max(8, geo.size.width * 0.11), .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .multilineTextAlignment(.center)
                        .lineLimit(4)
                        .minimumScaleFactor(0.6)
                    Text("NO COVER")
                        .font(Theme.body(max(5, geo.size.width * 0.055), .medium))
                        .tracking(1.5)
                        .foregroundStyle(.white.opacity(0.4))
                }
                .padding(.horizontal, geo.size.width * 0.1)
            }
        }
    }
}

/// Book cover thumbnail with the app's placeholder treatment. Pass `title`
/// to get the web-parity NoCover art when the book has no cover; without it
/// (or while an image loads) the neutral book-glyph placeholder shows.
struct CoverThumb: View {
    let url: String?
    var width: CGFloat = 44
    var height: CGFloat = 66
    var radius: CGFloat = 5
    var title: String? = nil

    private var hasUrl: Bool { !(url ?? "").isEmpty }

    var body: some View {
        Group {
            if !hasUrl, let title {
                NoCoverView(title: title)
            } else {
                // CachedCoverImage, NOT AsyncImage: AsyncImage never retries
                // a failed load and loses its work when a scrolling cell
                // cancels it, which is why library rows showed blank covers
                // for books whose detail page rendered them fine (tester
                // report 2b67d3ea). See CoverImageCache.swift.
                CachedCoverImage(url: url.flatMap(URL.init(string:))) {
                    if let title, !hasUrl {
                        NoCoverView(title: title)
                    } else {
                        ZStack {
                            Theme.surfaceAlt
                            Image(systemName: "book.closed")
                                .font(.system(size: min(width, height) * 0.32))
                                .foregroundStyle(Theme.muted.opacity(0.6))
                        }
                    }
                }
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .overlay(RoundedRectangle(cornerRadius: radius).stroke(Theme.border.opacity(0.6), lineWidth: 0.5))
    }
}

/// The exact web `.book-card-bg-img` treatment for cover-blur card
/// backgrounds, both modes:
///   dark:  opacity .4 · blur 16 · saturate 1.5
///   light: opacity .5 · blur 16 · saturate 2.5 · brightness ↑ · screen blend
struct CoverBlurImage: View {
    let url: URL
    @Environment(\.colorScheme) private var colorScheme
    @State private var image: UIImage = CoverBlurImage.blank

    // 1×1 clear stand-in so the Image view exists from first render; the
    // arriving cover only swaps its contents, never the view structure.
    // (Defense-in-depth — the actual iOS 27 killer was the unbounded .fill
    // frame, see the note on `body`.)
    private static let blank = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1))
        .image { _ in }

    var body: some View {
        // Color.clear.overlay + .clipped() keeps the image's LAYOUT frame
        // equal to the card, not the oversized .fill rect. Without this,
        // each backdrop's frame spills over the neighboring cards and on
        // iOS 27 that kills button activation for the ENTIRE run of sibling
        // cards (Home "Reading Now" with 2+ books): taps land in the right
        // frames (TAPDEBUG proved it) but no button ever fires. One card
        // alone is fine, which is why this shipped unnoticed. Bisect-verified
        // 2026-07-08: scrim/blur/AsyncImage-phase-swap all innocent; the
        // unbounded fill frame is the poison. Do NOT "simplify" this back to
        // a bare resizable-fill image in a ZStack.
        Color.clear
            .overlay {
                if colorScheme == .light {
                    // NOTE: no .blendMode(.screen) here — CSS screen-blends
                    // against the colorful page BEHIND the card, but SwiftUI
                    // blends against the card's own white base, and screen over
                    // white is always white (uniform grey cards). This recipe
                    // reproduces the web's visual result instead.
                    Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                        .blur(radius: 16)
                        .saturation(2.2)
                        .brightness(0.12)
                        .opacity(0.55)
                } else {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                        .blur(radius: 16)
                        .saturation(1.5)
                        .opacity(0.4)
                }
            }
            .clipped()
            .allowsHitTesting(false)
            .task(id: url) {
                if let (data, _) = try? await URLSession.shared.data(from: url),
                   let loaded = UIImage(data: data) {
                    image = loaded
                }
            }
    }
}
