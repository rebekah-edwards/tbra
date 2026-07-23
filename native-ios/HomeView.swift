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
        do { home = try await APIClient.shared.home() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load home." }
    }

    /// The heavy sections stream in separately, like the web's Suspense block.
    func loadDiscover() async {
        discover = try? await APIClient.shared.homeDiscover()
    }
}

struct HomeView: View {
    @Binding var path: NavigationPath
    @State private var model = UpNextModel()
    @State private var homeModel = HomeModel()
    @State private var dragging: UpNextItem?
    // iOS-home-screen reorder: 1s long-press enters wiggle mode, cards
    // jiggle and become draggable (whole card), Done exits. No drag handle.
    @State private var wiggleMode = false
    // Oscillation driver: jumps to -amplitude, then animates to +amplitude
    // with repeatForever(autoreverses) so the cards ACTIVELY rock back and
    // forth (a static rotationEffect keyed on wiggleMode only tilted them
    // once). Cells alternate sign by index for the home-screen look.
    @State private var wobble: Double = 0

    private func setWiggle(_ on: Bool) {
        wiggleMode = on
        if on {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { wobble = -1.7 }
            withAnimation(.easeInOut(duration: 0.14).repeatForever(autoreverses: true)) {
                wobble = 1.7
            }
        } else {
            withAnimation(.easeOut(duration: 0.15)) { wobble = 0 }
        }
    }

    /// Exit wiggle mode, clearing any stuck drag ghost and persisting the
    /// final order — the drop's performDrop does the same, but a drop that
    /// ends outside a cell never fires it (that was the "stays grayed out /
    /// didn't save" bug), so Done is the guaranteed commit point.
    private func finishWiggle() {
        setWiggle(false)
        if dragging != nil { dragging = nil }
        model.persistOrder()
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
        }
    }

    @ViewBuilder private func upNextCell(index: Int) -> some View {
        let item = model.items[index]
        // Plain Button + path.append instead of NavigationLink(value:) — on
        // iOS 27 the value-based links in this grid fired the VALUE of the
        // cell one row down (tap/frame/payload logs all proved the tap, the
        // layout and the API data were correct; only the fired value was
        // wrong). A closure capturing `item` can't be misassociated.
        //
        // Reorder = iOS-home-screen pattern (user request 2026-07-11): a 1s
        // long-press enters wiggle mode; only THEN does the whole card carry
        // .onDrag (attaching it permanently hijacked plain taps — the
        // original glitchy-reorder bug). Taps are inert while wiggling.
        //
        // Plain gestures, NOT a Button: on iOS 27 neither
        // simultaneousGesture(LongPressGesture) nor .onLongPressGesture ever
        // fires on a Button in this scroll content (sim-verified), and the
        // button's pressed-state also renders on the wrong card after a
        // scroll. onTapGesture + onLongPressGesture compose correctly.
        let core = UpNextCard(item: item, number: index + 1)
            .contentShape(Rectangle())
            .onTapGesture {
                guard !wiggleMode else { return }
                path.append(BookRoute(idOrSlug: item.slug ?? item.bookId))
            }
            .onLongPressGesture(minimumDuration: 1.0) {
                guard !wiggleMode else { return }
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                setWiggle(true)
            }
            .background(HitFrameReporter(label: "upnext[\(index + 1)] \(item.title.prefix(14))"))
            .opacity(dragging?.id == item.id ? 0.4 : 1)
            .rotationEffect(.degrees(index.isMultiple(of: 2) ? wobble : -wobble))
            .onDrop(of: [.text], delegate: GridReorderDelegate(
                item: item,
                items: $model.items,
                dragging: $dragging,
                commit: { model.persistOrder() }
            ))

        if wiggleMode {
            core.onDrag {
                dragging = item
                return NSItemProvider(object: item.bookId as NSString)
            }
        } else {
            core
        }
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
                    .id("home-\(homeModel.home?.readingNow.isEmpty != false)-\(homeModel.home == nil)-\(homeModel.discover == nil)")
            }
        }
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

    private var homeSections: some View {
            VStack(alignment: .leading, spacing: 28) {
                // ── Reading Now ──
                if let home = homeModel.home, !home.readingNow.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        SectionHeading("Reading Now")
                        VStack(spacing: 12) {
                            ForEach(home.readingNow) { book in
                                ReadingNowCard(
                                    book: book,
                                    openDropdownBookId: $openStateDropdownBookId,
                                    onOpen: { path.append(BookRoute(idOrSlug: book.slug ?? book.id)) }
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

                // ── Goal + streak (mobile order: between Reading Now and Up Next) ──
                if let home = homeModel.home {
                    HStack(alignment: .top, spacing: 12) {
                        ReadingGoalCardView(goal: home.goal, year: home.year) {
                            await homeModel.load()
                        }
                        ReadingStreakCardView(streak: home.streak)
                    }
                }

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

                    // NON-lazy 2-column grid. The one-row-off tap bug turned
                    // out to be TapScaleButtonStyle on the cells (see the
                    // button below), but the grid stays eager on purpose —
                    // the queue is tiny and it removes a whole class of
                    // iOS 27 lazy-container interaction bugs from this
                    // much-churned screen.
                    VStack(spacing: 12) {
                        ForEach(Array(stride(from: 0, to: model.items.count, by: 2)), id: \.self) { rowStart in
                            HStack(alignment: .top, spacing: 12) {
                                upNextCell(index: rowStart)
                                if rowStart + 1 < model.items.count {
                                    upNextCell(index: rowStart + 1)
                                } else {
                                    Color.clear.frame(maxWidth: .infinity)
                                }
                            }
                        }
                    }
                    // Catch-all for drops that end in the grid's gaps or on
                    // the dragged card itself — without this, performDrop
                    // never fires there, so the ghost stayed at 40% opacity
                    // and the new order was never persisted.
                    .onDrop(of: [.text], isTargeted: nil) { _ in
                        guard dragging != nil else { return false }
                        dragging = nil
                        model.persistOrder()
                        return true
                    }

                    if model.items.isEmpty && !model.loading {
                        Text("Nothing queued yet")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 40)
                    } else if !model.items.isEmpty {
                        Text("Hold & drag to reorder")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 2)
                    }
                }

                // ── Pick From Your Shelf ──
                if let home = homeModel.home {
                    VStack(alignment: .leading, spacing: 14) {
                        SectionHeading("Pick From Your Shelf")
                        TbrSuggestionCard(book: home.tbrSuggestion)
                    }
                }

                // ── Deferred sections (web renders these via Suspense) ──
                if let discover = homeModel.discover {
                    ForEach(discover.becauseYouLiked, id: \.seed.id) { section in
                        BecauseYouLikedSection(section: section)
                    }

                    if !discover.friendsActivity.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeading("Friends Activity")
                            FriendsActivityRow(activity: discover.friendsActivity) { item in
                                // Reviews open the review itself; everything
                                // else opens the book page.
                                if item.type == "review", let reviewId = item.reviewId {
                                    path.append(ReviewsRoute(
                                        bookIdOrSlug: item.book.slug ?? item.book.id,
                                        bookTitle: item.book.title,
                                        scrollToReviewId: reviewId))
                                } else {
                                    path.append(BookRoute(idOrSlug: item.book.slug ?? item.book.id))
                                }
                            }
                        }
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
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 40)
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

// ── Reading Now card — currently-reading-section.tsx ──
private struct ReadingNowCard: View {
    let book: ReadingNowBook
    @Binding var openDropdownBookId: String?
    let onOpen: () -> Void
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
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(alignment: .bottomTrailing) { dropdown }

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

    private var cardBody: some View {
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
            .padding(.trailing, 16)
            // Hang the menu just below the Reading BUTTON (not the whole
            // card) — user follow-up 2026-07-11. bottomTrailing puts the
            // menu's bottom at the card's bottom; +88 lands its top ~10pt
            // above the card edge, right under the button (button bottom sits
            // 16pt above the card edge), overlapping only the card padding.
            .offset(y: 88)
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
    @State private var busy = false
    @State private var saved = false
    @State private var errorText: String?

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
                        .foregroundStyle(Theme.accentDark)
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
                                        .foregroundStyle(pageMode == m ? .black : Theme.muted)
                                        .padding(.horizontal, 12).padding(.vertical, 6)
                                        .background(pageMode == m ? Theme.accent : .clear)
                                }
                            }
                        }
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 10))

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
                mood: mood, pace: pace
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
    let onChanged: () async -> Void
    @State private var editing = false

    var body: some View {
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
        .sheet(isPresented: $editing) {
            GoalEditSheet(year: year, current: goal?.targetBooks) { await onChanged() }
                .presentationDetents([.height(260)])
                .presentationBackground(Theme.surface)
        }
    }
}

