import SwiftUI
import Observation
import UniformTypeIdentifiers
import os

// Temporary tap-debug instrumentation (TBRA_DEBUG_TAPS=1): logs global tap
// locations, each home item's layout frame, and which BookRoute navigates —
// for diagnosing the draw-vs-hit-test displacement on Home.
enum TapDebug {
    static let logger = Logger(subsystem: "app.tbra.ios", category: "tapdebug")
    static let enabled = ProcessInfo.processInfo.environment["TBRA_DEBUG_TAPS"] == "1"
    static func log(_ s: String) { if enabled { logger.warning("TAPDEBUG \(s, privacy: .public)") } }
}

struct HitFrameReporter: View {
    let label: String
    var body: some View {
        GeometryReader { g in
            Color.clear
                .onAppear { TapDebug.log("\(label) frame=\(f(g))") }
                .onChange(of: g.frame(in: .global)) { TapDebug.log("\(label) frame=\(f(g))") }
        }
    }
    private func f(_ g: GeometryProxy) -> String {
        let r = g.frame(in: .global)
        return "x\(Int(r.minX)) y\(Int(r.minY)) w\(Int(r.width)) h\(Int(r.height))"
    }
}

// Home — recreates the mobile site's home page (src/app/page.tsx) in its
// exact mobile order: Reading Now → goal + streak cards → Up Next grid.
// (Pick From Your Shelf / Friends Activity / Discover Something New /
// Because You Liked still need endpoints — tracked in docs/native-parity.md.)

@MainActor
@Observable
final class HomeModel {
    var home: HomeData?
    var discover: HomeDiscoverData?
    var error: String?
    var loading = false

    func load() async {
        loading = true; defer { loading = false }
        do {
            home = try await APIClient.shared.home()
            // The account's hide-goal / hide-streak switches (set on the web
            // or another device) take effect here.
            MotivationPrefs.adopt(serverHideGoal: home?.hideGoal, serverHideStreak: home?.hideStreak)
            // Republish the home-screen widgets. Detached so the extra request
            // never delays the view — the widget keeps its previous snapshot
            // until this finishes.
            Task.detached { await WidgetPublisher.refresh() }
        }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load home." }
    }

    /// The heavy sections stream in separately, like the web's Suspense block.
    func loadDiscover() async {
        discover = try? await APIClient.shared.homeDiscover()
    }
}

