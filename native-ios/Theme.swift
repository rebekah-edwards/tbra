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

/// The pre-1.0 design refresh (2026-11). Every refreshed surface branches on
/// `DesignPreview.on` and keeps its original implementation beside it, so any
/// single item can be reverted by deleting its branch — and the whole refresh
/// can be flipped off without a rebuild:
///   • simulator:  SIMCTL_CHILD_TBRA_DEBUG_DESIGN=v1 (or v2)
///   • device:     UserDefaults "designPreview" = "v1" / "v2"
/// Default is the refreshed look.
enum DesignPreview {
    static var on: Bool {
        #if DEBUG
        if let env = ProcessInfo.processInfo.environment["TBRA_DEBUG_DESIGN"] {
            return env != "v1"
        }
        #endif
        return UserDefaults.standard.string(forKey: "designPreview") != "v1"
    }
}

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

extension Theme {
    /// A control's outline: a capsule in the refreshed look (2026-11), the
    /// rounded rect it had in v1 otherwise.
    static func controlShape(_ v1Radius: CGFloat) -> AnyShape {
        DesignPreview.on ? AnyShape(Capsule()) : AnyShape(RoundedRectangle(cornerRadius: v1Radius))
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
            // Refreshed look (2026-11): every primary action is a capsule,
            // like Home's Update and the Library switch. v1 was a 12pt rect.
            .clipShape(DesignPreview.on ? AnyShape(Capsule()) : AnyShape(RoundedRectangle(cornerRadius: 12)))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)   // .tap-scale
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// ── Branded text field chrome (login) ──
struct BrandedFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        if DesignPreview.on {
            // Refreshed (2026-11): a glass capsule, the same field the
            // Library search uses.
            content
                .font(Theme.body(16))
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 18)
                .frame(minHeight: 50)
                .glassEffect(.regular, in: Capsule())
        } else {
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

// ── Cover-art hero (web components/ui/cover-art-hero.tsx) ──
// Author + series page header on the 2026-11 design: the card sits on its own
// blurred cover art inside the wordmark hairline, with a fan of tipped
// covers, an eyebrow, the heading-face title, glass stat chips with a dot and
// the page's actions — content centred as one group.
struct HeroStat: Hashable {
    enum Hue { case lime, blue, purple }
    let label: String
    let value: String
    let hue: Hue

    var color: Color {
        switch hue {
        case .lime: return Theme.accent
        case .blue: return Theme.neonBlue
        case .purple: return Color(hex: "c084fc")
        }
    }
}

struct CoverArtHero<Actions: View, Footer: View>: View {
    let eyebrow: String
    let title: String
    var subtitle: String? = nil
    let covers: [String]
    var stats: [HeroStat] = []
    @ViewBuilder var actions: Actions
    @ViewBuilder var footer: Footer

    private func url(_ s: String) -> URL? {
        s.hasPrefix("/") ? URL(string: s, relativeTo: APIClient.baseURL) : URL(string: s)
    }

    var body: some View {
        let fan = Array(covers.prefix(3))
        VStack(spacing: 14) {
            if !fan.isEmpty {
                ZStack {
                    ForEach(Array(fan.enumerated().reversed()), id: \.offset) { i, cover in
                        CachedCoverImage(url: url(cover)) { Theme.surfaceAlt }
                            .frame(width: 78, height: 117)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(.white.opacity(0.1), lineWidth: 1))
                            .shadow(color: .black.opacity(0.35), radius: 10, y: 6)
                            .scaleEffect(i == 0 ? 1 : 0.9)
                            .rotationEffect(.degrees(i == 0 ? 0 : (i == 1 ? -9 : 9)))
                            .offset(x: i == 0 ? 0 : (i == 1 ? -30 : 30))
                    }
                }
                .frame(height: 124)
                .accessibilityHidden(true)
            }

            VStack(spacing: 4) {
                Text(eyebrow.uppercased())
                    .font(Theme.body(11, .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.muted)
                Text(title)
                    .font(Theme.heading(24, .bold))
                    .foregroundStyle(Theme.foreground)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
            }

            if !stats.isEmpty {
                HStack(spacing: 6) {
                    ForEach(stats, id: \.self) { stat in
                        HStack(spacing: 5) {
                            Circle().fill(stat.color).frame(width: 6, height: 6)
                            Text(stat.value).font(Theme.body(12, .semibold)).foregroundStyle(Theme.foreground)
                            Text(stat.label).font(Theme.body(12)).foregroundStyle(Theme.muted)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(.ultraThinMaterial, in: Capsule())
                        .overlay(Capsule().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
                    }
                }
            }

            actions
            footer
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18).padding(.vertical, 20)
        .background {
            ZStack {
                Theme.surface
                if let first = fan.first {
                    CachedCoverImage(url: url(first)) { Color.clear }
                        .scaleEffect(1.3)
                        .blur(radius: 28)
                        .opacity(0.4)
                    LinearGradient(colors: [Theme.surface.opacity(0.35), Theme.surface.opacity(0.75), Theme.surface],
                                   startPoint: .top, endPoint: .bottom)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 22))
        }
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(LinearGradient(colors: [Theme.accent.opacity(0.55), Color(hex: "38bdf8").opacity(0.35), Color(hex: "c084fc").opacity(0.45)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
        )
    }
}

extension CoverArtHero where Footer == EmptyView {
    init(eyebrow: String, title: String, subtitle: String? = nil, covers: [String],
         stats: [HeroStat] = [], @ViewBuilder actions: () -> Actions) {
        self.eyebrow = eyebrow; self.title = title; self.subtitle = subtitle
        self.covers = covers; self.stats = stats
        self.actions = actions(); self.footer = EmptyView()
    }
}

/// Follow / Following pill (web FollowButton): solid lime to follow, neutral
/// glass with a lime check once following.
struct FollowPill: View {
    let isFollowing: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if isFollowing {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.accentText)
                }
                Text(isFollowing ? "Following" : "Follow")
            }
            .font(Theme.body(14, .semibold))
            .foregroundStyle(isFollowing ? Theme.foreground : Color.black)
            .padding(.horizontal, 22).padding(.vertical, 9)
            .background {
                if isFollowing {
                    Capsule().fill(.ultraThinMaterial)
                } else {
                    Capsule().fill(Theme.accent)
                }
            }
            .overlay(Capsule().stroke(isFollowing ? Theme.accent.opacity(0.6) : .clear, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isFollowing ? .isSelected : [])
    }
}

// ── Verified author badge (web components/author/verified-author-badge.tsx) ──
struct VerifiedAuthorBadge: View {
    var label = "Verified author"
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "checkmark.seal")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.accentText)
            Text(label)
                .font(Theme.body(12, .semibold))
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// /api/v1 verifiedAuthors entry.
struct VerifiedAuthorRef: Codable, Hashable {
    let authorId: String
    let name: String
    let slug: String?
}

// ── Glass kit (2026-11 refresh; web .card-glass / .row-glass / .chip-glass /
// .orb-glass / .eyebrow and components/ui/reader-row.tsx). Neutral glass with
// the hue carried by an icon or dot; one solid-lime action per screen.

/// Small-caps label over a tile or card ("NOTE TO SELF").
struct Eyebrow: View {
    let text: String
    var color: Color = Theme.muted
    init(_ text: String, color: Color = Theme.muted) { self.text = text; self.color = color }
    var body: some View {
        Text(text.uppercased())
            .font(Theme.body(11, .bold))
            .tracking(1.0)
            .foregroundStyle(color)
    }
}

extension View {
    /// Plain section card: neutral glass, thin foreground ring (no hairline —
    /// that's for the one hero card on a screen).
    func glassCard(radius: CGFloat = 20, ring: Color? = nil) -> some View {
        background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .stroke(ring?.opacity(0.5) ?? Theme.foreground.opacity(0.10), lineWidth: 1))
    }

    /// The wordmark hairline card (lime → blue → purple), for a screen's hero.
    func hairlineCard(radius: CGFloat = 22) -> some View {
        background(Theme.surface.opacity(0.92), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .stroke(LinearGradient(colors: [Theme.accent.opacity(0.55), Color(hex: "38bdf8").opacity(0.35), Color(hex: "c084fc").opacity(0.45)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
    }
}

/// Glass badge with a colour dot.
struct GlassChip: View {
    let text: String
    var dot: Color? = nil
    var body: some View {
        HStack(spacing: 6) {
            if let dot { Circle().fill(dot).frame(width: 7, height: 7) }
            Text(text).font(Theme.body(12, .semibold)).foregroundStyle(Theme.foreground).lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
    }
}

/// Round glass well holding a line icon in its hue.
struct GlassOrb: View {
    let systemName: String
    var tint: Color = Theme.neonBlue
    var size: CGFloat = 56
    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.4, weight: .regular))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(Circle().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
    }
}

/// Empty state: glass card, orb, heading-face title, muted line — centred.
struct GlassEmptyState<Action: View>: View {
    let systemName: String
    var tint: Color = Theme.neonBlue
    let title: String
    var message: String? = nil
    @ViewBuilder var action: Action
    var body: some View {
        VStack(spacing: 8) {
            GlassOrb(systemName: systemName, tint: tint).padding(.bottom, 4)
            Text(title).font(Theme.heading(17, .semibold)).foregroundStyle(Theme.foreground)
                .multilineTextAlignment(.center)
            if let message {
                Text(message).font(Theme.body(14)).foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            action.padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24).padding(.vertical, 30)
        .glassCard()
    }
}

extension GlassEmptyState where Action == EmptyView {
    init(systemName: String, tint: Color = Theme.neonBlue, title: String, message: String? = nil) {
        self.systemName = systemName; self.tint = tint; self.title = title; self.message = message
        self.action = EmptyView()
    }
}

/// Avatar in the wordmark ring (web ReaderAvatar).
struct RingedAvatar: View {
    let avatarUrl: String?
    let name: String
    var size: CGFloat = 44
    var body: some View {
        Group {
            if let avatarUrl,
               let url = avatarUrl.hasPrefix("/") ? URL(string: avatarUrl, relativeTo: APIClient.baseURL) : URL(string: avatarUrl) {
                CachedCoverImage(url: url) { Theme.surfaceAlt }
            } else {
                ZStack {
                    Theme.accent
                    Text(String(name.prefix(1)).uppercased())
                        .font(Theme.heading(size * 0.4, .bold))
                        .foregroundStyle(Theme.onAccent)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .padding(2.5)
        .overlay(Circle().stroke(LinearGradient(colors: [Theme.accent, Theme.neonBlue, Theme.neonPurple],
                                                startPoint: .topLeading, endPoint: .bottomTrailing),
                                 lineWidth: 1.5))
    }
}

/// One reader in a list: ringed avatar, heading-face name, @handle, and a
/// trailing control (or a chevron when the whole row is the link).
struct ReaderRowCard<Trailing: View>: View {
    let avatarUrl: String?
    let name: String
    let username: String?
    var bio: String? = nil
    var meta: String? = nil
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            RingedAvatar(avatarUrl: avatarUrl, name: name)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(Theme.heading(15, .bold)).foregroundStyle(Theme.foreground).lineLimit(1)
                if let username { Text("@\(username)").font(Theme.body(12)).foregroundStyle(Theme.muted).lineLimit(1) }
                if let bio, !bio.isEmpty {
                    Text(bio).font(Theme.body(12)).foregroundStyle(Theme.muted.opacity(0.85)).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let meta { Text(meta).font(Theme.body(11)).foregroundStyle(Theme.muted) }
            trailing
        }
        .padding(12)
        .glassCard(radius: 18)
        .contentShape(RoundedRectangle(cornerRadius: 18))
    }
}

extension ReaderRowCard where Trailing == AnyView {
    /// Linked row: chevron trailing.
    init(avatarUrl: String?, name: String, username: String?, bio: String? = nil, meta: String? = nil) {
        self.avatarUrl = avatarUrl; self.name = name; self.username = username
        self.bio = bio; self.meta = meta
        self.trailing = AnyView(Image(systemName: "chevron.right")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.muted.opacity(0.7)))
    }
}

/// Glass segmented switch with a lime active half (web .seg-glass).
struct GlassSegment<T: Hashable>: View {
    let options: [(T, String)]
    @Binding var selection: T
    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.0) { value, label in
                let on = value == selection
                Button { selection = value } label: {
                    Text(label)
                        .font(Theme.body(14, on ? .bold : .medium))
                        .foregroundStyle(on ? Theme.onAccent : Theme.muted)
                        .frame(maxWidth: .infinity).frame(height: 36)
                        .background { if on { Capsule().fill(Theme.accent) } }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.foreground.opacity(0.10), lineWidth: 1))
    }
}

/// Follow control for list rows: stays glass (lime "+" icon) so a column of
/// rows doesn't become a column of lime pills; ringed with a check once on.
struct QuietFollowPill: View {
    let isFollowing: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: isFollowing ? "checkmark" : "plus")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.accentText)
                Text(isFollowing ? "Following" : "Follow")
                    .font(Theme.body(13, .semibold))
                    .foregroundStyle(Theme.foreground)
            }
            .padding(.horizontal, 14).frame(height: 32)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(isFollowing ? Theme.accent.opacity(0.6) : Theme.foreground.opacity(0.14), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isFollowing ? .isSelected : [])
    }
}


