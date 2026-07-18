import SwiftUI

// The app chrome, recreated 1:1 from the mobile web app:
// - Sticky top bar: gradient tbr*a wordmark + search / bell / menu icons
//   (src/app/layout.tsx nav).
// - Fixed bottom nav (src/components/nav/bottom-tabs.tsx): five slots —
//   Discover, My Library, raised HOME circle (lime when active), Stats,
//   Profile — active items in neon purple, 10px medium labels.

enum AppTab: Hashable {
    case discover, library, home, stats, profile
}

struct AppShell: View {
    @Environment(AuthStore.self) private var auth
    @State private var searchOpen = false
    @State private var fullSearchOpen = false
    @State private var fullSearchQuery: String?
    @State private var presentedSeriesId: String?
    @State private var presentedAuthorId: String?
    @State private var bellOpen = false
    @State private var menuOpen = false
    /// Home tour's "Go to Settings" CTA opens Settings directly (same
    /// presentation the hamburger menu uses).
    @State private var tourSettingsOpen = false
    /// Bumped when Settings closes after a text-size change (see Theme).
    @State private var fontEpoch = 0
    @State private var notifications = NotificationsModel()
    // Per-tab navigation paths, lifted here so re-tapping the ACTIVE tab
    // pops its stack to root (web: bottom nav always goes to the page top).
    @State private var homePath = NavigationPath()
    @State private var libraryPath = NavigationPath()
    @State private var discoverPath = NavigationPath()
    @State private var profilePath = NavigationPath()
    /// Book page presented from outside the tab stacks (notification links).
    @State private var presentedBookSlug: String?
    /// Public profile presented from a universal link (shared profile URL).
    @State private var presentedProfileUsername: String?
    // Measured bar heights, forwarded to pushed screens (see shellBarInsets).
    @State private var topBarHeight: CGFloat = 0
    @State private var bottomNavHeight: CGFloat = 0
    // Chrome hub: current tab, scroll-at-top, and the actions the
    // per-screen hit layers invoke (see PushedScreenChrome).
    @State private var chrome = ChromeState()

    private var tab: AppTab { chrome.tab }
    #if DEBUG && targetEnvironment(simulator)
    @State private var debugBookSlug: String?
    @State private var debugCoverSlug: String?
    @State private var shelvesDebugOpen = false
    @State private var debugShelfId: String?
    @State private var debugShelfEditorId: String?
    @State private var debugCoverPickerId: String?
    @State private var menuDebugOpen = false
    @State private var settingsDebugOpen = false
    #endif

