import SwiftUI

// Series page — recreates /series/[slug] (series-books-view.tsx):
// series name, Core/All/Sets segmented (counts derived exactly like the
// web: core = integer-positioned non-boxset, all = non-boxset,
// sets = boxsets), and book cards with cover, "Book N · YEAR", author,
// compact state pill + Owned pill.

struct SeriesRoute: Hashable { let slug: String }

/// Heights of the app-shell bars, published so PUSHED screens can reserve
/// the same space. The shell's .safeAreaInset covers each stack's ROOT, but
/// iOS 27 does not propagate it to views pushed onto the stack — without
/// this, pushed content (incl. every back button) slides under the TopBar.
private struct ShellBarInsetsKey: EnvironmentKey {
    static let defaultValue: (top: CGFloat, bottom: CGFloat) = (0, 0)
}
/// False inside full-screen covers: they replace the whole screen, so the
/// per-screen chrome hit layers (and bar spacers) must not render there.
/// Width of the side column the tab rail lives in (iPhone Duo, 2026-11-25),
/// or 0 when the tabs are the usual bottom bar. See SideRailSlot.
private struct ShellRailWidthKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}
/// True on a wide window (the iPhone Duo's open screen, >= 800pt). Set by
/// the shell; lets a screen pick a wide variant of a section without
/// measuring itself.
private struct ShellWideKey: EnvironmentKey {
    static let defaultValue = false
}
private struct ShowsShellChromeKey: EnvironmentKey {
    static let defaultValue = true
}
extension EnvironmentValues {
    var shellBarInsets: (top: CGFloat, bottom: CGFloat) {
        get { self[ShellBarInsetsKey.self] }
        set { self[ShellBarInsetsKey.self] = newValue }
    }
    var shellWide: Bool {
        get { self[ShellWideKey.self] }
        set { self[ShellWideKey.self] = newValue }
    }
    var shellRailWidth: CGFloat {
        get { self[ShellRailWidthKey.self] }
        set { self[ShellRailWidthKey.self] = newValue }
    }
    var showsShellChrome: Bool {
        get { self[ShowsShellChromeKey.self] }
        set { self[ShowsShellChromeKey.self] = newValue }
    }
}

/// Applied to every screen (tab roots + pushed destinations). Two jobs:
/// 1. Pads the content by the shell bars' measured heights (no-op inside
///    full-screen covers, which zero the env).
/// 2. Renders the INVISIBLE HIT LAYER for the chrome bars: geometry-
///    identical twins of the shell's display-only pills. They must live
///    HERE, inside the screen, because overlays outside the
///    NavigationStacks lose iOS 27 hit-testing to links scrolled beneath
///    the pills (tapping the menu icon opened the book under it), while
///    overlays inside a screen reliably win (the floating back chevron
///    beats the content under it). The overlays are attached BEFORE the
///    safeAreaInset spacers so they anchor to the true top like the shell
///    bars do.
struct PushedScreenChrome: ViewModifier {
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.shellRailWidth) private var rail
    @Environment(\.shellWide) private var wideChrome
    @Environment(\.showsShellChrome) private var showsChrome
    @Environment(ChromeState.self) private var chrome: ChromeState?

    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        content
            // Left-edge back swipe (user request 2026-07-11). Implemented as
            // a NARROW leading overlay strip with its own drag gesture.
            // iOS 27 bug #8: attaching the gesture to the whole screen via
            // .simultaneousGesture desynced the scroll content's interaction
            // layer — after any scroll, taps landed on the element one scroll-
            // delta UP (sim-verified: Up Next tap opened a Reading Now book).
            // The UIKit interactivePopGestureRecognizer is equally dead with
            // a hidden nav bar on iOS 27 (delegate-nil trick ignored). The
            // 18pt gutter is pure padding on every screen (content starts at
            // 20pt), so the strip steals nothing that matters. On root
            // screens dismiss is a harmless no-op.
            .overlay(alignment: .leading) {
                Color.clear
                    .frame(width: 18)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 25)
                            .onEnded { v in
                                if v.translation.width > 70,
                                   abs(v.translation.height) < 90 {
                                    dismiss()
                                }
                            }
                    )
            }
            // The negative paddings cancel the safeAreaInset spacers below —
            // overlays attached in the same chain get pushed by the insets,
            // so without the compensation the twins sat one bar-height off
            // (verified with the red TBRA_DEBUG_TAPS ink).
            .overlay(alignment: .topLeading) {
                if showsChrome, let chrome {
                    TopBarLogo(visible: chrome.atTop, hitLayerOnly: true, onTap: chrome.goHome)
                        .padding(.top, -bars.top)
                }
            }
            .overlay(alignment: .topTrailing) {
                if showsChrome, let chrome, !duoUtilityInRail(rail: rail, wide: wideChrome) {
                    TopBarActions(hitLayerOnly: true,
                                  onSearch: chrome.openSearch,
                                  onBell: chrome.openBell,
                                  onMenu: chrome.openMenu)
                        .padding(.top, -bars.top)
                }
            }
            .overlay(alignment: .bottom) {
                if showsChrome, let chrome, rail == 0 {
                    BottomNav(hitLayerOnly: true,
                              tab: chrome.tab,
                              avatarUrl: nil,
                              onSelect: chrome.selectTab,
                              onReselect: chrome.reselectTab)
                        .padding(.bottom, -bars.bottom)
                }
            }
            // iPhone Duo rail twin. SideRailSlot ignores every safe area, so
            // it resolves to the full window here exactly like the shell copy.
            .overlay {
                if showsChrome, let chrome, rail > 0 {
                    SideColumnStack(width: rail, utility: .hit, tabs: .hit,
                                    tab: chrome.tab,
                                    onSearch: chrome.openSearch,
                                    onBell: chrome.openBell,
                                    onMenu: chrome.openMenu,
                                    onSelect: chrome.selectTab,
                                    onReselect: chrome.reselectTab)
                }
            }
            // Global report button — floating flag above the bottom bar on
            // EVERY screen. Lives inside the screen (not the shell) so it
            // reliably wins hit-testing. NOT gated on showsChrome: that flag
            // is about the fake chrome hit-layers, and bundling the report
            // button with it silently removed reporting from every
            // full-screen cover (Settings, Search, Import…).
            .globalReportOverlay()
            .safeAreaInset(edge: .top, spacing: 0) {
                Color.clear.frame(height: bars.top)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: bars.bottom)
            }
    }
}