struct HomeView: View {
    @Binding var path: NavigationPath
    /// Optional: the shell installs it, but previews/harnesses may not.
    @Environment(ChromeState.self) private var chrome: ChromeState?
    @State private var model = UpNextModel()
    @State private var homeModel = HomeModel()
    // Goal / streak tiles the reader has hidden (MotivationPrefs).
    @AppStorage(MotivationPrefs.hideGoalKey) private var hideGoal = false
    @AppStorage(MotivationPrefs.hideStreakKey) private var hideStreak = false
    // iOS-home-screen reorder (reworked 2026-11-16 — Rebekah: "it's not
    // simple or clean"). ONE gesture: hold a card and it lifts under the
    // finger, drag it and the others slide out of the way, let go and it
    // settles and saves. Cards jiggle from the lift until Done; while they
    // jiggle a short press is enough to pick the next one up.
    //
    // The old version needed two long-presses (1s to start the jiggle, then
    // the system .onDrag's own lift) and went through drag-and-drop, which
    // drew a system preview, greyed the source and lost drops that ended in
    // a gap. This one never touches drag-and-drop: the grid places every card
    // by its index, so a move is just an index change, and the lifted card is
    // placed by the finger instead.
    @State private var wiggleMode = false
    @State private var lifted: UpNextLift?
    @State private var gridWidth: CGFloat = 0
    /// Width of the Home scroll view; drives the wide two-column layout.
    @State private var contentWidth: CGFloat = 0
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.shellRailWidth) private var rail
    /// The order when the current drag began — only a changed order is saved.
    @State private var orderAtLift: [String] = []

    private func finishWiggle() {
        withAnimation(.easeOut(duration: 0.15)) {
            wiggleMode = false
            lifted = nil
        }
    }

    private func handleReorderPress(_ state: UIGestureRecognizer.State, at point: CGPoint) {
        let count = model.items.count
        switch state {
        case .began:
            guard gridWidth > 0,
                  let index = UpNextGrid.slot(containing: point, count: count, gridWidth: gridWidth)
            else { return }
            let origin = UpNextGrid.origin(index, gridWidth: gridWidth)
            orderAtLift = model.items.map(\.id)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                wiggleMode = true
                lifted = UpNextLift(id: model.items[index].id,
                                    grab: CGSize(width: point.x - origin.x, height: point.y - origin.y),
                                    finger: point)
            }
        case .changed:
            guard var lift = lifted,
                  let from = model.items.firstIndex(where: { $0.id == lift.id }) else { return }
            lift.finger = point
            lifted = lift   // unanimated: the card stays under the finger
            // The slot whose centre is nearest the CARD's centre — steadier
            // than testing the fingertip, which flickers at a slot boundary.
            let centre = CGPoint(
                x: lift.origin.x + UpNextGrid.columnWidth(gridWidth) / 2,
                y: lift.origin.y + UpNextGrid.cardHeight / 2)
            let target = UpNextGrid.nearestSlot(to: centre, count: count, gridWidth: gridWidth)
            guard target != from else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                model.items.move(fromOffsets: IndexSet(integer: from),
                                 toOffset: target > from ? target + 1 : target)
            }
        case .ended, .cancelled, .failed:
            guard lifted != nil else { return }
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { lifted = nil }
            if model.items.map(\.id) != orderAtLift { model.persistOrder() }
        default:
            break
        }
    }
    @State private var ready = false
    // Hoisted like the web's openStateDropdown so the whole Reading Now
    // section can be z-raised above the goal/streak cards while a card's
    // state dropdown is open (bottom-tabs of the dropdown must not clip).
    @State private var openStateDropdownBookId: String?

    var body: some View {
        NavigationStack(path: $path) {
            homeContent
                .pushedScreenChrome()
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
                // Registered here, not in AppDestinations: the screen's rows
                // are plain Buttons that push onto THIS stack's path.
                .navigationDestination(for: FriendsFeedRoute.self) { _ in
                    FriendsFeedView(onOpen: { openActivity($0) }, onProfile: { openProfile($0) })
                        .modifier(PushedScreenChrome())
                }
        }
    }

    /// A name or photo in the friends feed → that reader's profile.
    private func openProfile(_ user: ActivityUser) {
        guard let username = user.username else { return }
        path.append(UserRoute(username: username))
    }

    /// A friends-activity item → its destination: a written review opens the
    /// review itself, everything else opens the book page.
    private func openActivity(_ item: ActivityItem) {
        if item.isWrittenReview, let reviewId = item.reviewId {
            path.append(ReviewsRoute(
                bookIdOrSlug: item.book.slug ?? item.book.id,
                bookTitle: item.book.title,
                scrollToReviewId: reviewId))
        } else {
            path.append(BookRoute(idOrSlug: item.book.slug ?? item.book.id))
        }
    }

    // Plain onTapGesture, NOT a Button or NavigationLink(value:): on iOS 27
    // value-based links in this grid fired the VALUE of the cell one row down,
    // and a Button's pressed state rendered on the wrong card after a scroll.
    // A closure capturing `item` can't be misassociated. Taps are inert while
    // the cards jiggle, like home-screen icons.
    private func upNextCell(_ item: UpNextItem, index: Int) -> some View {
        let isLifted = lifted?.id == item.id
        let origin = isLifted ? (lifted?.origin ?? .zero)
                              : UpNextGrid.origin(index, gridWidth: gridWidth)
        let width = UpNextGrid.columnWidth(gridWidth)
        return UpNextCard(item: item, number: index + 1)
            .frame(width: width, height: UpNextGrid.cardHeight)
            .contentShape(Rectangle())
            .onTapGesture {
                guard !wiggleMode else { return }
                path.append(BookRoute(idOrSlug: item.slug ?? item.bookId))
            }
            .background(HitFrameReporter(label: "upnext[\(index + 1)] \(item.title.prefix(14))"))
            .modifier(Jiggle(active: wiggleMode && !isLifted, seed: item.id))
            .frame(width: width, height: UpNextGrid.cardHeight)
            .scaleEffect(isLifted ? 1.06 : 1)
            .shadow(color: .black.opacity(isLifted ? 0.45 : 0), radius: 18, y: 10)
            .offset(x: origin.x, y: origin.y)
            .zIndex(isLifted ? 10 : 0)
            .accessibilityAddTraits(.isButton)
    }

    // Two columns of equal slots, each card placed by its index. Eager on
    // purpose (the queue is tiny, and it keeps iOS 27's lazy-container
    // interaction bugs out of this much-churned screen), and identified by
    // item so a reorder slides the cards instead of swapping their contents.
    private var upNextGrid: some View {
        ZStack(alignment: .topLeading) {
            if gridWidth > 0 {
                ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                    upNextCell(item, index: index)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .frame(height: UpNextGrid.height(count: model.items.count), alignment: .topLeading)
        .contentShape(Rectangle())
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
        .gesture(ReorderPressGesture(minimumDuration: wiggleMode ? 0.12 : 0.4,
                                     onChange: handleReorderPress))
        .onDisappear { if wiggleMode { finishWiggle() } }
    }

    private var homeContent: some View {
        ScrollView {
            // Nothing may render until BOTH models have answered: if the grid
            // lays out first and the Reading Now / goal sections insert above
            // it a moment later, iOS 27's scroll-content interaction layer
            // keeps the PRE-insertion offsets — frames and gestures follow the
            // new layout but button/link hit regions don't, so taps activate
            // the card one row down (and controls near the top go dead). The
            // .id() below rebuilds the content wholesale if the section
            // structure ever changes later (e.g. a refresh adds Reading Now).
            if !ready {
                ProgressView().tint(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 120)
            } else {
                homeSections
                    // The discover flag is part of the key ON PURPOSE: the
                    // deferred sections (Because You Liked / Friends Activity /
                    // Discover) insert BELOW Up Next after first layout, and
                    // iOS 27 keeps routing HELD touches (long-press, drag
                    // lifts) by the pre-insertion offsets even though quick
                    // taps follow the fresh layout — that stale routing was
                    // the "glitchy reorder" all along. Rebuilding once when
                    // the deferred sections arrive re-syncs the touch layer.
                    .id("home-\(homeModel.home?.readingNow.isEmpty != false)-\(homeModel.home == nil)-\(homeModel.discover == nil)-\(isWide)")
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
        .background(AmbientBackground())
        .simultaneousGesture(
            SpatialTapGesture(coordinateSpace: .global).onEnded { v in
                TapDebug.log("TAP at x\(Int(v.location.x)) y\(Int(v.location.y))")
            }
        )
        .tracksScrollAtTop()
        .reportsPage("/")
        .refreshable {
            async let a: Void = model.load()
            async let b: Void = homeModel.load()
            async let c: Void = homeModel.loadDiscover()
            _ = await (a, b, c)
        }
        .task {
            async let a: Void = model.load()
            async let b: Void = homeModel.load()
            _ = await (a, b)
            ready = true
            await homeModel.loadDiscover()
        }
        .alert("Error", isPresented: .constant(model.error != nil || homeModel.error != nil)) {
            Button("OK") { model.error = nil; homeModel.error = nil }
        } message: { Text(model.error ?? homeModel.error ?? "") }
    }

    @Environment(\.openSearch) private var openSearch

    /// A reader with nothing in progress and nothing queued — in practice a
    /// brand-new account, which is who the App Store will send us.
    private var isBlankSlate: Bool {
        guard let home = homeModel.home else { return false }
        return home.readingNow.isEmpty && model.items.isEmpty && !model.loading
    }

    /// Wide window (the iPhone Duo's open inner screen, ~850pt of content):
    /// Home becomes two columns that meet near the fold. Phone widths —
    /// including the Duo's closed screen and a half-screen split — keep the
    /// single column. Measured, not device-sniffed, so it follows the window.
    private var isWide: Bool { contentWidth >= 700 }

    private var homeSections: some View {
        Group {
            if isWide {
                VStack(alignment: .leading, spacing: 28) {
                    starterSection
                    HStack(alignment: .top, spacing: 24) {
                        VStack(alignment: .leading, spacing: 28) {
                            readingNowSection
                            pickSection
                        }
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .zIndex(openStateDropdownBookId != nil ? 50 : 0)
                        VStack(alignment: .leading, spacing: 28) {
                            motivationSection
                            upNextSection
                        }
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(.top, -duoRightColumnLift(barTop: bars.top, rail: rail))
                    }
                    .zIndex(openStateDropdownBookId != nil ? 50 : 0)
                    deferredSections
                }
            } else {
                VStack(alignment: .leading, spacing: 28) {
                    starterSection
                    readingNowSection
                    motivationSection
                    upNextSection
                    pickSection
                    deferredSections
                }
            }
        }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 40)
    }

    @ViewBuilder private var starterSection: some View {
        if DesignPreview.on && isBlankSlate {
            HomeStarterCard(
                onSearch: { openSearch() },
                onDiscover: { chrome?.tab = .discover })
        }
    }

    @ViewBuilder private var readingNowSection: some View {
        // ── Reading Now ──
        if let home = homeModel.home, !home.readingNow.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeading("Reading Now")
                VStack(spacing: 12) {
                    ForEach(home.readingNow) { book in
                        ReadingNowCard(
                            book: book,
                            openDropdownBookId: $openStateDropdownBookId,
                            onOpen: { path.append(BookRoute(idOrSlug: book.slug ?? book.id)) },
                            onCompleted: {
                                path.append(BookRoute(idOrSlug: book.slug ?? book.id,
                                                      justCompleted: true))
                            }
                        ) {
                            await homeModel.load()
                            await model.load()
                        }
                        .background(HitFrameReporter(label: "readingnow \(book.title.prefix(14))"))
                        .zIndex(openStateDropdownBookId == book.id ? 50 : 0)
                    }
                }
            }
            .zIndex(openStateDropdownBookId != nil ? 50 : 0)
        }
    }

    @ViewBuilder private var motivationSection: some View {
        // ── Goal + streak (mobile order: between Reading Now and Up Next) ──
        // Either tile can be hidden (long-press it, or Settings →
        // Display). One hidden: the other takes the full width. Both
        // hidden: the row is gone and Up Next moves up.
        if let home = homeModel.home, !(hideGoal && hideStreak) {
            HStack(alignment: .top, spacing: 12) {
                if !hideGoal {
                    ReadingGoalCardView(goal: home.goal, year: home.year,
                                        autoEdit: chrome?.pendingOpenGoalEditor == true,
                                        onAutoEditConsumed: { chrome?.pendingOpenGoalEditor = false },
                                        onOpenYear: {
                                            // Same destination as the web card: this
                                            // year's finished books in the library.
                                            chrome?.pendingLibrarySelection = LibrarySelection(
                                                group: "activity", filter: "completed", year: home.year)
                                            chrome?.selectTab(.library)
                                        },
                                        onHide: { withAnimation { MotivationPrefs.setHideGoal(true) } }) {
                        await homeModel.load()
                    }
                    .contextMenu {
                        Button { withAnimation { MotivationPrefs.setHideGoal(true) } } label: {
                            Label("Hide reading goal", systemImage: "eye.slash")
                        }
                    }
                }
                if !hideStreak {
                    ReadingStreakCardView(streak: home.streak)
                        .contextMenu {
                            Button { withAnimation { MotivationPrefs.setHideStreak(true) } } label: {
                                Label("Hide streak", systemImage: "eye.slash")
                            }
                        }
                }
            }
            // v2 tiles stretch to the taller of the two, so the pair
            // always shares one height (v1 sized each to its content).
            .fixedSize(horizontal: false, vertical: DesignPreview.on)
        }
    }

    @ViewBuilder private var upNextSection: some View {
        // ── Up Next ──
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                SectionHeading("Up Next")
                    .background(HitFrameReporter(label: "upnext-heading"))
                Spacer()
                if wiggleMode {
                    Button {
                        finishWiggle()
                    } label: {
                        Text("Done")
                            .font(Theme.body(13, .semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .background(Theme.accent, in: Capsule())
                    }
                }
            }

            upNextGrid

            if model.items.isEmpty && !model.loading {
                Text(DesignPreview.on ? "Books you plan to read next line up here."
                                      : "Nothing queued yet")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            } else if model.items.count > 1 {
                Text(wiggleMode ? "Drag a book to move it" : "Hold & drag to reorder")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
            }
        }
    }

    @ViewBuilder private var pickSection: some View {
        // ── Pick From Your Shelf ──
        if let home = homeModel.home {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeading("Pick From Your Shelf")
                TbrSuggestionCard(book: home.tbrSuggestion)
            }
        }
    }

    @ViewBuilder private var deferredSections: some View {
        // ── Deferred sections (web renders these via Suspense) ──
        if let discover = homeModel.discover {
            // Friends Activity sits directly under Pick From Your Shelf.
            if discover.friendsActivity.contains(where: \.isFeedVisible) {
                VStack(alignment: .leading, spacing: 14) {
                    SectionHeading("Friends Activity")
                    FriendsActivityRow(
                        activity: discover.friendsActivity,
                        onOpen: { openActivity($0) },
                        onSeeMore: { path.append(FriendsFeedRoute()) },
                        onProfile: { openProfile($0) })
                }
            }

            ForEach(discover.becauseYouLiked, id: \.seed.id) { section in
                BecauseYouLikedSection(section: section)
            }

            if !discover.discover.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) {
                        SectionHeading("Discover Something New")
                        InfoBubble(text: "Personalized picks based on your reading history — genres you love, fiction vs. nonfiction balance, and content comfort level. Only shows books not already on your shelves. Refreshes each visit.")
                    }
                    HorizontalBookRow(books: discover.discover)
                }
            }
        }
    }
}