/// Cover grids that grow with the window (iPhone Duo, 2026-11-25). The
/// minimum keeps exactly 3 columns on every iPhone in portrait AND on the
/// Duo's closed screen (narrowest content ≈ 326pt), and opens out to ~7 on
/// the Duo's inner screen instead of stretching 3 covers across it.
enum AdaptiveGrid {
    static func covers(spacing: CGFloat) -> [GridItem] {
        [GridItem(.adaptive(minimum: 96, maximum: 170), spacing: spacing)]
    }
    /// Two-up cards on a phone, 3–4 on a wide window.
    static func cards(spacing: CGFloat) -> [GridItem] {
        [GridItem(.adaptive(minimum: 150, maximum: 260), spacing: spacing)]
    }
}

// ── iPhone Duo two-column flow (2026-11-25) ────────────────────────────
/// Where a section goes in `DuoColumns` on a wide window. `.auto` = the
/// shorter column (order preserved within each column); `.full` spans both.
enum DuoColumn { case auto, left, right, full }

private struct DuoColumnKey: LayoutValueKey {
    static let defaultValue: DuoColumn = .auto
}

extension View {
    func duoColumn(_ column: DuoColumn) -> some View {
        layoutValue(key: DuoColumnKey.self, value: column)
    }
}

/// A drop-in replacement for a page's `VStack(alignment: .leading, spacing:)`.
/// Narrower than `minWide` (every iPhone, the Duo's closed screen, a
/// half-screen split) it IS that VStack. On the Duo's open screen it flows
/// the sections into two columns meeting near the fold. `rightLift` starts
/// the right column higher (level with the logo) until the first `.full`
/// section — see duoRightColumnLift().
struct DuoColumns: Layout {
    var spacing: CGFloat = 20
    var gutter: CGFloat = 24
    var minWide: CGFloat = 700
    var rightLift: CGFloat = 0