/// Standard floating back chevron for pushed screens. It lives in a
/// screen-level overlay ON PURPOSE: back buttons inside the scroll content's
/// top strip go hit-test-dead on repeat pushes (iOS 27) — the overlay layer
/// is hit-tested first and keeps working. Screens keep a 40pt placeholder in
/// their header row so the title layout is unchanged.
struct FloatingBackButton: View {
    /// `bare` = the plain muted chevron some screens use instead of the
    /// scrim circle (Shelves, shelf detail).
    var bare = false
    var topPadding: CGFloat = 14
    @Environment(\.dismiss) private var dismiss
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.showsShellChrome) private var showsChrome
    @Environment(ChromeState.self) private var chrome: ChromeState?

    /// Scrolled: the wordmark has faded out, so the chevron slides up into
    /// its vacated top-left slot in the bar zone (the logo's hit twin
    /// disables itself when not at top, so the spot is free to tap) — user
    /// request 2026-07-12. Skipped inside covers (no shell bars there).
    private var slidUp: Bool {
        showsChrome && bars.top > 0 && chrome?.atTop == false
    }

    @Environment(\.shellRailWidth) private var rail

    var body: some View {
        if showsChrome && rail > 0 {
            // iPhone Duo: back lives in the side column, above search/bell/
            // menu and the tabs (see SideColumnStack).
            SideColumnStack(width: rail, back: .visual, onBack: { dismiss() })
        } else {
            topLeftBack
        }
    }

    private var topLeftBack: some View {
        Button { dismiss() } label: {
            if bare {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 32, height: 36)
            } else {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.foreground.opacity(0.9))
                    .chromeCircle()
            }
        }
        .padding(.leading, 20)
        .padding(.top, topPadding)
        // Rest 8pt into the 56pt bar zone → vertically centered, mirroring
        // the logo pill's placement.
        .offset(y: slidUp ? -(bars.top + topPadding - 8) : 0)
        .animation(.easeOut(duration: 0.18), value: slidUp)
    }
}

// (A UIKit interactivePopGestureRecognizer re-enabler was tried here first —
// delegate = nil + isEnabled = true from a child VC. iOS 27 ignores it when
// the navigation bar is hidden; the SwiftUI simultaneous edge-drag in
// PushedScreenChrome is the working replacement.)