private struct ReadingStreakCardView: View {
    let streak: ReadingStreak

    var body: some View {
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

// ── Up Next card + reorder delegate (unchanged from the parity pass) ──
private struct UpNextCard: View {
    let item: UpNextItem
    let number: Int

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            CoverThumb(url: item.coverImageUrl, width: 52, height: 78, radius: 8, title: item.title)
                .overlay(alignment: .topLeading) {
                    Text("\(number)")
                        .font(Theme.body(12, .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Theme.neonPurple)
                        .clipShape(Circle())
                        .offset(x: -6, y: -6)
                }
                .padding(.top, 4)
                .padding(.leading, 4)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 4) {
                    Text((item.topLevelGenre ?? " ").uppercased())
                        .font(Theme.body(9, .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .padding(.top, 9)
                    Spacer(minLength: 2)
                    // (reorder handle is drawn by the grid overlay — it owns
                    // the .onDrag so plain taps never start a reorder)
                    Color.clear.frame(width: 28, height: 28)
                }
                Text(item.title)
                    .font(Theme.body(15, .bold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let pages = item.pages {
                    Text("\(pages)p")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
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

// Live-reordering drop delegate shared by the card grids: swaps items as
// the drag passes over them, persists once on drop (the API wants the
// complete final order).
struct GridReorderDelegate<Item: Identifiable & Equatable>: DropDelegate {
    let item: Item
    @Binding var items: [Item]
    @Binding var dragging: Item?
    let commit: () -> Void

    func dropEntered(info: DropInfo) {
        guard let dragging, dragging != item,
              let from = items.firstIndex(of: dragging),
              let to = items.firstIndex(of: item) else { return }
        withAnimation(.easeOut(duration: 0.15)) {
            items.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }

    func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        commit()
        return true
    }
}