// The web's .section-heading: Outfit, 600 weight, foreground, text-xl.
struct SectionHeading: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(Theme.heading(24, .bold))
            .foregroundStyle(Theme.foreground)
    }
}

/// Carries the Reading split-button's frame up to the card so the state menu
/// can be positioned off the button rather than off the card's bottom edge.
private struct StateButtonAnchorKey: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

// ── Reading Now card — currently-reading-section.tsx ──
private struct ReadingNowCard: View {
    let book: ReadingNowBook
    @Binding var openDropdownBookId: String?
    let onOpen: () -> Void
    /// Marking the book Finished/DNF here hands off to the book page so the
    /// review wizard + "What to Read Next" run, like the web's compact
    /// ReadingStateButton pushing /book/<slug>?review=true.
    var onCompleted: () -> Void = {}
    let onChanged: () async -> Void

    private var showStateDropdown: Bool { openDropdownBookId == book.id }
    @State private var showTrackSheet = false
    @State private var confirmState: (state: String, label: String)?
    @State private var showDatePicker = false
    @State private var pendingCompleteState: String = "completed"
    @State private var busy = false

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .topTrailing) {
                cardBody
            }
            .background(cardBackground)
            // The refreshed card shares the goal/streak tiles' 18pt corners.
            .clipShape(RoundedRectangle(cornerRadius: DesignPreview.on ? 18 : 12))
            // Applied AFTER clipShape so the menu isn't clipped by the card.
            .overlayPreferenceValue(StateButtonAnchorKey.self) { anchor in
                GeometryReader { proxy in
                    if showStateDropdown, let anchor {
                        let button = proxy[anchor]
                        dropdown.offset(x: button.minX, y: button.maxY + 6)
                    }
                }
            }

            if let confirm = confirmState {
                confirmPrompt(confirm)
            }
        }
        .sheet(isPresented: $showTrackSheet) {
            TrackProgressSheet(book: book) { await onChanged() }
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.surface)
        }
        .sheet(isPresented: $showDatePicker) {
            CompletionDateSheet(
                title: pendingCompleteState == "dnf" ? "When did you stop reading?" : "When did you finish?"
            ) { date, precision in
                Task { await setState(pendingCompleteState, completionDate: date, precision: precision) }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
        .opacity(busy ? 0.5 : 1)
    }

    @ViewBuilder private var cardBody: some View {
        if DesignPreview.on { cardBodyV2 } else { cardBodyV1 }
    }

    // Refreshed card (2026-11): a real progress bar instead of the "45%" tag
    // under the cover, ONE lime action (log progress) and the state menu as a
    // blue pill. Same buttons, sheets and dropdown anchor as v1 — only the
    // layout differs.
    // Proportions (2026-11-16, later the same day): the first cut was ~26pt
    // slimmer than v1 and looked thin beside the goal and streak tiles
    // (Rebekah). It now takes their shell — 18pt corners, 14pt padding — with
    // a 60x90 cover, a thicker bar, the percent as a heading-font number and
    // taller pills. About 118pt per card.
    private var cardBodyV2: some View {
        HStack(alignment: .center, spacing: 12) {
            Button(action: onOpen) {
                HStack(alignment: .center, spacing: 12) {
                    CoverThumb(url: book.coverImageUrl,
                               width: book.usesAudiobookCover == true ? 80 : 60,
                               height: book.usesAudiobookCover == true ? 80 : 90,
                               radius: 8, title: book.title)
                        .shadow(color: .black.opacity(0.35), radius: 6, y: 3)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(book.title)
                            .font(Theme.body(17, .bold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(book.authors.joined(separator: ", "))
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.foreground.opacity(0.70))
                            .lineLimit(1)
                        progressBar.padding(.top, 7)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            VStack(spacing: 8) {
                Button {
                    showTrackSheet = true
                } label: {
                    Label("Update", systemImage: "plus")
                        .labelStyle(.titleAndIcon)
                        .font(Theme.body(13, .bold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Theme.accent, in: Capsule())
                }
                .accessibilityLabel("Track progress")

                Button {
                    withAnimation(.easeOut(duration: 0.15)) {
                        openDropdownBookId = showStateDropdown ? nil : book.id
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text("Reading")
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                    }
                    // Blue, the app's "tap for more" colour — the state menu
                    // must not read as disabled (Rebekah, 2026-11-16: "I
                    // don't like it grey"). Solid, so it holds its own
                    // against the blurred cover art behind the card.
                    .font(Theme.body(13, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color(hex: "0ea5e9"), in: Capsule())
                }
                .anchorPreference(key: StateButtonAnchorKey.self, value: .bounds) { $0 }
            }
            .frame(width: 100)
        }
        .padding(14)
    }

    private var progressBar: some View {
        let pct = max(0, min(100, book.progress ?? 0))
        return HStack(spacing: 10) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.foreground.opacity(0.14))
                    Capsule().fill(Theme.accent)
                        .frame(width: pct > 0 ? max(8, geo.size.width * CGFloat(pct) / 100) : 0)
                }
            }
            .frame(height: 8)
            // The percent is the card's headline number, in the heading font
            // like the goal and streak tiles; "Not started" stays quiet.
            Text(pct > 0 ? "\(pct)%" : "Not started")
                .font(pct > 0 ? Theme.heading(20, .heavy) : Theme.body(11, .bold))
                .monospacedDigit()
                .foregroundStyle(Theme.foreground.opacity(pct > 0 ? 1 : 0.5))
                .fixedSize()
        }
    }

    private var cardBodyV1: some View {
        HStack(alignment: .center, spacing: 16) {
            // Cover + title/author navigate to the book page (the action
            // buttons on the right keep their own tap targets).
            // Plain Button + path.append, NOT NavigationLink(value:) —
            // with 2+ sibling cards in this run, iOS 27 kills every
            // card's NavigationLink hit region (one card alone works).
            // Same disease as the Up Next grid; same cure.
            Button(action: onOpen) {
                HStack(alignment: .center, spacing: 16) {
                    // Square 80×80 ONLY when the server resolved the cover to
                    // the real square audiobook image; otherwise regular 2:3.
                    CoverThumb(url: book.coverImageUrl,
                               width: book.usesAudiobookCover == true ? 80 : 60,
                               height: book.usesAudiobookCover == true ? 80 : 90,
                               radius: 8, title: book.title)
                        .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
                        .overlay(alignment: .bottom) {
                            if let progress = book.progress, progress > 0 {
                                Text("\(progress)%")
                                    .font(Theme.body(10, .bold))
                                    .foregroundStyle(Theme.neonPurple)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 3)
                                    .background(.ultraThinMaterial, in: Capsule())
                                    .overlay(Capsule().stroke(Theme.neonPurple.opacity(0.30), lineWidth: 1))
                                    .offset(y: 10)
                            }
                        }

                    VStack(alignment: .leading, spacing: 4) {
                        // Web allows 3 title lines (user request 2026-07-14 —
                        // "Remarkably Bright Creatures" was truncating at one).
                        // fixedSize is what makes lineLimit actually wrap in
                        // an HStack (same lesson as the shelf cards).
                        Text(book.title)
                            .font(Theme.body(16, .bold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(book.authors.joined(separator: ", "))
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.foreground.opacity(0.70))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            // Action buttons — stacked right column, 104pt like the web
            VStack(spacing: 6) {
                Button {
                    showTrackSheet = true
                } label: {
                    Text("Track Progress")
                        .font(Theme.body(11, .semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(Theme.neonBlue)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // Reading split button (lime, black text, chevron)
                Button {
                    withAnimation(.easeOut(duration: 0.15)) {
                        openDropdownBookId = showStateDropdown ? nil : book.id
                    }
                } label: {
                    HStack(spacing: 0) {
                        Text("Reading")
                            .font(Theme.body(11, .semibold))
                            .frame(maxWidth: .infinity)
                        Rectangle().fill(.black.opacity(0.2)).frame(width: 1, height: 18)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 8)
                    }
                    .foregroundStyle(.black)
                    .padding(.vertical, 8)
                    .background(Theme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                // Hands the button's real frame to the card's overlay so the
                // menu can hang directly off it. The old version guessed with
                // a fixed .offset(y: 88) from the CARD's bottom edge, which
                // landed the menu ~45pt clear of the button and read as a bug
                // (punch list #11).
                .anchorPreference(key: StateButtonAnchorKey.self, value: .bounds) { $0 }
            }
            .frame(width: 104)
        }
        .padding(16)
    }

    @ViewBuilder private var cardBackground: some View {
        ZStack {
            // .currently-reading-card-base fallback gradient…
            LinearGradient(
                colors: [
                    Theme.accent.opacity(0.08),
                    Theme.neonPurple.opacity(0.06),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .background(Theme.surfaceAlt)
            // …under the blurred cover + dark overlay (.book-card-bg-img + overlay)
            if let cover = book.coverImageUrl, let url = URL(string: cover) {
                CoverBlurImage(url: url)
                Theme.scrim // black 25% dark · white 35% light (.currently-reading-overlay)
            }
        }
    }

    // State dropdown — Finished / Paused / DNF, anchored under the buttons
    @ViewBuilder private var dropdown: some View {
        if showStateDropdown {
            VStack(spacing: 0) {
                dropdownRow("Finished") {
                    pendingCompleteState = "completed"
                    showDatePicker = true
                }
                Divider().background(Theme.border)
                dropdownRow("Paused") { confirmState = ("paused", "Paused") }
                Divider().background(Theme.border)
                dropdownRow("DNF") {
                    pendingCompleteState = "dnf"
                    showDatePicker = true
                }
            }
            .frame(width: 104)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
            .zIndex(10)
        }
    }

    private func dropdownRow(_ label: String, action: @escaping () -> Void) -> some View {
        Button {
            openDropdownBookId = nil
            action()
        } label: {
            Text(label)
                .font(Theme.body(13, .medium))
                .foregroundStyle(Theme.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
        }
    }

    private func confirmPrompt(_ confirm: (state: String, label: String)) -> some View {
        HStack(spacing: 12) {
            (Text("Mark ") + Text(book.title).fontWeight(.semibold) + Text(" as \(confirm.label)?"))
                .font(Theme.body(14))
                .foregroundStyle(Theme.foreground)
            Spacer()
            Button("Cancel") { confirmState = nil }
                .font(Theme.body(12, .medium))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
            Button(confirm.label) {
                confirmState = nil
                Task { await setState(confirm.state) }
            }
            .font(Theme.body(12, .semibold))
            .foregroundStyle(.black)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Theme.accent)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .padding(12)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
    }

    private func setState(_ state: String, completionDate: String? = nil, precision: String? = nil) async {
        busy = true; defer { busy = false }
        do {
            try await APIClient.shared.setReadingState(
                bookId: book.id, state: state,
                completionDate: completionDate,
                completionPrecision: precision
            )
            await onChanged()
            if state == "completed" || state == "dnf" { onCompleted() }
        } catch {
            // The card stays; a reload reconciles with the server.
            await onChanged()
        }
    }
}

// ── Track Progress sheet — the TrackSheet from the web ──
private struct TrackProgressSheet: View {
    let book: ReadingNowBook
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var noteText = ""
    @State private var pageMode: PageMode = .page
    @State private var pageValue = ""
    @State private var mood: String?
    @State private var pace: String?
    @State private var showExtras = false
    /// Off by default: a note is private unless the reader shares it.
    /// Progress is not covered — friends see page/percent either way.
    @State private var shareNote = false
    /// On by default when the book is in an active buddy read (web
    /// currently-reading-section.tsx parity): updates are what the buddy
    /// readers are there for. Set in init from the book.
    @State private var shareToBuddyRead: Bool
    @State private var busy = false
    @State private var saved = false
    @State private var errorText: String?

    init(book: ReadingNowBook, onSaved: @escaping () async -> Void) {
        self.book = book
        self.onSaved = onSaved
        _shareToBuddyRead = State(initialValue: book.buddyReadId != nil)
    }

    enum PageMode: String, CaseIterable { case page = "Page", percent = "%" }

    private let moods: [(key: String, emoji: String, label: String)] = [
        ("excited", "🤩", "Excited"), ("tense", "😰", "Tense"),
        ("emotional", "🥺", "Emotional"), ("bored", "😴", "Bored"),
        ("relaxed", "😌", "Relaxed"), ("curious", "🤔", "Curious"),
        ("confused", "😵‍💫", "Confused"), ("nostalgic", "🥹", "Nostalgic"),
    ]
    private let paces = [("slow", "Slow"), ("steady", "Steady"), ("fast", "Fast"), ("flying", "Flying")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Tracking: \(book.title)")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                    }
                }

                if saved {
                    Text("✓ Note saved")
                        .font(Theme.body(14, .medium))
                        // accentDark is lime-500 in BOTH modes — illegible on
                        // the light surface (punch list #10).
                        .foregroundStyle(Theme.accentText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Theme.accent.opacity(0.05))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.accent.opacity(0.2), lineWidth: 1))
                } else {
                    TextField("How's it going?", text: $noteText, axis: .vertical)
                        .lineLimit(2...5)
                        .brandedField()

                    HStack(spacing: 10) {
                        // Page / % mini toggle
                        HStack(spacing: 0) {
                            ForEach(PageMode.allCases, id: \.self) { m in
                                Button {
                                    pageMode = m
                                } label: {
                                    Text(m.rawValue)
                                        .font(Theme.body(12, .medium))
                                        .foregroundStyle(pageMode == m ? Theme.onAccent : Theme.muted)
                                        .padding(.horizontal, 12).padding(.vertical, 6)
                                        .background(pageMode == m ? Theme.accent : .clear,
                                                    in: Theme.controlShape(0))
                                }
                            }
                        }
                        .padding(DesignPreview.on ? 3 : 0)
                        .overlay(Theme.controlShape(10).stroke(Theme.border, lineWidth: 1))
                        .clipShape(Theme.controlShape(10))

                        TextField(pageMode == .page ? "Page #" : "Percent", text: $pageValue)
                            .keyboardType(.numberPad)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.foreground)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .frame(width: 110)
                            .background(Theme.surfaceAlt)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        if pageMode == .page, let pages = book.pages {
                            Text("of \(pages)")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                    }

                    Button {
                        withAnimation { showExtras.toggle() }
                    } label: {
                        Text(showExtras ? "− Mood & pace" : "+ Mood & pace")
                            .font(Theme.body(12, .medium))
                            .foregroundStyle(Theme.neonBlue)
                    }

                    if showExtras {
                        VStack(alignment: .leading, spacing: 10) {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(moods, id: \.key) { m in
                                        Button {
                                            mood = mood == m.key ? nil : m.key
                                        } label: {
                                            VStack(spacing: 2) {
                                                Text(m.emoji).font(.system(size: 20))
                                                Text(m.label).font(Theme.body(9)).foregroundStyle(Theme.muted)
                                            }
                                            .padding(.horizontal, 10).padding(.vertical, 6)
                                            .background(mood == m.key ? Theme.accent.opacity(0.15) : Theme.surfaceAlt)
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                            .overlay(RoundedRectangle(cornerRadius: 10)
                                                .stroke(mood == m.key ? Theme.accent.opacity(0.5) : .clear, lineWidth: 1))
                                        }
                                    }
                                }
                            }
                            HStack(spacing: 8) {
                                ForEach(paces, id: \.0) { p in
                                    Button {
                                        pace = pace == p.0 ? nil : p.0
                                    } label: {
                                        Text(p.1)
                                            .font(Theme.body(12, .medium))
                                            .foregroundStyle(pace == p.0 ? .black : Theme.muted)
                                            .padding(.horizontal, 14).padding(.vertical, 6)
                                            .background(pace == p.0 ? Theme.accent : Theme.surfaceAlt)
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                        }
                    }

                    // Share switch — always on screen so it is easy to find;
                    // it covers the note only, never the page/percent.
                    Toggle(isOn: $shareNote) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Share this note with friends")
                                .font(Theme.body(14, .medium))
                                .foregroundStyle(Theme.foreground)
                            Text(shareNote
                                 ? "Friends will see it in their feed, on this book and on your profile."
                                 : "Only you can see your note. Your progress still shows to friends.")
                                .font(Theme.body(11))
                                .foregroundStyle(Theme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(Theme.accent)

                    if book.buddyReadId != nil {
                        Toggle(isOn: $shareToBuddyRead) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Share with your buddy read")
                                    .font(Theme.body(14, .medium))
                                    .foregroundStyle(Theme.foreground)
                                Text(shareToBuddyRead
                                     ? "Your buddy readers will see this update in the discussion."
                                     : "This update stays out of the buddy read discussion.")
                                    .font(Theme.body(11))
                                    .foregroundStyle(Theme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .tint(Theme.accent)
                    }

                    if let errorText {
                        Text(errorText).font(Theme.body(12)).foregroundStyle(Theme.destructive)
                    }

                    Button {
                        Task { await save() }
                    } label: {
                        if busy { ProgressView().tint(Theme.onAccent) } else { Text("Save note") }
                    }
                    .buttonStyle(AccentButtonStyle())
                    .disabled(busy || noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    // Progress can be saved without writing anything (user
                    // request 2026-07-23) — mirrored on the web entry form.
                    if noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            Task { await save() }
                        } label: {
                            if busy { ProgressView().tint(Theme.accentText) } else { Text("Save progress only") }
                        }
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.accentText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Theme.accent.opacity(0.1), in: Theme.controlShape(14))
                        .overlay(Theme.controlShape(14).stroke(Theme.accent.opacity(0.45), lineWidth: 1))
                        .disabled(busy || Int(pageValue) == nil)
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.surface)
    }

    private func save() async {
        busy = true; defer { busy = false }
        errorText = nil
        do {
            let value = Int(pageValue)
            try await APIClient.shared.addReadingNote(
                bookId: book.id,
                noteText: noteText.trimmingCharacters(in: .whitespacesAndNewlines),
                pageNumber: pageMode == .page ? value : nil,
                percentComplete: pageMode == .percent ? value : nil,
                mood: mood, pace: pace,
                buddyReadId: shareToBuddyRead ? book.buddyReadId : nil,
                isPrivate: !shareNote
            )
            saved = true
            await onSaved()
            try? await Task.sleep(for: .seconds(1.2))
            dismiss()
        } catch {
            errorText = (error as? APIError)?.errorDescription ?? "Couldn't save the note."
        }
    }
}

// ── Completion date sheet (Finished / DNF) ──
// ── Goal + streak cards — reading-goal-card.tsx / reading-streak-card.tsx ──
private struct ReadingGoalCardView: View {
    let goal: ReadingGoal?
    let year: Int
    /// True when the widget's goal ring was tapped (tbra://goal) — opens the
    /// edit sheet on arrival instead of leaving the reader to find it.
    var autoEdit = false
    var onAutoEditConsumed: () -> Void = {}
    /// Tapping the tile (anywhere but the pencil) opens this year's finished
    /// books in the library — reading-goal-card.tsx links the same way.
    var onOpenYear: () -> Void = {}
    /// "Goals aren't for me" in the set-a-goal sheet (no goal yet only).
    var onHide: (() -> Void)? = nil
    let onChanged: () async -> Void
    @State private var editing = false

    var body: some View {
        Group {
            if DesignPreview.on { bodyV2 } else { bodyV1 }
        }
        .onAppear {
            guard autoEdit else { return }
            onAutoEditConsumed()
            editing = true
        }
        .sheet(isPresented: $editing) {
            GoalEditSheet(year: year, current: goal?.targetBooks, onSaved: { await onChanged() }, onHide: onHide)
                // Taller when the opt-out line is showing (no goal yet).
                .presentationDetents([.height(goal == nil && onHide != nil ? 330 : 260)])
                .presentationBackground(Theme.surface)
        }
    }

    // Refreshed tile (2026-11): the ring is the hero, drawn in a lime→blue
    // sweep that animates in, with a pace line that changes as the year does.
    // Ring, count and pace pill sit CENTRED in the tile: leading-aligned they
    // hugged the left edge and left a ragged gap on the right whenever the
    // count was short (Rebekah, 2026-11-16).
    private var bodyV2: some View {
        VStack(spacing: 10) {
            HStack {
                Text("\(String(year)) GOAL")
                    .font(Theme.body(11, .bold)).tracking(0.8)
                    .foregroundStyle(Theme.muted)
                Spacer()
                Button { editing = true } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 26, height: 22)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Edit reading goal")
            }
            if let goal {
                HStack(spacing: 12) {
                    GoalSweepRing(percent: goal.percentComplete,
                                  yearElapsed: GoalYear.progress(year: year)?.elapsed)
                        .frame(width: 66, height: 66)

                    VStack(alignment: .leading, spacing: 0) {
                        Text("\(goal.completedBooks)")
                            .font(Theme.heading(34, .heavy))
                            .foregroundStyle(Theme.foreground)
                            .contentTransition(.numericText())
                        Text("of \(goal.targetBooks) books")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity)
                Spacer(minLength: 0)
                GoalPacePill(pace: goal.paceLine(year: year))
                    .frame(maxWidth: .infinity)
            } else {
                Button { editing = true } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Image(systemName: "target")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(Theme.accentText)
                        Text("Set your \(String(year)) goal")
                            .font(Theme.heading(17, .bold))
                            .foregroundStyle(Theme.foreground)
                        Text("Pick a number and watch the ring fill.")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(HomeTileBackground(glow: Theme.accent))
        .contentShape(RoundedRectangle(cornerRadius: 18))
        .onTapGesture {
            // No goal yet: the tile's own button opens the editor instead.
            if goal != nil { onOpenYear() }
        }
        .accessibilityAddTraits(goal != nil ? .isButton : [])
        .accessibilityHint(goal != nil ? "Shows the books you finished in \(String(year))" : "")
    }

    private var bodyV1: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(String(year)) Reading Goal")
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(Theme.muted)
                Spacer()
                Button {
                    editing = true
                } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 26, height: 26)
                }
            }
            if let goal {
                HStack(spacing: 14) {
                    ZStack {
                        Circle().stroke(Theme.surfaceAlt, lineWidth: 6)
                        Circle()
                            .trim(from: 0, to: CGFloat(goal.percentComplete) / 100)
                            .stroke(Theme.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(goal.percentComplete)%")
                            .font(Theme.body(13, .bold))
                            .foregroundStyle(Theme.foreground)
                    }
                    .frame(width: 60, height: 60)

                    VStack(alignment: .leading, spacing: 2) {
                        (Text("\(goal.completedBooks) ").font(Theme.heading(17, .bold)).foregroundStyle(Theme.foreground)
                            + Text("/ \(goal.targetBooks)").font(Theme.body(13)).foregroundStyle(Theme.muted))
                        Text("books read")
                            .font(Theme.body(11))
                            .foregroundStyle(Theme.muted)
                    }
                }
            } else {
                Button {
                    editing = true
                } label: {
                    Text("Set a \(String(year)) reading goal")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                        .padding(.vertical, 14)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Theme.surface, Theme.surfaceAlt], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.accent.opacity(0.20), lineWidth: 1))
    }
}

/// Shared backing for the refreshed goal/streak tiles: a surface with one
/// soft colour bloom in the top-trailing corner and a hairline in that colour.
private struct HomeTileBackground: View {
    let glow: Color
    var body: some View {
        ZStack {
            Theme.surface
            RadialGradient(colors: [glow.opacity(0.30), glow.opacity(0)],
                           center: .topTrailing, startRadius: 0, endRadius: 150)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(glow.opacity(0.28), lineWidth: 1))
    }
}

private struct ReadingStreakCardView: View {
    let streak: ReadingStreak

    var body: some View {
        if DesignPreview.on { bodyV2 } else { bodyV1 }
    }

    // Refreshed tile (2026-11): the flame is the hero, lit in an
    // orange→rose gradient when the streak is alive and dimmed when it is
    // not, with a bar that races the reader's own record. The pieces live in
    // HomeSections.swift so the Stats card is built from the same ones.
    private var bodyV2: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("STREAK")
                    .font(Theme.body(11, .bold)).tracking(0.8)
                    .foregroundStyle(Theme.muted)
                Spacer()
                if let doneToday = streak.activeToday {
                    StreakTodayPill(doneToday: doneToday)
                } else if streak.isAlive && streak.longestStreak > 0 {
                    // An older server that does not say whether today counts.
                    Text("Best \(streak.longestStreak)")
                        .font(Theme.body(11, .semibold))
                        .foregroundStyle(Theme.muted)
                        .frame(height: 22)
                }
            }
            HStack(spacing: 10) {
                StreakFlame(streak: streak)
                    .frame(width: 66, height: 66)

                VStack(alignment: .leading, spacing: 0) {
                    Text("\(streak.currentStreak)")
                        .font(Theme.heading(34, .heavy))
                        .foregroundStyle(Theme.foreground)
                        .contentTransition(.numericText())
                    Text(streak.currentStreak == 1 ? "day in a row" : "days in a row")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                        // One line: "days in / a row" wrapped beside the flame.
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .layoutPriority(1)
            }
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 5) {
                StreakRaceBar(streak: streak)
                Text(streak.footerLine)
                    .font(Theme.body(12, .semibold))
                    .foregroundStyle(Theme.foreground.opacity(0.75))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(HomeTileBackground(glow: streak.isAlive ? StreakStyle.flame : Theme.neonPurple))
    }

    private var bodyV1: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("tbr streak")
                .font(Theme.body(12, .medium))
                .foregroundStyle(Theme.muted)
            HStack(spacing: 10) {
                Text(streak.currentStreak > 0 ? "🔥" : "📚")
                    .font(.system(size: 28))
                VStack(alignment: .leading, spacing: 2) {
                    (Text("\(streak.currentStreak) ").font(Theme.heading(17, .bold)).foregroundStyle(Theme.foreground)
                        + Text(streak.currentStreak == 1 ? "day" : "days").font(Theme.body(13)).foregroundStyle(Theme.muted))
                    Text(streak.currentStreak > 0
                         ? "Best: \(streak.longestStreak) \(streak.longestStreak == 1 ? "day" : "days")"
                         : "Read or log something to start!")
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.muted)
                }
            }
            Text("Any reading activity keeps your streak alive")
                .font(Theme.body(9))
                .foregroundStyle(Theme.muted.opacity(0.6))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Theme.surface, Theme.surfaceAlt], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.neonPurple.opacity(0.20), lineWidth: 1))
    }
}

// ── Up Next grid geometry ──
// Every slot is the same size, so a card's place is pure arithmetic on its
// index — which is what lets the reorder move cards by changing an index.
enum UpNextGrid {
    static let spacing: CGFloat = 12
    /// Tall enough for a four-line title at full size beside the cover (a
    /// longer one shrinks slightly to fit five); follows the reader's
    /// text-size setting like every font in the card.
    static var cardHeight: CGFloat { (126 * Theme.textScale).rounded() }

    static func columnWidth(_ gridWidth: CGFloat) -> CGFloat {
        max(0, (gridWidth - spacing) / 2)
    }

    static func origin(_ index: Int, gridWidth: CGFloat) -> CGPoint {
        CGPoint(x: CGFloat(index % 2) * (columnWidth(gridWidth) + spacing),
                y: CGFloat(index / 2) * (cardHeight + spacing))
    }

    static func height(count: Int) -> CGFloat {
        let rows = CGFloat((count + 1) / 2)
        return rows == 0 ? 0 : rows * cardHeight + (rows - 1) * spacing
    }

    /// The slot under a point, or nil in a gap or past the last card.
    static func slot(containing point: CGPoint, count: Int, gridWidth: CGFloat) -> Int? {
        let size = CGSize(width: columnWidth(gridWidth), height: cardHeight)
        return (0..<count).first { CGRect(origin: origin($0, gridWidth: gridWidth), size: size).contains(point) }
    }

    /// The slot whose centre is closest to a point (always a valid index).
    static func nearestSlot(to point: CGPoint, count: Int, gridWidth: CGFloat) -> Int {
        let half = CGSize(width: columnWidth(gridWidth) / 2, height: cardHeight / 2)
        func distance(_ index: Int) -> CGFloat {
            let o = origin(index, gridWidth: gridWidth)
            return hypot(o.x + half.width - point.x, o.y + half.height - point.y)
        }
        return (0..<count).min { distance($0) < distance($1) } ?? 0
    }
}

/// The card being dragged: which one, where on the card the finger took hold,
/// and where the finger is now (grid coordinates).
struct UpNextLift: Equatable {
    let id: String
    let grab: CGSize
    var finger: CGPoint
    var origin: CGPoint { CGPoint(x: finger.x - grab.width, y: finger.y - grab.height) }
}

/// One long-press recogniser for the whole grid. UIKit's, not SwiftUI's
/// LongPressGesture.sequenced(before: DragGesture): once this one begins, the
/// scroll view's pan is ruled out for that touch, so the page cannot scroll
/// under a card being dragged, while a plain swipe still scrolls because the
/// press fails as soon as the finger travels.
struct ReorderPressGesture: UIGestureRecognizerRepresentable {
    var minimumDuration: TimeInterval
    /// A named coordinate space to report the touch in — for a recogniser on a
    /// drag handle, whose own bounds move with its row. nil reports it in the
    /// view the gesture is attached to.
    var space: String? = nil
    var onChange: @MainActor (UIGestureRecognizer.State, CGPoint) -> Void

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let recognizer = UILongPressGestureRecognizer()
        recognizer.minimumPressDuration = minimumDuration
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        // Never mid-press: changing the duration resets a recogniser in flight.
        guard recognizer.state == .possible,
              recognizer.minimumPressDuration != minimumDuration else { return }
        recognizer.minimumPressDuration = minimumDuration
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        let point = space.map { context.converter.location(in: .named($0)) }
            ?? context.converter.localLocation
        onChange(recognizer.state, point)
    }
}

/// The home-screen jiggle. Driven by the clock rather than a repeating
/// animation, so it keeps going through the springs that slide cards around
/// (a repeatForever rotation was cancelled by the first reorder) and stops
/// costing anything the moment it is switched off.
struct Jiggle: ViewModifier {
    let active: Bool
    /// Any stable string — neighbours get different phases and directions.
    let seed: String

    func body(content: Content) -> some View {
        let hash = seed.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
        let direction: Double = hash.isMultiple(of: 2) ? 1 : -1
        let phase = Double(hash % 7) / 7 * 0.28
        TimelineView(.animation(paused: !active)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate + phase
            content.rotationEffect(.degrees(active ? sin(t * 2 * .pi / 0.28) * 1.6 * direction : 0))
        }
    }
}

// ── Up Next card ──
private struct UpNextCard: View {
    let item: UpNextItem
    let number: Int

    /// Matches formatAudioCompact() in src/components/home/up-next-shelf.tsx —
    /// under an hour reads in minutes, otherwise one decimal of hours.
    static func audioCompact(_ minutes: Int) -> String {
        guard minutes >= 60 else { return "\(minutes)m" }
        let hours = (Double(minutes) / 60 * 10).rounded() / 10
        return hours == hours.rounded()
            ? "\(Int(hours))h"
            : String(format: "%.1fh", hours)
    }

    /// Gives a long word somewhere sensible to wrap. The column fits about
    /// twelve letters, so "Responsibilities" used to be cut wherever the line
    /// ran out ("Responsibiliti / es"). A soft hyphen is invisible unless the
    /// line breaks on it, and then draws as a hyphen; it goes before a
    /// consonant that sits between two vowels, which is where English mostly
    /// splits ("Responsibili-ties"). A slash gets a plain break after it.
    static func breakable(_ title: String) -> String {
        let vowels = Set("aeiouyAEIOUY")
        return title.split(separator: " ", omittingEmptySubsequences: false).map { word -> String in
            let chars = Array(word)
            guard chars.count >= 12 else { return String(word) }
            var out = ""
            for (i, ch) in chars.enumerated() {
                if i >= 4, chars.count - i >= 3, i + 1 < chars.count,
                   ch.isLetter, chars[i - 1].isLetter, chars[i + 1].isLetter,
                   vowels.contains(chars[i - 1]), !vowels.contains(ch), vowels.contains(chars[i + 1]) {
                    out.append("\u{00AD}")
                }
                out.append(ch)
                if ch == "/", i + 1 < chars.count { out.append("\u{200B}") }
            }
            return out
        }.joined(separator: " ")
    }

    // The text column is only ~90pt wide, so the title gets the card's full
    // height: up to five lines, where it used to get two under a 28pt row
    // reserved for a drag handle that no longer exists (Rebekah, 2026-11-16:
    // "lots of book titles there that are very cut off").
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            CoverThumb(url: item.coverImageUrl, width: 56, height: 84, radius: 8, title: item.title)
                .overlay(alignment: .topLeading) {
                    Text("\(number)")
                        .font(Theme.body(12, .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Theme.neonPurple)
                        .clipShape(Circle())
                        .offset(x: -6, y: -6)
                }
                .padding(.leading, 4)

            VStack(alignment: .leading, spacing: 3) {
                if let genre = item.topLevelGenre, !genre.isEmpty {
                    Text(genre.uppercased())
                        .font(Theme.body(9, .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(UpNextCard.breakable(item.title))
                    .font(Theme.body(14, .bold))
                    .foregroundStyle(Theme.foreground)
                    // Up to five lines, shrinking a little before it will
                    // truncate: a 50-character title still reads in full.
                    .lineLimit(5)
                    .minimumScaleFactor(0.82)
                    .multilineTextAlignment(.leading)
                    .accessibilityLabel(item.title)
                // Meta row: pages · audiobook length (mirrors the web Up Next card)
                if item.pages != nil || item.audioLengthMinutes != nil {
                    HStack(spacing: 3) {
                        if let pages = item.pages {
                            Text("\(pages)p")
                        }
                        if item.pages != nil && item.audioLengthMinutes != nil {
                            Text("·")
                        }
                        if let mins = item.audioLengthMinutes {
                            Image(systemName: "headphones")
                                .font(.system(size: 10))
                            Text(UpNextCard.audioCompact(mins))
                        }
                    }
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(
            ZStack {
                Theme.surfaceAlt
                if let cover = item.coverImageUrl, let url = URL(string: cover) {
                    CoverBlurImage(url: url)
                    Theme.scrim
                }
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// ── Hold-and-drag reordering for any layout (shelves, Top Shelf) ──
//
// Up Next can place its cards by index because every slot is the same size.
// The shelf screens can't (rows of three on planks, a lazy grid, list rows of
// different heights), so this version leaves the layout alone:
//   · every cell reports its frame;
//   · the lifted cell stays in the layout as a placeholder, and a copy of it
//     is drawn over the container under the finger;
//   · when the copy's centre enters another cell, the array is reordered and
//     the layout animates the rest.
// It replaces the system drag-and-drop these screens used (.onDrag + a drop
// delegate), which needed its own long-press to lift, drew a system preview
// and dropped the move if the finger was released over a gap.

struct ReorderFramesKey<ID: Hashable>: PreferenceKey {
    static var defaultValue: [ID: Anchor<CGRect>] { [:] }
    static func reduce(value: inout [ID: Anchor<CGRect>], nextValue: () -> [ID: Anchor<CGRect>]) {
        value.merge(nextValue()) { $1 }
    }
}

@MainActor
@Observable
final class ReorderDrag<Item: Identifiable & Equatable> {
    struct Lift {
        let item: Item
        /// Where on the cell the finger took hold.
        let grab: CGSize
        var finger: CGPoint
        let size: CGSize
        /// Set on release: the copy glides here (its slot) before it goes.
        var settleAt: CGPoint?
        var origin: CGPoint {
            settleAt ?? CGPoint(x: finger.x - grab.width, y: finger.y - grab.height)
        }
    }

    var lift: Lift?
    /// Cell frames in the container's space, refreshed on every layout.
    /// Not observed: it is written while the container's overlay renders.
    @ObservationIgnored var frames: [Item.ID: CGRect] = [:]
    @ObservationIgnored private var orderAtLift: [Item.ID] = []
    /// The cell last swapped with. With cells of different heights the copy's
    /// centre can still be inside it after the swap, and would swap straight
    /// back; it is ignored until the centre has left it.
    @ObservationIgnored private var lastSwap: Item.ID?
    @ObservationIgnored private var generation = 0

    func isLifted(_ item: Item) -> Bool { lift?.item.id == item.id }

    /// Feed it the recogniser's state. `picking` names the item when the
    /// gesture sits on that item's own handle; otherwise the item under the
    /// touch is taken. `commit` runs once, on release, if the order changed.
    func press(_ state: UIGestureRecognizer.State, at point: CGPoint, picking picked: Item? = nil,
               items: Binding<[Item]>, commit: () -> Void) {
        switch state {
        case .began:
            let list = items.wrappedValue
            guard let item = picked ?? list.first(where: { frames[$0.id]?.contains(point) == true }),
                  let frame = frames[item.id] else { return }
            generation += 1
            orderAtLift = list.map(\.id)
            lastSwap = nil
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            withAnimation(.easeOut(duration: 0.12)) {
                lift = Lift(item: item,
                            grab: CGSize(width: point.x - frame.minX, height: point.y - frame.minY),
                            finger: point, size: frame.size)
            }
        case .changed:
            guard var current = lift, current.settleAt == nil else { return }
            current.finger = point
            lift = current   // unanimated: the copy stays under the finger
            let centre = CGPoint(x: current.origin.x + current.size.width / 2,
                                 y: current.origin.y + current.size.height / 2)
            let list = items.wrappedValue
            guard let over = list.first(where: {
                $0.id != current.item.id && frames[$0.id]?.contains(centre) == true
            }) else {
                lastSwap = nil
                return
            }
            guard over.id != lastSwap,
                  let from = list.firstIndex(where: { $0.id == current.item.id }),
                  let to = list.firstIndex(where: { $0.id == over.id }) else { return }
            lastSwap = over.id
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                items.wrappedValue.move(fromOffsets: IndexSet(integer: from),
                                        toOffset: to > from ? to + 1 : to)
            }
        case .ended, .cancelled, .failed:
            guard var current = lift, current.settleAt == nil else { return }
            current.settleAt = frames[current.item.id]?.origin ?? current.origin
            withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) { lift = current }
            let mine = generation
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(240))
                if self.generation == mine { self.lift = nil }
            }
            if items.wrappedValue.map(\.id) != orderAtLift { commit() }
        default:
            break
        }
    }
}

extension View {
    /// A cell the reorder can pick up: reports its frame and steps aside
    /// (to `placeholderOpacity`) while its copy is being dragged. Rows whose
    /// drag handle carries the gesture keep a faint placeholder, so the handle
    /// under the finger is never fully hidden mid-gesture.
    func reorderCell<Item: Identifiable & Equatable>(
        _ item: Item, in drag: ReorderDrag<Item>, placeholderOpacity: Double = 0
    ) -> some View {
        self.opacity(drag.isLifted(item) ? placeholderOpacity : 1)
            .anchorPreference(key: ReorderFramesKey<Item.ID>.self, value: .bounds) { [item.id: $0] }
    }

    /// The layout holding the cells: resolves their frames and draws the
    /// lifted copy. `space` names its coordinate space for handle gestures;
    /// a gesture attached straight after this modifier is already in it.
    func reorderContainer<Item: Identifiable & Equatable, Copy: View>(
        _ drag: ReorderDrag<Item>, space: String, @ViewBuilder copy: @escaping (Item) -> Copy
    ) -> some View {
        self.overlayPreferenceValue(ReorderFramesKey<Item.ID>.self) { anchors in
            GeometryReader { proxy in
                let frames = anchors.mapValues { proxy[$0] }
                let _ = (drag.frames = frames)
                if let lift = drag.lift {
                    copy(lift.item)
                        .frame(width: lift.size.width, height: lift.size.height)
                        .scaleEffect(lift.settleAt == nil ? 1.04 : 1)
                        .shadow(color: .black.opacity(lift.settleAt == nil ? 0.45 : 0), radius: 16, y: 9)
                        .offset(x: lift.origin.x, y: lift.origin.y)
                }
            }
            .allowsHitTesting(false)
        }
        .coordinateSpace(.named(space))
    }
}