/// The floating circular chrome treatment shared by the back chevron and
/// the book-page share button: translucent fill + border, NO opaque base
/// (user preference 2026-07-08: share must match this look, not the
/// other way around). Light mode = scrim's white 35%, untouched; dark
/// mode = mid-GREY instead of scrim's black 25% — user found the black
/// circles too heavy on dark.
///
/// A ViewModifier reading colorScheme, NOT a `UIColor {trait}` dynamic
/// provider: a provider closure created inside a @MainActor View method
/// carries actor isolation, and UIKit resolves it on SwiftUI's background
/// render thread during trait changes → dispatch_assert_queue trap
/// (TestFlight build 3 crash, 2026-07-18).
private struct ChromeCircle: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content
            .frame(width: 40, height: 40)
            .background(
                scheme == .light
                    ? Color.white.opacity(0.35)
                    : Color(white: 0.55).opacity(0.38),
                in: Circle()
            )
            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
    }
}
extension View {
    func chromeCircle() -> some View { modifier(ChromeCircle()) }
}
extension View {
    /// Overlay a working back button on a pushed screen. `topPadding`
    /// matches the screen's header padding so the chevron sits exactly
    /// where the old in-content button rendered.
    func floatingBack(topPadding: CGFloat = 14, bare: Bool = false) -> some View {
        overlay(alignment: .topLeading) {
            // topPadding lives INSIDE the button so its slide-up offset math
            // can account for it.
            FloatingBackButton(bare: bare, topPadding: topPadding)
        }
    }
    func pushedScreenChrome() -> some View { modifier(PushedScreenChrome()) }
}

/// One modifier carrying every app-wide navigation destination, so each
/// tab's NavigationStack registers the same routes without drift.
struct AppDestinations: ViewModifier {
    func body(content: Content) -> some View {
        content
            .navigationDestination(for: BookRoute.self) { route in
                BookDetailView(idOrSlug: route.idOrSlug, justCompleted: route.justCompleted)
                    .modifier(PushedScreenChrome())
                    .onAppear { TapDebug.log("NAV BookRoute → \(route.idOrSlug)") }
            }
            .navigationDestination(for: SeriesRoute.self) { route in
                SeriesView(slug: route.slug)
                    .modifier(PushedScreenChrome())
            }
            .navigationDestination(for: AuthorRoute.self) { route in
                AuthorView(idOrSlug: route.idOrSlug)
                    .modifier(PushedScreenChrome())
            }
            .navigationDestination(for: UserRoute.self) { route in
                PublicProfileView(username: route.username)
                    .modifier(PushedScreenChrome())
            }
            .navigationDestination(for: ReviewsRoute.self) { route in
                ReviewsListView(bookIdOrSlug: route.bookIdOrSlug, bookTitle: route.bookTitle,
                                scrollToReviewId: route.scrollToReviewId)
                    .modifier(PushedScreenChrome())
            }
            .navigationDestination(for: BuddyReadRoute.self) { route in
                BuddyReadDetailView(slug: route.slug)
                    .modifier(PushedScreenChrome())
            }
            .navigationDestination(for: FollowListRoute.self) { route in
                FollowListView(username: route.username, type: route.type)
                    .modifier(PushedScreenChrome())
            }
            .navigationDestination(for: TopShelfRoute.self) { _ in
                TopShelfView()
                    .modifier(PushedScreenChrome())
            }
            .navigationDestination(for: ShelfEditorRoute.self) { route in
                ShelfEditorView(shelfId: route.shelfId)
                    .modifier(PushedScreenChrome())
            }
            // Public-profile shelves are reachable from any stack now that
            // they have "View shelf" buttons (punch list #5.2).
            .navigationDestination(for: ShelfRoute.self) { route in
                ShelfDetailView(route: route)
                    .modifier(PushedScreenChrome())
            }
    }
}
extension View {
    func appDestinations() -> some View { modifier(AppDestinations()) }
}

/// The trough behind a segmented switch: glass capsule in the refreshed look
/// (My Library, Shelves, Series), a tinted rounded rect in v1.
struct SegmentTrack: ViewModifier {
    func body(content: Content) -> some View {
        if DesignPreview.on {
            content.glassEffect(.regular, in: Capsule())
        } else {
            content
                .background(Theme.surfaceAlt.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}

struct SeriesBookRow: Codable, Hashable, Identifiable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let position: Double?
    let publicationYear: Int?
    let isBoxSet: Bool
    let authors: [BookAuthor]
    let currentState: String?
    let ownedFormats: [String]
    let userRating: Double?
}

struct SeriesRef: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let slug: String?
}

struct ChildSeriesRow: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let slug: String?
    let bookCount: Int
    let coverImageUrl: String?
}

