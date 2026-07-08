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
    @State private var tab: AppTab = .home
    @State private var searchOpen = false
    // Per-tab navigation paths, lifted here so re-tapping the ACTIVE tab
    // pops its stack to root (web: bottom nav always goes to the page top).
    @State private var homePath = NavigationPath()
    @State private var libraryPath = NavigationPath()
    @State private var discoverPath = NavigationPath()
    @State private var profilePath = NavigationPath()
    /// Book page presented from outside the tab stacks (notification links).
    @State private var presentedBookSlug: String?
    // Measured bar heights, forwarded to pushed screens (see shellBarInsets).
    @State private var topBarHeight: CGFloat = 0
    @State private var bottomNavHeight: CGFloat = 0
    #if DEBUG && targetEnvironment(simulator)
    @State private var debugBookSlug: String?
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
                case .stats: StatsView()
                case .profile: ProfileRootView(path: $profilePath)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            TopBar(
                onSearch: { searchOpen = true },
                onProfile: { tab = .profile },
                onOpenBook: { slug in presentedBookSlug = slug }
            )
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { topBarHeight = $0 }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            BottomNav(tab: $tab, avatarUrl: currentAvatarUrl, onReselect: { reselected in
                // Same-tab tap: pop that tab's stack to its root.
                switch reselected {
                case .home: homePath = NavigationPath()
                case .library: libraryPath = NavigationPath()
                case .discover: discoverPath = NavigationPath()
                case .profile: profilePath = NavigationPath()
                case .stats: break
                }
            })
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bottomNavHeight = $0 }
        }
        .environment(\.shellBarInsets, (top: topBarHeight, bottom: bottomNavHeight))
        .environment(\.openSearch, { searchOpen = true })
        .fullScreenCover(isPresented: $searchOpen) {
            SearchRootView()
                .environment(\.shellBarInsets, (top: 0, bottom: 0))
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
        }
        .sheet(isPresented: $menuDebugOpen) {
            HamburgerMenuSheet(onProfile: { tab = .profile })
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
        }
        .fullScreenCover(isPresented: $settingsDebugOpen) {
            NavigationStack { SettingsView().appDestinations() }
                .environment(\.shellBarInsets, (top: 0, bottom: 0))
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
            case "library": tab = .library
            case "discover": tab = .discover
            case "stats": tab = .stats
            case "profile": tab = .profile
            case let route? where route.hasPrefix("book:"):
                debugBookSlug = String(route.dropFirst("book:".count))
            case "menu": menuDebugOpen = true
            case "settings": settingsDebugOpen = true
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

// ── Top bar — layout.tsx sticky nav ──
struct TopBar: View {
    var onSearch: @MainActor () -> Void = {}
    var onProfile: @MainActor () -> Void = {}
    var onOpenBook: @MainActor (String) -> Void = { _ in }

    @State private var notifications = NotificationsModel()
    @State private var bellOpen = false
    @State private var menuOpen = false

    var body: some View {
        HStack(spacing: 0) {
            // Wordmark: Space Grotesk, lime→blue→purple gradient (.logo-gradient).
            Text("tbr*a")
                .font(Theme.logo(22))
                .foregroundStyle(Theme.logoGradient)

            Spacer()

            HStack(spacing: 26) {
                Button { onSearch() } label: {
                    Image(systemName: "magnifyingglass")
                }
                Button { bellOpen = true } label: {
                    Image(systemName: "bell")
                        .overlay(alignment: .topTrailing) {
                            if notifications.unreadCount > 0 {
                                Circle().fill(Theme.accent)
                                    .frame(width: 8, height: 8)
                                    .offset(x: 2, y: -2)
                            }
                        }
                }
                Button { menuOpen = true } label: {
                    Image(systemName: "line.3.horizontal")
                }
            }
            .font(.system(size: 19, weight: .regular))
            .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Theme.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.border).frame(height: 0.5)
        }
        .task { await notifications.load() }
        .sheet(isPresented: $bellOpen) {
            NotificationsSheet(model: notifications, onOpenBook: onOpenBook)
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.bg)
        }
        .sheet(isPresented: $menuOpen) {
            HamburgerMenuSheet(onProfile: onProfile)
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
        }
    }
}

// ── Bottom nav — bottom-tabs.tsx, five columns, raised home circle ──
struct BottomNav: View {
    @Binding var tab: AppTab
    var avatarUrl: String?
    var onReselect: (AppTab) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 0) {
            navItem(.discover, label: "Discover") { GemIcon().stroked() }
            navItem(.library, label: "My Library") { LibraryIcon().stroked(lineWidth: 1.8) }
            homeButton
            navItem(.stats, label: "Stats") { StatsIcon().stroked() }
            navItem(.profile, label: "Profile") { profileIcon }
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .background(
            Theme.surface.opacity(0.95)
                .background(.ultraThinMaterial)
                .ignoresSafeArea(edges: .bottom)
        )
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 0.5)
        }
    }

    private func navItem<Icon: View>(_ target: AppTab, label: String, @ViewBuilder icon: () -> Icon) -> some View {
        let active = tab == target
        return Button {
            if tab == target { onReselect(target) } else { tab = target }
        } label: {
            VStack(spacing: 2) {
                icon()
                    .frame(width: 22, height: 22)
                Text(label)
                    .font(Theme.body(10, .medium))
            }
            .foregroundStyle(active ? Theme.neonPurple : Theme.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
    }

    // Standout Home button in the center — larger raised circle, no label.
    // Active: solid lime with black icon; inactive: surface-alt with border.
    private var homeButton: some View {
        let active = tab == .home
        return Button {
            if tab == .home { onReselect(.home) } else { tab = .home }
        } label: {
            ZStack {
                Circle()
                    .fill(active ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.surfaceAlt))
                Circle()
                    .stroke(Theme.border, lineWidth: active ? 0 : 1)
                HomeIcon()
                    .stroked()
                    .frame(width: 26, height: 26)
                    .foregroundStyle(active ? Theme.onAccent : Theme.muted)
            }
            .frame(width: 56, height: 56)
            .shadow(color: active ? Theme.accent.opacity(0.30) : .black.opacity(0.25), radius: 10, y: 3)
            .offset(y: -18)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var profileIcon: some View {
        // Avatar paths come back relative (/uploads/...) — resolve against the API host.
        if let avatarUrl,
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

/// Drag handle (≡) used on Up Next cards.
struct DragHandleIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 24
        var p = Path()
        for y: CGFloat in [7, 12, 17] {
            p.move(to: CGPoint(x: 6 * s, y: y * s))
            p.addLine(to: CGPoint(x: 18 * s, y: y * s))
        }
        return p
    }
}