    var body: some View {
        ZStack {
            AmbientBackground()
            // The tab NavigationStacks must own the FULL screen — the bars are
            // injected as safe-area insets instead of VStack siblings. With the
            // stacks sandwiched in a VStack, the UIKit navigation controller
            // believed it spanned the whole window while SwiftUI drew it ~114pt
            // lower (below TopBar): every touch inside a stack then hit-tested
            // one bar-height off (Up Next opened the book a grid row down,
            // Reading Now + book-page back were dead zones).
            ZStack {
                switch tab {
                case .home: HomeView(path: $homePath)
                case .library: LibraryRootView(path: $libraryPath)
                case .discover: DiscoverRootView(path: $discoverPath)
                case .stats: StatsView().pushedScreenChrome()
                case .profile: ProfileRootView(path: $profilePath)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // Text Size: rebuild every screen at the new Theme.textScale once
            // Settings closes (fonts are computed in body, invisible to
            // SwiftUI's dependency tracking — an id bump is the rerender).
            .id("fonts-\(fontEpoch)")
            .onReceive(NotificationCenter.default.publisher(for: Theme.textSizeChanged)) { _ in
                fontEpoch += 1
            }
        }
        // The floating bars are plain OVERLAYS, not safeAreaInsets: an inset
        // applied outside the NavigationStacks collapses (and z-fights) on
        // iOS 27 the moment a stack's content is swapped. Every screen
        // reserves the bar space itself instead via screenChrome()/
        // PushedScreenChrome using the measured heights below.
        //
        // These shell instances are DISPLAY ONLY (allowsHitTesting(false)):
        // overlays outside the NavigationStacks LOSE hit-testing to links
        // scrolled beneath the pills on iOS 27 (tapping the menu icon opened
        // the book under it). The real tap targets are invisible, geometry-
        // identical twins rendered INSIDE every screen by PushedScreenChrome,
        // where overlays reliably win. Keeping the visuals here also means
        // they never slide with push/pop transitions, and their content can
        // mutate freely (badge, logo fade) without breaking any hit regions.
        .overlay(alignment: .topLeading) {
            TopBarLogo(visible: chrome.atTop, onTap: {})
                .allowsHitTesting(false)
        }
        .overlay(alignment: .topTrailing) {
            TopBarActions(unreadCount: notifications.unreadCount)
                .allowsHitTesting(false)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { topBarHeight = $0 }
        }
        .overlay(alignment: .bottom) {
            BottomNav(tab: chrome.tab, avatarUrl: currentAvatarUrl)
                .allowsHitTesting(false)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bottomNavHeight = $0 }
        }
        .environment(\.shellBarInsets, (top: topBarHeight, bottom: bottomNavHeight))
        .environment(chrome)
        .environment(\.openSearch, { searchOpen = true })
        .task { await notifications.load() }
        .onAppear {
            // Wire the chrome actions the per-screen hit layers call.
            chrome.goHome = { chrome.tab = .home; homePath = NavigationPath() }
            chrome.openSearch = { searchOpen = true }
            chrome.openBell = { bellOpen = true }
            chrome.openMenu = { menuOpen = true }
            chrome.selectTab = { chrome.tab = $0 }
            chrome.reselectTab = { reselected in
                // Same-tab tap: pop that tab's stack to its root.
                switch reselected {
                case .home: homePath = NavigationPath()
                case .library: libraryPath = NavigationPath()
                case .discover: discoverPath = NavigationPath()
                case .profile: profilePath = NavigationPath()
                case .stats: break
                }
            }
        }
        .sheet(isPresented: $bellOpen) {
            NotificationsSheet(model: notifications, onOpenBook: { slug in presentedBookSlug = slug })
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.bg)
        }
        .sheet(isPresented: $menuOpen) {
            HamburgerMenuSheet(onProfile: { chrome.tab = .profile })
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
        }
        // Search icon → FLOATING overlay (web nav-bar parity, 2026-07-15).
        // The full search page remains reachable via the overlay's footer.
        .overlay {
            if searchOpen {
                FloatingSearchOverlay(
                    open: $searchOpen,
                    onOpenBook: { presentedBookSlug = $0 },
                    onOpenSeries: { presentedSeriesId = $0 },
                    onOpenAuthor: { presentedAuthorId = $0 },
                    onFullSearch: { q in fullSearchQuery = q; fullSearchOpen = true }
                )
                .zIndex(60)
            }
        }
        .fullScreenCover(isPresented: $fullSearchOpen) {
            SearchRootView(initialQuery: fullSearchQuery)
                .environment(\.shellBarInsets, (top: 0, bottom: 0))
                .environment(\.showsShellChrome, false)
        }
        .fullScreenCover(isPresented: Binding(
            get: { presentedSeriesId != nil },
            set: { if !$0 { presentedSeriesId = nil } }
        )) {
            NavigationStack {
                SeriesView(slug: presentedSeriesId ?? "")
                    .toolbar(.hidden, for: .navigationBar)
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
        .fullScreenCover(isPresented: Binding(
            get: { presentedAuthorId != nil },
            set: { if !$0 { presentedAuthorId = nil } }
        )) {
            NavigationStack {
                AuthorView(idOrSlug: presentedAuthorId ?? "")
                    .toolbar(.hidden, for: .navigationBar)
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
        .fullScreenCover(isPresented: Binding(
            get: { presentedBookSlug != nil },
            set: { if !$0 { presentedBookSlug = nil } }
        )) {
            NavigationStack {
                BookDetailView(idOrSlug: presentedBookSlug ?? "")
                    .toolbar(.hidden, for: .navigationBar)
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
                .environment(\.showsShellChrome, false)
        }
        .fullScreenCover(isPresented: Binding(
            get: { presentedProfileUsername != nil },
            set: { if !$0 { presentedProfileUsername = nil } }
        )) {
            NavigationStack {
                PublicProfileView(username: presentedProfileUsername ?? "")
                    .toolbar(.hidden, for: .navigationBar)
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
        // Universal links (https://thebasedreader.app/…) land here in the
        // SwiftUI lifecycle. AASA on the site covers /book/* and /u/*; any
        // other path stays in Safari and never reaches the app.
        .onOpenURL { url in
            guard url.host()?.hasSuffix("thebasedreader.app") == true else { return }
            let parts = url.pathComponents.filter { $0 != "/" }
            guard parts.count >= 2 else { return }
            switch parts[0] {
            case "book": presentedBookSlug = parts[1]
            case "u": presentedProfileUsername = parts[1]
            default: break
            }
        }
        // First-run guided tour (home): where imports + settings live. Runs
        // after the bar overlays in the chain so the dim covers them.
        .guidedTour("home-r2", steps: [
            CoachStep(id: "tour-menu", title: "Start here",
                      text: "This menu is home base: Import Your Library brings your whole Goodreads or StoryGraph history over in about a minute, and Settings holds your privacy and content preferences."),
        ], ctaLabel: "Go to Settings", onCTA: { tourSettingsOpen = true })
        .fullScreenCover(isPresented: $tourSettingsOpen) {
            NavigationStack {
                SettingsView()
                    .appDestinations()
            }
        }
        #if DEBUG && targetEnvironment(simulator)
        .fullScreenCover(isPresented: Binding(
            get: { debugBookSlug != nil },
            set: { if !$0 { debugBookSlug = nil } }
        )) {
            NavigationStack {
                BookDetailView(idOrSlug: debugBookSlug ?? "")
                    .toolbar(.hidden, for: .navigationBar)
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
                .environment(\.showsShellChrome, false)
        }
        .sheet(isPresented: $menuDebugOpen) {
            HamburgerMenuSheet(onProfile: { chrome.tab = .profile })
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
        }
        .fullScreenCover(isPresented: $settingsDebugOpen) {
            NavigationStack { SettingsView().appDestinations() }
                .environment(\.shellBarInsets, (top: 0, bottom: 0))
                .environment(\.showsShellChrome, false)
        }
        .fullScreenCover(isPresented: Binding(
            get: { debugCoverSlug != nil },
            set: { if !$0 { debugCoverSlug = nil } }
        )) {
            AdminSheet(title: "Edit Cover",
                       path: "book/\(debugCoverSlug ?? "")",
                       query: "editCover=1")
        }
        .fullScreenCover(isPresented: $shelvesDebugOpen) {
            NavigationStack {
                LibraryShelvesView()
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(for: ShelfRoute.self) { route in
                        ShelfDetailView(route: route)
                    }
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
        .fullScreenCover(isPresented: Binding(
            get: { debugShelfId != nil },
            set: { if !$0 { debugShelfId = nil } }
        )) {
            NavigationStack {
                ShelfDetailView(route: ShelfRoute(shelfId: debugShelfId ?? ""))
                    .toolbar(.hidden, for: .navigationBar)
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
        .fullScreenCover(isPresented: Binding(
            get: { debugShelfEditorId != nil },
            set: { if !$0 { debugShelfEditorId = nil } }
        )) {
            NavigationStack {
                ShelfEditorView(shelfId: debugShelfEditorId ?? "")
                    .toolbar(.hidden, for: .navigationBar)
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
        .sheet(isPresented: Binding(
            get: { debugCoverPickerId != nil },
            set: { if !$0 { debugCoverPickerId = nil } }
        )) {
            CoverPickerSheet(bookId: debugCoverPickerId ?? "", bookTitle: "Debug Book")
        }
        #endif
        #if DEBUG && targetEnvironment(simulator)
        // Headless verification hook: `SIMCTL_CHILD_TBRA_DEBUG_ROUTE=search
        // xcrun simctl launch …` lands directly on a screen so the agent can
        // screenshot it without GUI taps. Never compiled for device builds.
        .task {
            let env = ProcessInfo.processInfo.environment
            try? await Task.sleep(for: .seconds(1.5))
            switch env["TBRA_DEBUG_ROUTE"] {
            case "search": searchOpen = true
            case let route? where route.hasPrefix("library"): chrome.tab = .library
            case "discover": chrome.tab = .discover
            case "stats": chrome.tab = .stats
            case "profile": chrome.tab = .profile
            case let route? where route.hasPrefix("book:"):
                debugBookSlug = String(route.dropFirst("book:".count))
            case let route? where route.hasPrefix("user:"):
                presentedProfileUsername = String(route.dropFirst("user:".count))
            case let route? where route.hasPrefix("cover:"):
                debugCoverSlug = String(route.dropFirst("cover:".count))
            case "menu": menuDebugOpen = true
            case "settings": settingsDebugOpen = true
            case "shelves": shelvesDebugOpen = true
            case let route? where route.hasPrefix("shelf:"):
                debugShelfId = String(route.dropFirst("shelf:".count))
            case let route? where route.hasPrefix("shelfeditor:"):
                debugShelfEditorId = String(route.dropFirst("shelfeditor:".count))
            case let route? where route.hasPrefix("coverpicker:"):
                debugCoverPickerId = String(route.dropFirst("coverpicker:".count))
            default: break
            }
        }
        #endif
    }

    private var currentAvatarUrl: String? {
        if case .signedIn(let user) = auth.phase { return user.avatarUrl }
        return nil
    }
}

// ── Floating "liquid glass" chrome ──────────────────────────────────────
// The bars are detached glass pills (iOS 26 style): scroll content passes
// underneath and blurs through them. Both stay .safeAreaInset views so the
// hit-test geometry from the 2026-07-07 fixes is untouched — only the
// visuals changed (transparent inset area, glass capsules inside it).

/// The chrome hub. Holds the state the bars render from (current tab,
/// scroll-at-top) plus the actions the PER-SCREEN hit layers invoke — the
/// shell wires the closures once in onAppear. See PushedScreenChrome for
/// why the tap targets live inside the screens.
@MainActor
@Observable
final class ChromeState {
    var atTop = true
    var tab: AppTab = .home
    // Wired by AppShell:
    var goHome: @MainActor () -> Void = {}
    var openSearch: @MainActor () -> Void = {}
    var openBell: @MainActor () -> Void = {}
    var openMenu: @MainActor () -> Void = {}
    var selectTab: @MainActor (AppTab) -> Void = { _ in }
    var reselectTab: @MainActor (AppTab) -> Void = { _ in }
}

/// Attach to a screen's root ScrollView so the shell knows whether it rests
/// at the top. onAppear re-reports on pop so a scrolled pushed page doesn't
/// leave a stale value behind.
struct TracksScrollAtTop: ViewModifier {
    @Environment(ChromeState.self) private var chrome: ChromeState?
    @State private var atTop = true
    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Bool.self) { geo in
                // At rest contentOffset.y == -contentInsets.top, so the sum
                // is ~0 at the top and grows as the user scrolls down.
                geo.contentOffset.y + geo.contentInsets.top <= 2
            } action: { _, new in
                atTop = new
                chrome?.atTop = new
            }
            .onAppear { chrome?.atTop = atTop }
    }
}
extension View {
    func tracksScrollAtTop() -> some View { modifier(TracksScrollAtTop()) }

    /// Liquid-glass capsule chrome for the floating bars.
    @ViewBuilder func glassPill() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: Capsule())
        } else {
            self
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Theme.border.opacity(0.6), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
        }
    }
}

// ── The chrome bars exist in TWO modes ──────────────────────────────────
// Visual mode (the shell's overlays): draws the real pixels, never receives
// touches. Hit mode (hitLayerOnly, rendered inside every screen by
// PushedScreenChrome): identical geometry with CLEAR ink and no glass —
// invisible, but its buttons receive the taps. The split exists because
// shell-level overlays LOSE hit-testing to links scrolled under the pills
// on iOS 27, while overlays inside a screen reliably win (the floating
// back chevron proved it). Any layout change here MUST keep both modes
// geometry-identical — they are the same code path on purpose.

// ── Top-left wordmark — visible only while the page rests at its top;
// tapping it returns to the Home root. ──
struct TopBarLogo: View {
    var visible: Bool
    var hitLayerOnly = false
    var onTap: @MainActor () -> Void

    var body: some View {
        // Wordmark: Space Grotesk, lime→blue→purple gradient (.logo-gradient),
        // on its own glass pill so it stays legible over vivid book heroes.
        // Pill metrics mirror TopBarActions (24pt content row + 11pt vertical)
        // so the two pills read as one bar. GEOMETRY RULE: paddings are shared
        // by both modes; only the ink/glass differ.
        Button(action: onTap) {
            Text("tbr*a")
                .font(Theme.logo(22))
                .foregroundStyle(hitLayerOnly ? hitLayerInk : AnyShapeStyle(Theme.logoGradient))
                .frame(height: 24)
                .contentShape(Rectangle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .modifier(GlassPillIf(enabled: !hitLayerOnly))
        .padding(.leading, 16)
        .padding(.top, 2)
        .opacity(hitLayerOnly ? 1 : (visible ? 1 : 0))
        .offset(y: (hitLayerOnly || visible) ? 0 : -6)
        .allowsHitTesting(hitLayerOnly && visible)
        .animation(hitLayerOnly ? nil : .easeOut(duration: 0.18), value: visible)
    }
}

// ── Top-right floating glass bubble: search / bell / menu. Stateless —
// the shell owns the sheets and the notifications model. ──
struct TopBarActions: View {
    var hitLayerOnly = false
    var unreadCount = 0
    var onSearch: @MainActor () -> Void = {}
    var onBell: @MainActor () -> Void = {}
    var onMenu: @MainActor () -> Void = {}

    var body: some View {
        HStack(spacing: 24) {
            iconButton("magnifyingglass", action: onSearch)
            iconButton("bell", action: onBell)
                .overlay(alignment: .topTrailing) {
                    if !hitLayerOnly {
                        Circle().fill(Theme.accent)
                            .frame(width: 8, height: 8)
                            .offset(x: 2, y: -2)
                            .opacity(unreadCount > 0 ? 1 : 0)
                    }
                }
            if hitLayerOnly {
                iconButton("line.3.horizontal", action: onMenu)
            } else {
                // Tour target: only the VISIBLE bar copy anchors (the invisible
                // hit-layer twins would fight over the preference key).
                iconButton("line.3.horizontal", action: onMenu)
                    .coachAnchor("tour-menu")
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
        .modifier(GlassPillIf(enabled: !hitLayerOnly))
        .padding(.trailing, 16)
        .padding(.top, 2)
        .padding(.bottom, 8)
    }

    private func iconButton(_ systemName: String, action: @escaping @MainActor () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .regular))
                // Fixed slot in BOTH modes so the twins stay aligned.
                .frame(width: 24, height: 24)
                .foregroundStyle(hitLayerOnly ? hitLayerInk : AnyShapeStyle(Theme.foreground.opacity(0.85)))
                .contentShape(Rectangle())
        }
    }
}

/// The hit layer's ink: invisible in production, red wash under
/// TBRA_DEBUG_TAPS=1 so the twins' positions can be verified on sight.
@MainActor let hitLayerInk: AnyShapeStyle =
    TapDebug.enabled ? AnyShapeStyle(.red.opacity(0.4)) : AnyShapeStyle(.clear)

/// glassPill in visual mode; a bare tappable capsule in hit mode.
struct GlassPillIf: ViewModifier {
    let enabled: Bool
    func body(content: Content) -> some View {
        if enabled {
            content.glassPill()
        } else {
            content.contentShape(Capsule())
        }
    }
}

// ── Bottom nav — floating glass pill, five columns, lime home circle in
// the middle. Detached from the screen edges; content blurs through it.
// Same visual/hit split as the top bars (see the mode note above). ──
struct BottomNav: View {
    var hitLayerOnly = false
    var tab: AppTab
    var avatarUrl: String?
    var onSelect: @MainActor (AppTab) -> Void = { _ in }
    var onReselect: @MainActor (AppTab) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 0) {
            navItem(.discover, label: "Discover") { GemIcon().stroked() }
            navItem(.library, label: "My Library") { LibraryIcon().stroked(lineWidth: 1.8) }
            homeButton
            navItem(.stats, label: "Stats") { StatsIcon().stroked() }
            navItem(.profile, label: "Profile") { profileIcon }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .modifier(GlassPillIf(enabled: !hitLayerOnly))
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 2)
    }

    private func navItem<Icon: View>(_ target: AppTab, label: String, @ViewBuilder icon: () -> Icon) -> some View {
        let active = tab == target
        return Button {
            if tab == target { onReselect(target) } else { onSelect(target) }
        } label: {
            VStack(spacing: 2) {
                icon()
                    .frame(width: 22, height: 22)
                Text(label)
                    .font(Theme.body(10, .semibold))
            }
            // Inactive items use strong foreground (not muted): the glass
            // pill floats over book covers and grey was illegible in light
            // mode. The bg-tinted glow separates the glyphs from busy art.
            .foregroundStyle(hitLayerOnly
                             ? hitLayerInk
                             : (active ? AnyShapeStyle(Theme.neonPurple) : AnyShapeStyle(Theme.foreground.opacity(0.78))))
            .shadow(color: hitLayerOnly ? .clear : Theme.bg.opacity(0.55), radius: 2.5)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
    }

    // Standout Home button in the center of the pill — lime circle when
    // active, surface-alt when not.
    private var homeButton: some View {
        let active = tab == .home
        return Button {
            if tab == .home { onReselect(.home) } else { onSelect(.home) }
        } label: {
            ZStack {
                if !hitLayerOnly {
                    Circle()
                        .fill(active ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.surfaceAlt))
                    Circle()
                        .stroke(Theme.border, lineWidth: active ? 0 : 1)
                    HomeIcon()
                        .stroked()
                        .frame(width: 24, height: 24)
                        .foregroundStyle(active ? Theme.onAccent : Theme.muted)
                }
            }
            .frame(width: 50, height: 50)
            .shadow(color: hitLayerOnly ? .clear : (active ? Theme.accent.opacity(0.35) : .black.opacity(0.2)),
                    radius: 8, y: 2)
            .contentShape(Circle())
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var profileIcon: some View {
        // Avatar paths come back relative (/uploads/...) — resolve against
        // the API host. The hit layer skips the image (geometry via frame).
        if hitLayerOnly {
            Color.clear.frame(width: 22, height: 22)
        } else if let avatarUrl,
           let url = avatarUrl.hasPrefix("/")
               ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
               : URL(string: avatarUrl) {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: { Theme.surfaceAlt }
            .frame(width: 22, height: 22)
            .clipShape(Circle())
            .overlay(Circle().stroke(tab == .profile ? Theme.neonPurple : Theme.border,
                                     lineWidth: tab == .profile ? 2 : 1))
        } else {
            PersonIcon().stroked().frame(width: 22, height: 22)
        }
    }
}

// TOMBSTONE — TapScaleButtonStyle (the web's .tap-scale press feedback)
// was deleted on purpose. On iOS 27, a ButtonStyle that scaleEffects on
// configuration.isPressed makes button ACTIVATION land on a sibling when
// applied to runs of card/cell buttons (Up Next grid opened the book one
// row down; bisect-verified, with and without the .animation line).
// Do NOT reintroduce a pressed-scale ButtonStyle for card grids/rails.

// ── Placeholder for tabs whose /api/v1 endpoints don't exist yet ──
struct PlaceholderScreen: View {
    let title: String
    var body: some View {
        VStack(spacing: 10) {
            Text(title)
                .font(Theme.heading(24, .bold))
                .foregroundStyle(Theme.foreground)
            Text("Coming to the native app soon")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// ── The bottom-nav icons, ported 1:1 from the site's inline SVGs ──
// (24×24 viewBox, stroke-based, round caps/joins.)

extension Shape {
    func stroked(lineWidth: CGFloat = 2) -> some View {
        self.stroke(style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
            .aspectRatio(1, contentMode: .fit)
    }
}

/// Gem / diamond (Discover).
struct GemIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 24
        var p = Path()
        // M6 3h12l4 6-10 13L2 9z
        p.move(to: CGPoint(x: 6 * s, y: 3 * s))
        p.addLine(to: CGPoint(x: 18 * s, y: 3 * s))
        p.addLine(to: CGPoint(x: 22 * s, y: 9 * s))
        p.addLine(to: CGPoint(x: 12 * s, y: 22 * s))
        p.addLine(to: CGPoint(x: 2 * s, y: 9 * s))
        p.closeSubpath()
        // M2 9h20
        p.move(to: CGPoint(x: 2 * s, y: 9 * s))
        p.addLine(to: CGPoint(x: 22 * s, y: 9 * s))
        // M10 3l-2 6 4 13 4-13-2-6
        p.move(to: CGPoint(x: 10 * s, y: 3 * s))
        p.addLine(to: CGPoint(x: 8 * s, y: 9 * s))
        p.addLine(to: CGPoint(x: 12 * s, y: 22 * s))
        p.addLine(to: CGPoint(x: 16 * s, y: 9 * s))
        p.addLine(to: CGPoint(x: 14 * s, y: 3 * s))
        return p
    }
}

/// Bookcase grid (My Library).
struct LibraryIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 24
        var p = Path()
        p.addRoundedRect(in: CGRect(x: 3 * s, y: 2 * s, width: 18 * s, height: 20 * s),
                         cornerSize: CGSize(width: 1 * s, height: 1 * s))
        for (x1, y1, x2, y2): (CGFloat, CGFloat, CGFloat, CGFloat) in [
            (3, 8, 21, 8), (3, 14, 21, 14),                 // shelves
            (7, 3, 7, 7), (10, 4, 10, 7), (13, 3, 13, 7),   // top row books
            (8, 9, 8, 13), (11, 10, 11, 13), (15, 9, 15, 13),
            (7, 15, 7, 21), (12, 16, 12, 21), (16, 15, 16, 21),
        ] {
            p.move(to: CGPoint(x: x1 * s, y: y1 * s))
            p.addLine(to: CGPoint(x: x2 * s, y: y2 * s))
        }
        return p
    }
}

/// House (Home).
struct HomeIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 24
        var p = Path()
        // M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z
        p.move(to: CGPoint(x: 3 * s, y: 9 * s))
        p.addLine(to: CGPoint(x: 12 * s, y: 2 * s))
        p.addLine(to: CGPoint(x: 21 * s, y: 9 * s))
        p.addLine(to: CGPoint(x: 21 * s, y: 20 * s))
        p.addQuadCurve(to: CGPoint(x: 19 * s, y: 22 * s), control: CGPoint(x: 21 * s, y: 22 * s))
        p.addLine(to: CGPoint(x: 5 * s, y: 22 * s))
        p.addQuadCurve(to: CGPoint(x: 3 * s, y: 20 * s), control: CGPoint(x: 3 * s, y: 22 * s))
        p.closeSubpath()
        // door: polyline 9 22 9 12 15 12 15 22
        p.move(to: CGPoint(x: 9 * s, y: 22 * s))
        p.addLine(to: CGPoint(x: 9 * s, y: 12 * s))
        p.addLine(to: CGPoint(x: 15 * s, y: 12 * s))
        p.addLine(to: CGPoint(x: 15 * s, y: 22 * s))
        return p
    }
}

/// Bar chart (Stats).
struct StatsIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 24
        var p = Path()
        for (x, y1, y2): (CGFloat, CGFloat, CGFloat) in [(18, 20, 10), (12, 20, 4), (6, 20, 14)] {
            p.move(to: CGPoint(x: x * s, y: y1 * s))
            p.addLine(to: CGPoint(x: x * s, y: y2 * s))
        }
        return p
    }
}

/// Person (Profile fallback when no avatar).
struct PersonIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 24
        var p = Path()
        // M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2
        p.move(to: CGPoint(x: 20 * s, y: 21 * s))
        p.addLine(to: CGPoint(x: 20 * s, y: 19 * s))
        p.addQuadCurve(to: CGPoint(x: 16 * s, y: 15 * s), control: CGPoint(x: 20 * s, y: 15 * s))
        p.addLine(to: CGPoint(x: 8 * s, y: 15 * s))
        p.addQuadCurve(to: CGPoint(x: 4 * s, y: 19 * s), control: CGPoint(x: 4 * s, y: 15 * s))
        p.addLine(to: CGPoint(x: 4 * s, y: 21 * s))
        p.addEllipse(in: CGRect(x: 8 * s, y: 3 * s, width: 8 * s, height: 8 * s))
        return p
    }
}

// (Up Next's ≡ drag handle was removed 2026-07-11 — reorder is now the
// iOS-home-screen wiggle mode: 1s long-press, whole-card drag, Done.)

// ── Guided tour (coach marks) ────────────────────────────────────────────
// Spotlight walkthroughs: dim the screen, cut a hole around a real control,
// explain it, and force Next/Done stepping. Each tour runs ONCE per install
// (AppStorage "tour-<key>"). Mark targets with .coachAnchor("id"); attach
// .guidedTour("key", steps:) to the screen root. onStep lets a screen
// scroll a below-the-fold target into view before the spotlight lands.

struct CoachStep: Identifiable {
    let id: String      // matches a .coachAnchor id
    let title: String
    let text: String
}

struct CoachAnchorKey: PreferenceKey {
    static let defaultValue: [String: Anchor<CGRect>] = [:]
    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) {
        value.merge(nextValue()) { $1 }
    }
}

/// Equatable twin of CoachAnchorKey (Anchor isn't Equatable, so the tour
/// watches THIS to know when its first target has actually rendered —
/// activating on a fixed delay spotlighted thin air while screens loaded).
struct CoachAnchorIdsKey: PreferenceKey {
    static let defaultValue: Set<String> = []
    static func reduce(value: inout Set<String>, nextValue: () -> Set<String>) {
        value.formUnion(nextValue())
    }
}

extension View {
    /// Tag a control as a tour target.
    func coachAnchor(_ id: String) -> some View {
        anchorPreference(key: CoachAnchorKey.self, value: .bounds) { [id: $0] }
            .preference(key: CoachAnchorIdsKey.self, value: [id])
    }

    /// Attach to a screen root. Presents the steps once per install.
    /// ctaLabel/onCTA turn the LAST step's primary button into a call to
    /// action (e.g. "Go to Settings") that finishes the tour, then acts.
    func guidedTour(_ tourKey: String, steps: [CoachStep],
                    onStep: ((CoachStep) -> Void)? = nil,
                    ctaLabel: String? = nil,
                    onCTA: (() -> Void)? = nil) -> some View {
        modifier(GuidedTourModifier(tourKey: tourKey, steps: steps, onStep: onStep,
                                    ctaLabel: ctaLabel, onCTA: onCTA))
    }
}

private struct GuidedTourModifier: ViewModifier {
    let steps: [CoachStep]
    var onStep: ((CoachStep) -> Void)?
    var ctaLabel: String?
    var onCTA: (() -> Void)?
    @AppStorage private var done: Bool
    @State private var active = false
    @State private var started = false
    @State private var index = 0
    @State private var appeared = false
    @State private var availableIds: Set<String> = []

    init(tourKey: String, steps: [CoachStep], onStep: ((CoachStep) -> Void)?,
         ctaLabel: String? = nil, onCTA: (() -> Void)? = nil) {
        self.steps = steps
        self.onStep = onStep
        self.ctaLabel = ctaLabel
        self.onCTA = onCTA
        _done = AppStorage(wrappedValue: false, "tour-\(tourKey)")
    }

    func body(content: Content) -> some View {
        content
            .onPreferenceChange(CoachAnchorIdsKey.self) { ids in
                availableIds = ids
                tryStart()
            }
            .overlayPreferenceValue(CoachAnchorKey.self) { anchors in
                if active, index < steps.count {
                    GeometryReader { geo in
                        CoachOverlay(
                            step: steps[index], number: index + 1, total: steps.count,
                            target: anchors[steps[index].id].map { geo[$0] },
                            primaryLabel: index == steps.count - 1 ? ctaLabel : nil,
                            onNext: advance, onSkip: finish
                        )
                    }
                    .ignoresSafeArea()
                    .transition(.opacity)
                }
            }
            .onAppear {
                #if DEBUG && targetEnvironment(simulator)
                // Headless verification: force tours despite the once-flag.
                if ProcessInfo.processInfo.environment["TBRA_DEBUG_TOUR"] != nil { done = false }
                #endif
                appeared = true
                tryStart()
            }
    }

    /// Fires once the screen has appeared AND the first target has rendered
    /// (data-loading screens publish their anchors late).
    private func tryStart() {
        var startIndex = 0
        #if DEBUG && targetEnvironment(simulator)
        // Headless verification of later steps.
        if let s = ProcessInfo.processInfo.environment["TBRA_DEBUG_TOUR_STEP"],
           let n = Int(s), n < steps.count { startIndex = n }
        #endif
        guard appeared, !done, !started, availableIds.contains(steps[startIndex].id) else { return }
        started = true  // reserve immediately so a second preference tick can't double-fire
        index = startIndex
        onStep?(steps[startIndex])
        // Overlay fades in after the settle/scroll beat.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
            withAnimation(.easeInOut(duration: 0.25)) { active = true }
        }
    }

    private func advance() {
        if index + 1 < steps.count {
            onStep?(steps[index + 1])
            withAnimation(.easeInOut(duration: 0.25)) { index += 1 }
        } else {
            // Last step's primary button: finish, then run the CTA (if any).
            // Skip never triggers the CTA.
            finish()
            onCTA?()
        }
    }

    private func finish() {
        withAnimation(.easeInOut(duration: 0.2)) { active = false }
        done = true
    }
}

/// Fullscreen dim with an even-odd cutout over the target.
private struct CoachCutout: Shape {
    let target: CGRect?
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect)
        if let t = target {
            p.addRoundedRect(in: t, cornerSize: CGSize(width: 12, height: 12))
        }
        return p
    }
}