@MainActor
@Observable
final class SeriesModel {
    let slug: String
    var seriesId: String?
    var name = ""
    var books: [SeriesBookRow] = []
    var parentSeries: SeriesRef?
    var childSeries: [ChildSeriesRow] = []
    var error: String?
    var loading = false

    init(slug: String) { self.slug = slug }

    func load() async {
        loading = true; defer { loading = false }
        struct Res: Codable {
            let ok: Bool; let id: String?; let name: String; let books: [SeriesBookRow]
            let parentSeries: SeriesRef?; let childSeries: [ChildSeriesRow]?
        }
        do {
            let res: Res = try await APIClient.shared.get("/api/v1/series/\(slug)") as Res
            seriesId = res.id
            name = res.name
            books = res.books
            parentSeries = res.parentSeries
            childSeries = res.childSeries ?? []
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load this series."
        }
    }

    /// Franchise assignment — admin action, lands on PROD (adminBaseURL).
    func setParent(_ parentId: String?) async -> Bool {
        guard let seriesId else { return false }
        struct Ok: Codable { let ok: Bool }
        do {
            let _: Ok = try await APIClient.shared.adminRequest(
                "/api/v1/admin/series/\(seriesId)/parent", method: "POST",
                body: ["parentSeriesId": parentId as Any])
            await load()
            return true
        } catch { return false }
    }

    func searchFranchises(_ q: String) async -> [SeriesRef] {
        struct Res: Codable { let ok: Bool; let series: [SeriesRef] }
        let res: Res? = try? await APIClient.shared.adminGet(
            "/api/v1/admin/series/search", query: [URLQueryItem(name: "q", value: q)])
        return (res?.series ?? []).filter { $0.id != seriesId }
    }
}

