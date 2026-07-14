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
private struct ShowsShellChromeKey: EnvironmentKey {
    static let defaultValue = true
}
extension EnvironmentValues {
    var shellBarInsets: (top: CGFloat, bottom: CGFloat) {
        get { self[ShellBarInsetsKey.self] }
        set { self[ShellBarInsetsKey.self] = newValue }
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
                if showsChrome, let chrome {
                    TopBarActions(hitLayerOnly: true,
                                  onSearch: chrome.openSearch,
                                  onBell: chrome.openBell,
                                  onMenu: chrome.openMenu)
                        .padding(.top, -bars.top)
                }
            }
            .overlay(alignment: .bottom) {
                if showsChrome, let chrome {
                    BottomNav(hitLayerOnly: true,
                              tab: chrome.tab,
                              avatarUrl: nil,
                              onSelect: chrome.selectTab,
                              onReselect: chrome.reselectTab)
                        .padding(.bottom, -bars.bottom)
                }
            }
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

    var body: some View {
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

extension View {
    /// The floating circular chrome treatment shared by the back chevron and
    /// the book-page share button: translucent fill + border, NO opaque base
    /// (user preference 2026-07-08: share must match this look, not the
    /// other way around). Light mode = scrim's white 35%, untouched; dark
    /// mode = mid-GREY instead of scrim's black 25% — user found the black
    /// circles too heavy on dark.
    func chromeCircle() -> some View {
        frame(width: 40, height: 40)
            .background(Color(UIColor { trait in
                trait.userInterfaceStyle == .light
                    ? UIColor.white.withAlphaComponent(0.35)
                    : UIColor(white: 0.55, alpha: 0.38)
            }), in: Circle())
            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
    }
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
                BookDetailView(idOrSlug: route.idOrSlug)
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
    }
}
extension View {
    func appDestinations() -> some View { modifier(AppDestinations()) }
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

@MainActor
@Observable
final class SeriesModel {
    let slug: String
    var name = ""
    var books: [SeriesBookRow] = []
    var error: String?
    var loading = false

    init(slug: String) { self.slug = slug }

    func load() async {
        loading = true; defer { loading = false }
        struct Res: Codable { let ok: Bool; let name: String; let books: [SeriesBookRow] }
        do {
            let res: Res = try await APIClient.shared.get("/api/v1/series/\(slug)") as Res
            name = res.name
            books = res.books
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load this series."
        }
    }
}

struct SeriesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: SeriesModel
    @State private var tab: Tab = .core

    enum Tab: String, CaseIterable {
        case core = "Core", all = "All", sets = "Sets"
    }

    init(slug: String) {
        _model = State(initialValue: SeriesModel(slug: slug))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Text(model.name)
                        .font(Theme.heading(26, .bold))
                        .foregroundStyle(Theme.foreground)
                    Spacer()
                }
                .padding(.top, 14)

                segmented

                if tab == .core {
                    Text("Main series novels")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                }

                VStack(spacing: 14) {
                    ForEach(filtered) { book in
                        seriesCard(book)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
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
                    .foregroundStyle(tab == t ? .black : Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(tab == t ? Theme.accent : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(4)
        .background(Theme.surfaceAlt.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func seriesCard(_ book: SeriesBookRow) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                HStack(alignment: .top, spacing: 14) {
                    CoverThumb(url: book.coverImageUrl, width: 74, height: 111, radius: 8)
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
                        Text(book.authors.map(\.name).joined(separator: ", "))
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
            }

            HStack(spacing: 10) {
                CompactStatePill(bookId: book.id, state: book.currentState)
                OwnedPill(count: book.ownedFormats.filter { $0 != "unknown" }.count)
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
        .background(Theme.surface.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }
}