private struct CoachOverlay: View {
    let step: CoachStep
    let number: Int
    let total: Int
    let target: CGRect?   // nil → centered card, no spotlight
    var primaryLabel: String? = nil
    let onNext: () -> Void
    let onSkip: () -> Void

    var body: some View {
        GeometryReader { geo in
            // Clamp oversized targets (e.g. the whole What's Inside grid) to
            // their top 40% so the caption card always has room and stays
            // readable; drop targets that are (still) fully off-screen so we
            // show a centered card instead of invisible UI.
            let padded: CGRect? = {
                guard var t = target?.insetBy(dx: -8, dy: -8) else { return nil }
                // TALL content blocks that scroll under the status bar / back
                // chevron get their ring top clamped below that zone. Small
                // targets (toolbar icons) legitimately live up there — leave
                // their ring alone.
                if t.height > 120 && t.minY < 118 {
                    let cut = 118 - t.minY
                    t = CGRect(x: t.minX, y: 118, width: t.width, height: max(t.height - cut, 44))
                }
                let maxH = geo.size.height * 0.40
                if t.height > maxH {
                    t = CGRect(x: t.minX, y: t.minY, width: t.width, height: maxH)
                }
                // Trim (don't drop) rings that spill past the bottom edge.
                if t.maxY > geo.size.height - 8 {
                    t = CGRect(x: t.minX, y: t.minY, width: t.width,
                               height: max(geo.size.height - 8 - t.minY, 44))
                }
                if t.maxY < 60 || t.minY > geo.size.height - 70 { return nil }
                return t
            }()
            ZStack {
                CoachCutout(target: padded)
                    .fill(Color.black.opacity(0.72), style: FillStyle(eoFill: true))
                    // Swallow ALL taps (including inside the cutout) — the
                    // tour is deliberately modal; Next/Skip are the only exits.
                    .contentShape(Rectangle())
                    .onTapGesture {}
                if let t = padded {
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Theme.accent, lineWidth: 2)
                        .frame(width: t.width, height: t.height)
                        .position(x: t.midX, y: t.midY)
                }
                card(in: geo.size, target: padded)
            }
        }
    }

    private func card(in size: CGSize, target: CGRect?) -> some View {
        let cardWidth = min(size.width - 48, 340)
        let below = (target?.midY ?? 0) < size.height * 0.5
        let cardY: CGFloat = {
            guard let t = target else { return size.height / 2 }
            let raw = below ? t.maxY + 16 : t.minY - 16
            // Never let the card ride under the status bar or bottom edge.
            return min(max(raw, 110), size.height - 130)
        }()
        let arrowX: CGFloat = {
            guard let t = target else { return size.width / 2 }
            return min(max(t.midX, 44), size.width - 44)
        }()

        return VStack(spacing: 0) {
            if target != nil && below { arrow(pointingUp: true, at: arrowX, cardWidth: cardWidth, screen: size) }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(step.title)
                        .font(Theme.heading(17, .bold))
                        .foregroundStyle(Theme.foreground)
                    Spacer()
                    Text("\(number) of \(total)")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                }
                Text(step.text)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("Skip tour", action: onSkip)
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.muted)
                    Spacer()
                    Button(action: onNext) {
                        Text(primaryLabel ?? (number == total ? "Done" : "Next"))
                            .font(Theme.body(14, .semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 8)
                            .background(Theme.accent, in: Capsule())
                    }
                }
                .padding(.top, 4)
            }
            .padding(16)
            .frame(width: cardWidth)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 18, y: 6)
            if target != nil && !below { arrow(pointingUp: false, at: arrowX, cardWidth: cardWidth, screen: size) }
        }
        .position(x: size.width / 2, y: cardY + (below ? cardHalfGuess : -cardHalfGuess))
    }

    // The card centers on .position; a fixed half-height estimate keeps the
    // math simple and looks right for 2-4 line captions.
    private var cardHalfGuess: CGFloat { 78 }

    private func arrow(pointingUp: Bool, at x: CGFloat, cardWidth: CGFloat, screen: CGSize) -> some View {
        Triangle(pointingUp: pointingUp)
            .fill(Theme.surface)
            .frame(width: 18, height: 9)
            .offset(x: x - screen.width / 2)
    }
}

private struct Triangle: Shape {
    let pointingUp: Bool
    func path(in rect: CGRect) -> Path {
        var p = Path()
        if pointingUp {
            p.move(to: CGPoint(x: rect.midX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        } else {
            p.move(to: CGPoint(x: rect.midX, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        }
        p.closeSubpath()
        return p
    }
}