struct SeriesView: View {
    @Environment(\.shellWide) private var wide
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.shellRailWidth) private var rail
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var model: SeriesModel
    @State private var tab: Tab = .core
    /// Which card's state/owned dropdown is open — that card gets elevated
    /// zIndex so the menu renders over the neighbors instead of under them.
    @State private var expandedControlsId: String?

    enum Tab: String, CaseIterable {
        case core = "Core", all = "All", sets = "Sets"
    }

    init(slug: String) {
        _model = State(initialValue: SeriesModel(slug: slug))
    }

    private var isAdmin: Bool {
        if case .signedIn(let u) = auth.phase {
            return ["admin", "super_admin"].contains(u.accountType)
        }
        return false
    }

    private var heroPool: [SeriesBookRow] {
        let core = model.books.filter { !$0.isBoxSet && ($0.position.map { $0 == $0.rounded() } ?? false) }
        return core.isEmpty ? model.books.filter { !$0.isBoxSet } : core
    }
    private var heroCovers: [String] {
        let fromBooks = heroPool.compactMap { $0.coverImageUrl }
        return Array((fromBooks.isEmpty ? model.childSeries.compactMap { $0.coverImageUrl } : fromBooks).prefix(3))
    }
    /// Distinct authors across the series, for the hero's linked "by …".
    private var heroAuthorList: [BookAuthor] {
        var seen: [BookAuthor] = []
        for b in heroPool { for a in b.authors where !seen.contains(where: { $0.id == a.id }) { seen.append(a) } }
        return seen
    }
    private var heroAuthors: String? {
        var seen: [String] = []
        for b in heroPool { for a in b.authors where !seen.contains(a.name) { seen.append(a.name) } }
        return seen.isEmpty ? nil : "by " + seen.prefix(2).joined(separator: ", ")
    }
    private var heroStats: [HeroStat] {
        if model.books.isEmpty && !model.childSeries.isEmpty {
            return [
                HeroStat(label: "series", value: "\(model.childSeries.count)", hue: .blue),
                HeroStat(label: "books on tbr*a", value: "\(model.childSeries.reduce(0) { $0 + $1.bookCount })", hue: .lime),
            ]
        }
        let total = heroPool.count
        // "on tbr*a": the count is what's in our catalogue, not the series'
        // complete bibliography (Rebekah, 2026-11-25).
        var out = [HeroStat(label: total == 1 ? "book on tbr*a" : "books on tbr*a", value: "\(total)", hue: .lime)]
        let read = heroPool.filter { $0.currentState == "completed" }.count
        if read > 0 { out.append(HeroStat(label: "read", value: "\(read)/\(total)", hue: .purple)) }
        let reading = heroPool.filter { $0.currentState == "currently_reading" }.count
        if reading > 0 { out.append(HeroStat(label: "reading", value: "\(reading)", hue: .blue)) }
        return out
    }

    var body: some View {
        ScrollView {
            // iPhone Duo open: a wide hero across the top, then the books as
            // side-by-side cards across the full width (Rebekah, 2026-11-25).
            DuoColumns(spacing: 16) {
                // Design refresh (2026-11-25): cover-art hero (web
                // components/ui/cover-art-hero.tsx twin).
                CoverArtHero(
                    eyebrow: model.books.isEmpty && !model.childSeries.isEmpty ? "Franchise" : "Series",
                    title: model.name,
                    subtitleAuthors: heroAuthorList,
                    covers: heroCovers,
                    stats: heroStats,
                    horizontal: wide
                ) { EmptyView() }
                // 52 clears the top-left back chevron; on the Duo the back
                // button lives in the side column.
                .padding(.top, rail > 0 ? 14 : 52)
                .duoColumn(.full)

                // A series can have sub-series AND its own books (Animorphs →
                // Megamorphs). Show both — attaching a child series must never
                // hide the parent's own book list (web series/[slug] parity).
                let hasSubSeries = !model.childSeries.isEmpty
                let hasOwnBooks = !model.books.isEmpty

                if hasSubSeries {
                    if hasOwnBooks {
                        Text("Series in this franchise")
                            .font(Theme.body(17, .semibold))
                            .foregroundStyle(Theme.foreground)
                            .duoColumn(.full)
                    }
                    Text("\(model.childSeries.count) series · \(model.childSeries.reduce(0) { $0 + $1.bookCount }) books")
                        .font(Theme.body(hasOwnBooks ? 13 : 15))
                        .foregroundStyle(Theme.muted)
                        .padding(.top, hasOwnBooks ? -10 : 0)
                        .duoColumn(.full)
                    franchiseGrid.duoColumn(.full)
                }

                if !hasSubSeries || hasOwnBooks {
                    if hasSubSeries {
                        Text("Books in \(model.name)")
                            .font(Theme.body(17, .semibold))
                            .foregroundStyle(Theme.foreground)
                            .padding(.top, 10)
                            .duoColumn(.full)
                    }

                    segmented.duoColumn(.full)

                    if tab == .core {
                        Text("Main series novels")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                            .duoColumn(.full)
                    }

                    // Each card is its own section: one column on a phone,
                    // side-by-side pairs on the Duo's open screen.
                    ForEach(filtered) { book in
                        seriesCard(book)
                            .zIndex(expandedControlsId == book.id ? 30 : 0)
                    }
                }

                if isAdmin {
                    FranchiseAdminControls(model: model).duoColumn(.full)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .reportsPage("/series/\(model.slug)")
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    private var franchiseGrid: some View {
        // Smaller cards when a few spin-offs sit above the series' own books.
        let compact = !model.books.isEmpty && model.childSeries.count <= 3
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: compact ? 3 : 2),
                  alignment: .leading, spacing: 18) {
            ForEach(model.childSeries) { child in
                NavigationLink(value: SeriesRoute(slug: child.slug ?? child.id)) {
                    VStack(alignment: .leading, spacing: 8) {
                        GeometryReader { geo in
                            CoverThumb(url: child.coverImageUrl, width: geo.size.width,
                                       height: geo.size.width * 1.5, radius: 12, title: child.name)
                        }
                        .aspectRatio(2 / 3, contentMode: .fit)
                        Text(child.name)
                            .font(Theme.body(compact ? 13 : 15, .semibold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text("\(child.bookCount) book\(child.bookCount == 1 ? "" : "s")")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
        }
    }

    // series-books-view.tsx filters, 1:1
    private var filtered: [SeriesBookRow] {
        switch tab {
        case .core:
            return model.books.filter { !$0.isBoxSet && $0.position != nil && ($0.position!).truncatingRemainder(dividingBy: 1) == 0 }
        case .all:
            return model.books.filter { !$0.isBoxSet }
        case .sets:
            return model.books.filter { $0.isBoxSet }
        }
    }

    private func count(_ t: Tab) -> Int {
        switch t {
        case .core: return model.books.filter { !$0.isBoxSet && $0.position != nil && ($0.position!).truncatingRemainder(dividingBy: 1) == 0 }.count
        case .all: return model.books.filter { !$0.isBoxSet }.count
        case .sets: return model.books.filter { $0.isBoxSet }.count
        }
    }

    private var segmented: some View {
        HStack(spacing: 4) {
            ForEach(Tab.allCases, id: \.self) { t in
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { tab = t }
                } label: {
                    HStack(spacing: 6) {
                        Text(t.rawValue)
                            .font(Theme.body(16, tab == t ? .bold : .medium))
                        Text("\(count(t))")
                            .font(Theme.body(13))
                            .opacity(0.7)
                    }
                    .foregroundStyle(tab == t ? Theme.onAccent : Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DesignPreview.on ? 10 : 11)
                    .background(tab == t ? Theme.accent : .clear)
                    .clipShape(DesignPreview.on ? AnyShape(Capsule()) : AnyShape(RoundedRectangle(cornerRadius: 12)))
                }
            }
        }
        .padding(4)
        .modifier(SegmentTrack())
    }

    private func seriesCard(_ book: SeriesBookRow) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Book link split around the author line so the author name is
            // its own link (nested NavigationLinks don't fire).
            HStack(alignment: .top, spacing: 14) {
                NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                    CoverThumb(url: book.coverImageUrl, width: 74, height: 111, radius: 8, title: book.title)
                }
                .buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 4) {
                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(book.title)
                                .font(Theme.body(18, .bold))
                                .foregroundStyle(Theme.foreground)
                                .multilineTextAlignment(.leading)
                            HStack(spacing: 4) {
                                if let pos = book.position {
                                    Text(pos.truncatingRemainder(dividingBy: 1) == 0
                                         ? "Book \(Int(pos))" : "Book \(String(format: "%.1f", pos))")
                                }
                                if let year = book.publicationYear {
                                    if book.position != nil { Text("·") }
                                    Text(String(year))
                                }
                            }
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    AuthorLinks(authors: book.authors)
                }
                Spacer(minLength: 0)
            }
            .padding(14)

            HStack(spacing: 10) {
                CompactStatePill(bookId: book.id, state: book.currentState,
                                 onDropdownChange: { open in expandedControlsId = open ? book.id : nil })
                // Web CompactOwnedButton parity: always visible, unfilled when
                // nothing is owned, tap opens the format checklist.
                CompactOwnedButton(bookId: book.id, formats: book.ownedFormats,
                                   onDropdownChange: { open in expandedControlsId = open ? book.id : nil })
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
        // Shape background WITHOUT clipShape (2026-07-22): clipping the card
        // cut off the state/owned dropdowns; the expanded card's zIndex (set
        // by the host list) keeps the menu above neighboring cards.
        .background(Theme.surface.opacity(0.65), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }
}

// ── Franchise admin controls — franchise-admin-controls.tsx parity ──
// "Part of: X · Remove" when assigned; otherwise "Assign to franchise" with
// an inline search. Admin-only; writes land on PROD via adminBaseURL.
private struct FranchiseAdminControls: View {
    let model: SeriesModel
    @State private var open = false
    @State private var query = ""
    @State private var results: [SeriesRef] = []
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let message {
                Text(message).font(Theme.body(12)).foregroundStyle(Theme.accentText)
            }
            if let parent = model.parentSeries {
                HStack(spacing: 10) {
                    Text("Part of: \(parent.name)")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                    Button {
                        busy = true
                        Task {
                            let ok = await model.setParent(nil)
                            message = ok ? "Removed from franchise" : "Couldn't remove"
                            busy = false
                        }
                    } label: {
                        Text("Remove").font(Theme.body(13, .medium)).foregroundStyle(Theme.destructive)
                    }
                    .disabled(busy)
                }
            } else {
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
                } label: {
                    Text(open ? "Cancel" : "Assign to franchise")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.neonBlue)
                }
            }

            if open && model.parentSeries == nil {
                TextField("Search franchise...", text: $query)
                    .font(Theme.body(14))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                    .onChange(of: query) {
                        let q = query
                        guard q.count >= 2 else { results = []; return }
                        Task {
                            let r = await model.searchFranchises(q)
                            if q == query { results = r }
                        }
                    }
                ForEach(results) { r in
                    Button {
                        busy = true
                        Task {
                            let ok = await model.setParent(r.id)
                            message = ok ? "Assigned to \(r.name)" : "Couldn't assign"
                            if ok { open = false; query = ""; results = [] }
                            busy = false
                        }
                    } label: {
                        Text(r.name)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.foreground)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Theme.surfaceAlt.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                    }
                    .disabled(busy)
                }
            }
        }
        .padding(.top, 8)
    }
}