    private func plan(width: CGFloat, subviews: Subviews) -> (rects: [CGRect], height: CGFloat) {
        var rects: [CGRect] = []
        if width < minWide {
            var y: CGFloat = 0
            var placedAny = false
            for s in subviews {
                let h = s.sizeThatFits(ProposedViewSize(width: width, height: nil)).height
                if h <= 0 { rects.append(CGRect(x: 0, y: y, width: width, height: 0)); continue }
                if placedAny { y += spacing }
                rects.append(CGRect(x: 0, y: y, width: width, height: h))
                y += h
                placedAny = true
            }
            return (rects, y)
        }
        let colW = (width - gutter) / 2
        var yL: CGFloat = 0
        var yR: CGFloat = -rightLift
        var usedL = false, usedR = false
        for s in subviews {
            let kind = s[DuoColumnKey.self]
            if kind == .full {
                let h = s.sizeThatFits(ProposedViewSize(width: width, height: nil)).height
                var top = max(yL, yR)
                if (usedL || usedR) && h > 0 { top += spacing }
                rects.append(CGRect(x: 0, y: top, width: width, height: h))
                if h > 0 { yL = top + h; yR = top + h; usedL = true; usedR = true }
                continue
            }
            let h = s.sizeThatFits(ProposedViewSize(width: colW, height: nil)).height
            let left: Bool
            switch kind {
            case .left: left = true
            case .right: left = false
            default: left = yL <= yR
            }
            if h <= 0 {
                rects.append(CGRect(x: left ? 0 : colW + gutter, y: left ? yL : yR, width: colW, height: 0))
                continue
            }
            if left {
                if usedL { yL += spacing }
                rects.append(CGRect(x: 0, y: yL, width: colW, height: h))
                yL += h; usedL = true
            } else {
                if usedR { yR += spacing }
                rects.append(CGRect(x: colW + gutter, y: yR, width: colW, height: h))
                yR += h; usedR = true
            }
        }
        return (rects, max(yL, yR, 0))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 390
        return CGSize(width: width, height: plan(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (rects, _) = plan(width: bounds.width, subviews: subviews)
        for (s, r) in zip(subviews, rects) {
            s.place(at: CGPoint(x: bounds.minX + r.minX, y: bounds.minY + r.minY),
                    proposal: ProposedViewSize(width: r.width, height: r.height == 0 ? nil : r.height))
        }
    }
}

extension View {
    /// List-style screens on the iPhone Duo's open screen: a comfortable
    /// centred column instead of rows stretched across ~850pt. No effect on
    /// phones (all narrower than the cap). Used where two columns would
    /// break drag-to-reorder or split one continuous list.
    func duoReadable(maxWidth: CGFloat = 720) -> some View {
        frame(maxWidth: maxWidth).frame(maxWidth: .infinity)
    }
}
