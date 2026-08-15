import SwiftUI

// The book page — recreates /book/[id] per the functional inventory in
// docs/native-parity.md: hero (blur card, pills, series link), the action
// cluster with EVERY dropdown functional (reading-state machine, Up Next,
// Buy w/ affiliate disclosure, Format, Owned, Shelves), stars row, summary
// quote card, and the spoiler-gated What's Inside content profile.
//
// Deferred (tracked in the manifest): edition picker, review wizard,
// reading history, notes, similar books, admin pencil, hide/report.

/// Navigation value used app-wide: any tapped cover routes here.
/// Identity for the post-completion sheet (see `suggestionsFor`).
struct SuggestionsTarget: Identifiable, Hashable {
    let id: String
}

struct BookRoute: Hashable {
    let idOrSlug: String
    /// Set when the user just marked the book Finished/DNF somewhere else
    /// (the home Reading Now card, a search result). Mirrors the web's
    /// `?review=true` hand-off: the book page opens the review wizard, then
    /// the "What to Read Next" sheet.
    var justCompleted: Bool = false
}

/// Blocking overlay while a freshly imported book runs enrichment — mirrors
/// the web book page's fixed z-100 "being added" screen (same copy).
struct EnrichmentWaitOverlay: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.7).ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView()
                    .tint(Theme.accent)
                    .scaleEffect(1.4)
                Text("This book is currently being added to our database. Please wait 10–20 seconds for content details to be added.")
                    .font(Theme.body(16))
                    .foregroundStyle(.white.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
        }
        .transition(.opacity)
    }
}

/// Calm non-blocking notice: enrichment is queued behind the daily API
/// budget — mirrors the web's amber banner copy. Solid amber chip with
/// BLACK text/icon in both modes (user callout 2026-07-25: the translucent
/// version washed out to green-on-green over bright ambient backdrops —
/// black-on-solid is the brand rule for filled chips).
struct EnrichmentQueuedBanner: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "clock")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.black)
                .padding(.top, 2)
            Text("This book is in our enrichment queue — the summary and What's Inside content details will appear within a day. Everything else is ready now.")
                .font(Theme.body(14, .medium))
                .foregroundStyle(.black)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Color(red: 0.99, green: 0.82, blue: 0.33),
                    in: RoundedRectangle(cornerRadius: 14))
    }
}

@MainActor
@Observable
final class BookDetailModel {
    let idOrSlug: String
    var data: BookDetailData?
    var error: String?
    var loading = false
    /// Bumped when a state change on THIS page finishes the book, so the page
    /// can run the post-completion flow (review wizard → what to read next)
    /// the way the web does.
    var completionTick = 0

    init(idOrSlug: String) { self.idOrSlug = idOrSlug }

    func load() async {
        loading = true; defer { loading = false }
        do { data = try await APIClient.shared.bookDetail(idOrSlug) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load this book." }
    }
}

struct BookDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var model: BookDetailModel
    /// Reload attempts while waiting for enrichment (web parity: overlay +
    /// reload loop with a bounded budget, then fall back to the calm notice).
    @State private var enrichPolls = 0
    /// Post-completion flow (web parity — book-page-client.tsx): finishing a
    /// book auto-opens the review wizard, then the "What to Read Next" sheet.
    private let justCompleted: Bool
    @State private var autoOpenReview = false
    /// .sheet(item:) not (isPresented:) — with `if let data = model.data`
    /// inside the builder, a background reload swapped the sheet's content for
    /// a fresh PostCompletionSheet whose .task re-ran and, on the losing race,
    /// dismissed the sheet before the winning response landed.
    @State private var suggestionsFor: SuggestionsTarget?
    @State private var ranCompletionFlow = false
    /// Suggestions wait for the wizard to close: SwiftUI silently drops a
    /// .sheet raised while a .fullScreenCover is up, and never retries it.
    @State private var suggestionsPending = false

    init(idOrSlug: String, justCompleted: Bool = false) {
        _model = State(initialValue: BookDetailModel(idOrSlug: idOrSlug))
        self.justCompleted = justCompleted
    }

    /// Web gating: open the wizard only on a FIRST completion with no existing
    /// review — re-reads and already-reviewed books just get the suggestions.
    private func runCompletionFlow() {
        guard let data = model.data else { return }
        if data.userRating == nil {
            autoOpenReview = true
            suggestionsPending = true      // raised when the wizard closes
            return
        }
        showSuggestionsSoon(data.book.id)
    }

    /// The review wizard closed (saved or cancelled) — now the sheet can show.
    private func reviewWizardClosed() {
        guard suggestionsPending, let id = model.data?.book.id else { return }
        suggestionsPending = false
        showSuggestionsSoon(id)
    }

    /// A beat of air after the cover dismisses — SwiftUI drops a sheet raised
    /// in the same runloop as a fullScreenCover teardown.
    private func showSuggestionsSoon(_ bookId: String) {
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            suggestionsFor = SuggestionsTarget(id: bookId)
        }
    }

    /// Blocking "being added, wait 10–20s" overlay: enrichment is actively
    /// running server-side (fetching the payload auto-triggers it).
    private var showEnrichWait: Bool {
        model.data?.needsEnrichment == true
            && model.data?.enrichmentQueued != true
            && enrichPolls < 9
    }

    /// Calm non-blocking notice: enrichment is stranded behind the spent
    /// daily API budget (or our wait budget ran out) — the nightly retry
    /// lane picks it up after the reset.
    private var showEnrichQueued: Bool {
        model.data?.needsEnrichment == true && !showEnrichWait
    }

    private var isAdmin: Bool {
        if case .signedIn(let user) = auth.phase {
            return ["admin", "super_admin"].contains(user.accountType)
        }
        return false
    }

    var body: some View {
        ScrollViewReader { scrollProxy in
        ScrollView {
            if let data = model.data {
                VStack(alignment: .leading, spacing: 20) {
                    if showEnrichQueued {
                        // zIndex keeps the chip above the ambient/hero blur;
                        // the extra top padding shifts the whole page down so
                        // the shell logo + top-right actions stay visible and
                        // the back chevron only just overlaps the chip's top
                        // (chevron spans 0…40pt; chip top lands at 36pt).
                        EnrichmentQueuedBanner()
                            .zIndex(5)
                            .padding(.top, 36)
                    }
                    BookHero(data: data, onCoverChanged: { await model.load() })
                    BookActionCluster(model: model, data: data)
                    BookStarsRow(data: data,
                                 onReviewSaved: { Task { await model.load() } },
                                 autoOpen: $autoOpenReview,
                                 onWizardClosed: reviewWizardClosed)
                    // Comfort-zone flags — web places the banner between the
                    // action area and the summary on mobile.
                    ContentFlagsBanner(
                        conflicts: data.contentConflicts ?? [],
                        reviewerWarnings: data.reviewerWarnings ?? [],
                        noteWarnings: data.noteWarnings ?? [],
                        onSeeDetails: {
                            // Next runloop: let the button's own layout pass
                            // finish before measuring the scroll target.
                            DispatchQueue.main.async {
                                withAnimation { scrollProxy.scrollTo("whats-inside", anchor: .top) }
                            }
                        }
                    )
                    if let summary = data.book.summary, !summary.isEmpty {
                        SummaryQuoteCard(summary: summary)
                    }
                    // Pre-release notice — same position as the web's banner
                    // (after the mobile summary block).
                    PreReleaseBanner(publicationDate: data.book.publicationDate,
                                     publicationYear: data.book.publicationYear)
                    // About / Details directly under the summary, like the
                    // web (user request 2026-07-15).
                    BookAboutDetailsSection(book: data.book)
                    // Just below the summary block (user request 2026-07-14 —
                    // was buried at the bottom of the page).
                    if isAdmin {
                        AdminEditSection(
                            bookId: data.book.id,
                            genres: data.book.genres,
                            onChanged: { Task { await model.load() } }
                        )
                    }
                    if !data.readingNotes.isEmpty {
                        BookNotesSection(
                            bookId: data.book.id,
                            notes: data.readingNotes,
                            onChanged: { Task { await model.load() } }
                        )
                        .id("notes")
                    }
                    if !data.friendsWhoRead.isEmpty {
                        FriendsWhoReadSection(
                            friends: data.friendsWhoRead,
                            bookIdOrSlug: data.slug ?? data.book.id,
                            bookTitle: data.book.title
                        )
                        .id("friends")
                    }
                    if !data.sessions.isEmpty {
                        ReadingHistorySection(
                            bookId: data.book.id,
                            sessions: data.sessions,
                            onChanged: { Task { await model.load() } }
                        )
                        .id("reading-history")
                    }
                    if let series = data.book.seriesInfo {
                        BookSeriesRail(series: series, currentBookId: data.book.id)
                            .id("series")
                    }
                    if !data.book.ratings.isEmpty {
                        // 1pt scroll marker: scrolling a tiny target to a
                        // fixed viewport point is deterministic; scrolling the
                        // tall section itself lands mid-section (proportional
                        // anchors) and cuts the heading off above the ring.
                        Color.clear.frame(height: 1).id("whats-inside-top")
                        WhatsInsideSection(
                            ratings: data.book.ratings,
                            bookId: data.book.id,
                            isAdmin: isAdmin,
                            onChanged: { Task { await model.load() } }
                        )
                        .id("whats-inside")
                        .coachAnchor("whats-inside")
                    }
                    BookFooterActions(
                        bookId: data.book.id,
                        bookTitle: data.book.title,
                        isHidden: data.isHidden,
                        onChanged: { Task { await model.load() } }
                    )
                    .id("tour-report")
                    SimilarBooksSection(bookId: data.book.id)
                        .id("similar")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            } else if model.loading {
                // Loading state — the floating overlay supplies the back
                // affordance in every state.
                ProgressView().tint(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 120)
            }
        }
        .background(AmbientBackground())
        .tracksScrollAtTop()
        // Floating back button, OUTSIDE the scroll content on purpose: the
        // scroll layer's top strip stops hit-testing on repeat pushes
        // (iOS 27) — a screen-level overlay is tried first and always works.
        // topPadding 0 puts the chevron's lower HALF over the hero card
        // (card top = 20; chevron spans 0…40 → 20pt over the card) while
        // keeping clear air below the logo pill.
        .floatingBack(topPadding: 0)
        .overlay {
            if showEnrichWait {
                EnrichmentWaitOverlay()
            }
        }
        .reportsPage("/book/\(model.idOrSlug)")
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load()
            #if DEBUG && targetEnvironment(simulator)
            if let anchor = ProcessInfo.processInfo.environment["TBRA_DEBUG_SCROLL_TO"] {
                try? await Task.sleep(for: .seconds(1))
                withAnimation { scrollProxy.scrollTo(anchor, anchor: .top) }
            }
            #endif
            // Unenriched book: the payload fetch auto-triggered enrichment
            // server-side; poll until the ratings land (web parity — overlay
            // + reload loop, ~45s budget, then the calm queued notice).
            while model.data?.needsEnrichment == true,
                  model.data?.enrichmentQueued != true,
                  enrichPolls < 9,
                  !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                enrichPolls += 1
                await model.load()
            }
        }
        .refreshable { await model.load() }
        // Post-completion flow. Two entry points, same handler: finishing the
        // book right here (completionTick), or arriving from a Finished tap
        // elsewhere (justCompleted, the web's ?review=true hand-off).
        .onChange(of: model.completionTick) { _, _ in runCompletionFlow() }
        .onChange(of: model.data?.book.id) { _, id in
            guard justCompleted, id != nil, !ranCompletionFlow else { return }
            ranCompletionFlow = true
            runCompletionFlow()
        }
        .sheet(item: $suggestionsFor) { target in
            PostCompletionSheet(bookId: target.id)
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.surface)
        }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        #if DEBUG && targetEnvironment(simulator)
        .sheet(isPresented: $debugEditionsOpen) {
            if let data = model.data {
                EditionPickerSheet(
                    bookId: data.book.id,
                    format: ProcessInfo.processInfo.environment["TBRA_DEBUG_EDITIONS"] ?? "hardcover",
                    onChanged: {}
                )
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
            }
        }
        .task {
            if ProcessInfo.processInfo.environment["TBRA_DEBUG_EDITIONS"] != nil {
                try? await Task.sleep(for: .seconds(2.5))
                debugEditionsOpen = true
            }
        }
        #endif
        // First-book guided tour: content details, then reporting. Waits for
        // ratings to exist so the What's Inside anchor is actually on screen.
        .guidedTour("book-r3", steps: [
            CoachStep(id: "whats-inside", title: "What's Inside",
                      text: "Every book's content profile lives here — category-by-category ratings for violence, language, sexual content, and more, so you know exactly what you're picking up."),
            CoachStep(id: "tour-report", title: "See something off?",
                      text: "tbr*a is new — if a cover, rating, or detail looks wrong, tap Report an issue and we'll fix it fast."),
        ], onStep: { step in
            // Deferred + repeated: a scrollTo in the same transaction as the
            // overlay's state change silently no-ops (ScrollViewReader race),
            // and late image loads can shift layout after the first scroll.
            let scrollId = step.id == "tour-report" ? "tour-report" : "whats-inside-top"
            for delay in [0.25, 0.85] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    withAnimation {
                        scrollProxy.scrollTo(scrollId, anchor: step.id == "whats-inside"
                            ? UnitPoint(x: 0.5, y: 0.15)
                            : UnitPoint(x: 0.5, y: 0.62))
                    }
                }
            }
        })
        }
    }

    #if DEBUG && targetEnvironment(simulator)
    @State private var debugEditionsOpen = false
    #endif
}

// ── TBR note editor — tbr-note-editor.tsx (premium "note to self") ──
struct TbrNoteEditorSheet: View {
    let bookId: String
    let existing: String?
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var saving = false
    @State private var errorText: String?

    init(bookId: String, existing: String?, onSaved: @escaping () -> Void) {
        self.bookId = bookId
        self.existing = existing
        self.onSaved = onSaved
        _text = State(initialValue: existing ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Note to self")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
            Text("Why did you add this to your TBR? (only you see this)")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)

            TextEditor(text: $text)
                .scrollContentBackground(.hidden)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground)
                .frame(minHeight: 110)
                .padding(10)
                .background(Theme.surfaceAlt.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                .onChange(of: text) {
                    if text.count > 500 { text = String(text.prefix(500)) }
                }
            Text("\(text.count)/500")
                .font(Theme.body(11))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .trailing)

            if let errorText {
                Text(errorText)
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(Theme.destructive)
            }

            Button {
                saving = true
                Task {
                    struct Body: Codable, Sendable { let note: String }
                    struct Ok: Codable { let ok: Bool }
                    do {
                        let _: Ok = try await APIClient.shared.request(
                            "/api/v1/books/\(bookId)/tbr-note", method: "PUT", json: Body(note: text))
                        onSaved(); dismiss()
                    } catch {
                        errorText = (error as? APIError)?.errorDescription ?? "Couldn't save the note."
                    }
                    saving = false
                }
            } label: {
                if saving { ProgressView().tint(.black) } else { Text("Save note") }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || saving)

            if existing?.isEmpty == false {
                Button("Delete note") {
                    Task {
                        struct Ok: Codable { let ok: Bool }
                        let _: Ok? = try? await APIClient.shared.request("/api/v1/books/\(bookId)/tbr-note", method: "DELETE")
                        onSaved(); dismiss()
                    }
                }
                .font(Theme.body(13, .medium))
                .foregroundStyle(Theme.destructive)
                .frame(maxWidth: .infinity)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.surface)
    }
}

// ── Hero — book-header.tsx ──
private struct BookHero: View {
    let data: BookDetailData
    /// Reload the book after the admin cover picker closes.
    var onCoverChanged: () async -> Void = {}
    @Environment(\.colorScheme) private var colorScheme
    @Environment(AuthStore.self) private var auth
    @State private var coverEditorOpen = false

    private var book: BookFull { data.book }
    private var isLight: Bool { colorScheme == .light }

    /// Admin pencil gate — same accounts the web shows the pencil to.
    private var isAdmin: Bool {
        if case .signedIn(let user) = auth.phase {
            return ["admin", "super_admin"].contains(user.accountType)
        }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // No back-button row: the floating back chevron (screen-level
            // overlay, see BookDetailView.body) straddles the card's top
            // edge instead — mobile-site style — so the card sits high.
            // The 20pt top padding leaves room for the half-overlapping
            // genre/age pills (-12) and the chevron's lower third.
            heroCard
                .padding(.top, 20)
                .padding(.bottom, 20)
        }
        // Page-level hero bleed (.book-hero-img): the big soft color wash
        // behind everything is what gives the page its vibrance.
        .background(alignment: .top) { heroBleed }
    }

    private var heroCard: some View {
        // Square hero ONLY when the server says the user's formats select the
        // audiobook AND a real square image exists (usesAudiobookCover) — a
        // format choice alone must never square-crop the regular 2:3 cover.
        let squareAudio = data.usesAudiobookCover == true
        // effectiveCoverUrl carries the web book page's full cascade
        // (audiobook square → owned-edition cover → canonical).
        let heroCover = squareAudio
            ? (book.audiobookCoverUrl ?? book.coverImageUrl)
            : (data.effectiveCoverUrl ?? book.coverImageUrl)
        return HStack(alignment: .center, spacing: 16) {   // web: items-center
            CoverThumb(url: heroCover, width: 110, height: squareAudio ? 110 : 165, radius: 10, title: book.title)
                .shadow(color: .black.opacity(0.5), radius: 12, y: 6)
                // Admin-only cover pencil (web: -top-1.5 -right-1.5 circle).
                // Opens the NATIVE cover picker (user request 2026-07-13 —
                // no more webview): OL edition covers, ISBNdb/Google
                // candidates, custom URL, photo upload, audiobook square.
                .overlay(alignment: .topTrailing) {
                    if isAdmin {
                        Button {
                            coverEditorOpen = true
                        } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 24, height: 24)
                                .background(Theme.surface, in: Circle())
                                .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                        }
                        .offset(x: 8, y: -8)
                    }
                }
                .sheet(isPresented: $coverEditorOpen, onDismiss: {
                    Task { await onCoverChanged() }
                }) {
                    CoverPickerSheet(bookId: book.id, bookTitle: book.title)
                }

            VStack(alignment: .leading, spacing: 6) {
                Text(book.title)
                    .font(Theme.body(22, .bold))
                    .foregroundStyle(heroText)
                NavigationLink(value: AuthorRoute(idOrSlug: book.authors.first.map { $0.slug ?? $0.id } ?? "")) {
                    Text(book.authors.map(\.name).joined(separator: ", "))
                        .font(Theme.body(15))
                        .foregroundStyle(heroText.opacity(0.85))
                        .underline()
                        .multilineTextAlignment(.leading)
                }
                .disabled(book.authors.isEmpty)
                if let series = book.seriesInfo, let pos = book.seriesPosition {
                    NavigationLink(value: SeriesRoute(slug: series.slug ?? series.id)) {
                        HStack(spacing: 3) {
                            Text("#\(SeriesPos.label(pos)) in \(series.name)")
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                        }
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.neonBlue)
                    }
                }
                HStack(spacing: 6) {
                    if let year = book.publicationYear { Text(String(year)) }
                    // Audio length ONLY when the user's effective format is
                    // the audiobook (web showAudioLength: active formats while
                    // reading, owned otherwise, single 'audiobook'). Everyone
                    // else sees the page count.
                    let activeF = data.userState?.activeFormats ?? []
                    let ownedF = data.userState?.ownedFormats ?? []
                    let isReading = data.userState?.state == "currently_reading"
                        || data.userState?.state == "paused"
                    let effective = (isReading && !activeF.isEmpty) ? activeF : ownedF
                    if effective == ["audiobook"], let mins = book.audioLengthMinutes {
                        Text("·")
                        Label("\(mins / 60)h \(mins % 60)m", systemImage: "headphones")
                    } else if let pages = book.pages {
                        Text("·")
                        Text("\(pages) pages")
                    }
                }
                .font(Theme.body(14))
                .foregroundStyle(heroText.opacity(0.8))

                // Genre pills
                FlowPills(items: Array(book.genres.prefix(5)))

                if let pacing = book.pacing {
                    // Web pacing pills: slow red / medium amber / fast green,
                    // darker text + more opaque bg in light mode.
                    let (textColor, bgColor): (Color, Color) = {
                        switch pacing {
                        case "slow":
                            return (isLight ? Color(hex: "dc2626") : Color(hex: "f87171"),
                                    Color(hex: "ef4444"))
                        case "fast":
                            return (isLight ? Color(hex: "15803d") : Theme.accent,
                                    isLight ? Color(hex: "22c55e") : Theme.accent)
                        default:
                            return (isLight ? Color(hex: "d97706") : Color(hex: "fbbf24"),
                                    Color(hex: "f59e0b"))
                        }
                    }()
                    HStack(spacing: 5) {
                        Image(systemName: "clock")
                            .font(.system(size: 11))
                        Text("\(pacing.capitalized)-paced")
                            .font(Theme.body(12, .semibold))
                    }
                    .foregroundStyle(textColor)
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .background(bgColor.opacity(isLight ? 0.22 : 0.14), in: Capsule())
                    .overlay(Capsule().stroke(bgColor.opacity(0.4), lineWidth: 1))
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        // Genre + age pills: half-overlapping top-right (-top-3 right-4)
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 6) {
                if let genre = book.topLevelGenre {
                    Text(genre)
                        .font(Theme.body(13, .semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .background(Theme.accent, in: Capsule())
                        .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
                }
                if let age = book.ageCategory {
                    Text(age)
                        .font(Theme.body(13, .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .background(Color(hex: "7c3aed"), in: Capsule())
                        .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
                }
            }
            .padding(.trailing, 16)
            .offset(y: -12)
        }
        // Share: half-overlapping bottom-left (bottom-0 left-4 + ty-1/2)
        .overlay(alignment: .bottomLeading) {
            if let slug = data.slug ?? book.slug {
                ShareLink(item: URL(string: "https://thebasedreader.app/book/\(slug)")!) {
                    // Same chromeCircle treatment as the floating back
                    // chevron — the two circles must match (user request).
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.foreground.opacity(0.9))
                        .chromeCircle()
                }
                .padding(.leading, 16)
                .offset(y: 20)
            }
        }
    }

    /// Hero text: white over the dark scrim, near-black over the frosted
    /// white card in light mode (web .book-header-overlay flips too).
    private var heroText: Color { isLight ? Color(hex: "18181b") : .white }

    /// Card inner background — .book-card-bg-img exactly:
    /// dark: opacity .4, blur 16, saturate 1.5 + black-30% overlay
    /// light: opacity .5, blur 16, saturate 2.5, brightness 1.4,
    ///        mix-blend-mode screen + white-52% frosted overlay
    private var cardBackground: some View {
        ZStack {
            // Light: translucent white so the hero bleed's color glows
            // through the card (the CSS screen-blend effect, achieved by
            // layering instead of blending).
            isLight ? Color.white.opacity(0.55) : Theme.surfaceAlt.opacity(1)
            if let cover = data.effectiveCoverUrl ?? book.coverImageUrl, let url = URL(string: cover) {
                CoverBlurImage(url: url)
                (isLight ? Color.white.opacity(0.38) : Color.black.opacity(0.30))
            }
        }
    }

    /// Page-level bleed — .book-hero-img exactly:
    /// dark: opacity .6, saturate 1.5, brightness 1.1, blur 64, scale 1.5
    /// light: opacity .9, blur 64, saturate 2.5, brightness 1.6, screen
    @ViewBuilder private var heroBleed: some View {
        // The bleed follows the DISPLAY cover (edition/audiobook override),
        // not the canonical one — so a red edition cover gets a red wash
        // (user request 2026-07-14, Between Two Fires).
        if let cover = data.effectiveCoverUrl ?? book.coverImageUrl, let url = URL(string: cover) {
            AsyncImage(url: url) { image in
                Group {
                    if isLight {
                        image.resizable().aspectRatio(contentMode: .fill)
                            .scaleEffect(1.5)
                            .blur(radius: 64)
                            .saturation(2.5)
                            .brightness(0.3)
                            .opacity(0.9)
                            .blendMode(.screen)
                    } else {
                        image.resizable().aspectRatio(contentMode: .fill)
                            .scaleEffect(1.5)
                            .blur(radius: 64)
                            .saturation(1.5)
                            .brightness(0.05)
                            .opacity(0.6)
                    }
                }
                .frame(height: 460)
                .clipped()
                .mask(
                    LinearGradient(stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: 0.62),
                        .init(color: .clear, location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                )
                .allowsHitTesting(false)
            } placeholder: { Color.clear }
            .padding(.horizontal, -20)
            // -140 puts the bleed's top edge OFF-SCREEN (behind the status
            // bar) — at -60 it stopped just below it as a visible hard line
            // (user report 2026-07-14).
            .padding(.top, -140)
        }
    }
}

/// Wrapping pill row for genres.
private struct FlowPills: View {
    let items: [String]
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        // Genre pills over the hero card — dark: translucent white on the
        // scrim; light: surface-alt w/ border on the frosted white card
        // (fixed white-on-white was invisible in light mode).
        FlowLayout(spacing: 6) {
            ForEach(items, id: \.self) { g in
                Text(g)
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(colorScheme == .light ? Color(hex: "18181b").opacity(0.85) : .white.opacity(0.9))
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .background(colorScheme == .light ? Color.black.opacity(0.05) : Color.white.opacity(0.12), in: Capsule())
                    .overlay(Capsule().stroke(colorScheme == .light ? Color.black.opacity(0.10) : .clear, lineWidth: 1))
            }
        }
    }
}

/// Minimal flow layout (iOS 16+ Layout protocol).
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
        return CGSize(width: width, height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            sub.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
    }
}

// ── Action cluster — reading-state-selector.tsx + all dropdowns ──
private struct BookActionCluster: View {
    let model: BookDetailModel
    let data: BookDetailData

    @State private var stateDropdownOpen = false
    @State private var showDatePicker = false
    @State private var pendingCompleteState = "completed"
    @State private var showRemoveConfirm = false
    @State private var showTbrNoteEditor = false
    @State private var createdBuddyReadSlug: String?
    @State private var confirmBuddyRead = false
    @State private var buddyReadError: String?
    @State private var showBuyDialog = false
    @State private var showFormatSheet = false
    @State private var showOwnedSheet = false
    @State private var showShelvesSheet = false
    @State private var busy = false

    private var book: BookFull { data.book }
    private var currentState: String? { data.userState?.state }
    private var stateLabel: String {
        switch currentState {
        case "tbr": return "To Read"
        case "currently_reading": return "Reading Now"
        case "completed": return "Finished"
        case "paused": return "Paused"
        case "dnf": return "DNF"
        default: return "To Read"
        }
    }
    private var isActive: Bool { currentState != nil }
    private var showUpNext: Bool { currentState == "tbr" }
    private var showFormat: Bool { currentState == "currently_reading" || currentState == "paused" }

    private let states: [(String, String)] = [
        ("tbr", "To Read"), ("currently_reading", "Reading Now"),
        ("completed", "Finished"), ("paused", "Paused"), ("dnf", "DNF"),
    ]

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                if showUpNext { upNextButton }
                readingStateButton
                buyButton
            }
            HStack(spacing: 10) {
                if showFormat { formatButton }
                ownedButton
                shelvesButton
            }
        }
        .opacity(busy ? 0.6 : 1)
        // Oversized invisible catcher UNDER the menu: tapping any blank part
        // of the page closes the dropdown (user request 2026-07-14). Sits in
        // a LOWER overlay than the menu so menu taps still win.
        .overlay {
            if stateDropdownOpen {
                Color.clear
                    .contentShape(Rectangle())
                    .frame(width: 3000, height: 3000)
                    .onTapGesture {
                        withAnimation(.easeOut(duration: 0.15)) { stateDropdownOpen = false }
                    }
            }
        }
        .overlay(alignment: .top) { dropdown }
        .zIndex(stateDropdownOpen ? 50 : 0)
        .sheet(isPresented: $showDatePicker) {
            CompletionDateSheet(
                title: pendingCompleteState == "dnf" ? "When did you stop reading?" : "When did you finish?"
            ) { date, precision in
                Task { await setState(pendingCompleteState, completionDate: date, precision: precision) }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
        .sheet(isPresented: $showFormatSheet) {
            FormatSheet(title: "How are you reading it?",
                        selected: data.userState?.activeFormats ?? []) { formats in
                Task {
                    try? await APIClient.shared.setFormats(bookId: book.id, active: formats)
                    await model.load()
                }
            }
            .presentationDetents([.height(340)])
            .presentationBackground(Theme.surface)
        }
        .sheet(isPresented: $showOwnedSheet) {
            FormatSheet(title: "Formats you own",
                        selected: data.userState?.ownedFormats.filter { $0 != "unknown" } ?? [],
                        editionBookId: book.id,
                        onEditionsChanged: { Task { await model.load() } }) { formats in
                Task {
                    try? await APIClient.shared.setFormats(bookId: book.id, owned: formats)
                    await model.load()
                }
            }
            .presentationDetents([.height(420), .large])
            .presentationBackground(Theme.surface)
        }
        .sheet(isPresented: $showShelvesSheet) {
            ShelvesPickerSheet(bookId: book.id,
                               isFavorited: data.isFavorited,
                               shelves: data.userShelves,
                               memberIds: Set(data.bookShelfIds)) {
                await model.load()
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
        .fullScreenCover(isPresented: Binding(
            get: { createdBuddyReadSlug != nil },
            set: { if !$0 { createdBuddyReadSlug = nil } }
        )) {
            NavigationStack {
                BuddyReadDetailView(slug: createdBuddyReadSlug ?? "")
                    .appDestinations()
            }
            // Covers have no shell bars — without these the back chevron
            // inherits scrolled chrome state and slides out of reach (the
            // AllReviews bug; user hit it again here 2026-07-14).
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
            .globalReportOverlay()
        }
        .sheet(isPresented: $showTbrNoteEditor) {
            TbrNoteEditorSheet(bookId: book.id, existing: data.tbrNote) {
                Task { await model.load() }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
        .confirmationDialog("Start a buddy read?", isPresented: $confirmBuddyRead, titleVisibility: .visible) {
            Button("Start Buddy Read") {
                Task {
                    struct Body: Codable, Sendable { let bookId: String }
                    struct Ok: Codable { let ok: Bool; let slug: String? }
                    do {
                        let res: Ok = try await APIClient.shared.request(
                            "/api/v1/buddy-reads", method: "POST", json: Body(bookId: book.id))
                        if let slug = res.slug { createdBuddyReadSlug = slug }
                    } catch {
                        // 403 = free tier — surface the premium message.
                        buddyReadError = (error as? APIError)?.errorDescription ?? "Couldn't start the buddy read."
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll get an invite code to read \u{201C}\(book.title)\u{201D} together with friends.")
        }
        .alert("Buddy Reads", isPresented: Binding(
            get: { buddyReadError != nil },
            set: { if !$0 { buddyReadError = nil } }
        )) {
            Button("OK") { buddyReadError = nil }
        } message: { Text(buddyReadError ?? "") }
        .confirmationDialog("Remove from Library?", isPresented: $showRemoveConfirm, titleVisibility: .visible) {
            Button("Remove Everything", role: .destructive) {
                Task {
                    busy = true; defer { busy = false }
                    try? await APIClient.shared.removeFromLibrary(bookId: book.id)
                    await model.load()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will clear your reading history, review, and rating for this book. This cannot be undone.")
        }
        .sheet(isPresented: $showBuyDialog) { buyDisclosureSheet }
    }

    // Reading-state split button (lime; translucent when inactive)
    private var readingStateButton: some View {
        HStack(spacing: 0) {
            Button {
                Task { await mainTap() }
            } label: {
                HStack(spacing: 6) {
                    if !isActive { Image(systemName: "bookmark").font(.system(size: 14, weight: .semibold)) }
                    Text(stateLabel)
                        .font(Theme.body(16, .semibold))
                }
                .foregroundStyle(isActive ? .black : Theme.foreground)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
            }
            Rectangle()
                .fill(isActive ? .black.opacity(0.2) : Theme.accent.opacity(0.4))
                .frame(width: 1.5, height: 30)
            Button {
                withAnimation(.easeOut(duration: 0.15)) { stateDropdownOpen.toggle() }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(isActive ? .black : Theme.foreground)
                    .frame(width: 48, height: 52)
            }
        }
        .background(isActive ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.accent.opacity(0.2)))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.accent.opacity(isActive ? 1 : 0.6), lineWidth: 2))
        .shadow(color: Theme.accent.opacity(isActive ? 0.25 : 0), radius: 10)
    }

    // The dropdown, anchored under the button row (web: absolute, z-50)
    @ViewBuilder private var dropdown: some View {
        if stateDropdownOpen {
            VStack(spacing: 0) {
                ForEach(states, id: \.0) { value, label in
                    Button {
                        stateDropdownOpen = false
                        Task { await selectState(value) }
                    } label: {
                        HStack {
                            Text(label)
                                .font(Theme.body(14, .medium))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                            if currentState == value {
                                Text("✓").foregroundStyle(Theme.accentText)
                            }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .background(currentState == value ? Theme.accent.opacity(0.15) : .clear)
                    }
                    Divider().background(Theme.border.opacity(0.5))
                }
                // TBR note (premium) — web embeds TbrNoteEditor when state = tbr
                if currentState == "tbr" {
                    Button {
                        stateDropdownOpen = false
                        showTbrNoteEditor = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "note.text").font(.system(size: 13))
                            Text(data.tbrNote?.isEmpty == false ? "Edit note to self" : "Add note to self")
                                .font(Theme.body(14, .medium))
                            Spacer()
                        }
                        .foregroundStyle(Theme.foreground)
                        .padding(.horizontal, 18).padding(.vertical, 11)
                    }
                    Divider().background(Theme.border.opacity(0.5))
                }
                // Buddy Read → confirm, then create + open the detail screen
                // (was creating instantly on tap — surprising side effect).
                Button {
                    stateDropdownOpen = false
                    confirmBuddyRead = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.2").font(.system(size: 13))
                        Text("Buddy Read").font(Theme.body(14, .medium))
                        Spacer()
                    }
                    .foregroundStyle(Theme.foreground)
                    .padding(.horizontal, 18).padding(.vertical, 11)
                }
                if isActive {
                    Divider().background(Theme.border.opacity(0.5))
                    Button {
                        stateDropdownOpen = false
                        showRemoveConfirm = true
                    } label: {
                        Text("Remove from Library")
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(Theme.destructive)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 18).padding(.vertical, 11)
                    }
                }
            }
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 16, y: 6)
            .offset(y: 60)
        }
    }

    private var upNextButton: some View {
        Button {
            Task {
                busy = true; defer { busy = false }
                if let pos = data.upNextPosition {
                    _ = pos
                    try? await APIClient.shared.removeFromUpNext(bookId: book.id)
                } else if data.upNextCount < 6 {
                    try? await APIClient.shared.addToUpNext(bookId: book.id)
                }
                await model.load()
            }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: data.upNextPosition != nil ? "text.badge.checkmark" : "text.badge.plus")
                    .font(.system(size: 16))
                // Web labels: "Add to Up Next" / "Up Next #N — tap to remove"
                Text(data.upNextPosition.map { "Up Next #\($0)" } ?? "Up Next")
                    .font(Theme.body(9, .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            // accentText, not accent: lime label on the light background was
            // unreadable once the button was selected (punch list #9).
            .foregroundStyle(data.upNextPosition != nil ? Theme.accentText : Theme.muted)
            .frame(width: 52, height: 52)
            .background(RoundedRectangle(cornerRadius: 14).stroke(
                data.upNextPosition != nil ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: 2))
        }
        .disabled(data.upNextPosition == nil && data.upNextCount >= 6)
        .opacity(data.upNextPosition == nil && data.upNextCount >= 6 ? 0.4 : 1)
    }

    // Buy — affiliate link + disclosure interstitial (Amazon compliance)
    private var amazonURL: URL? {
        let tag = "tbra08-20" // TODO env-driven before store build (NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG)
        if let asin = book.asin { return URL(string: "https://www.amazon.com/dp/\(asin)?tag=\(tag)") }
        if let isbn = book.isbn13 { return URL(string: "https://www.amazon.com/s?k=\(isbn)&tag=\(tag)") }
        let q = book.title.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? book.title
        return URL(string: "https://www.amazon.com/s?k=\(q)&tag=\(tag)")
    }

    private var buyButton: some View {
        Button {
            showBuyDialog = true
        } label: {
            VStack(spacing: 2) {
                Image(systemName: "bag").font(.system(size: 16))
                Text("Buy").font(Theme.body(10))
            }
            .foregroundStyle(Theme.muted)
            .frame(width: 52, height: 52)
            .background(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 2))
        }
    }

    private var buyDisclosureSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Heads up")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)
            Text("This opens Amazon. As an Amazon Associate, tbr*a earns from qualifying purchases — at no extra cost to you.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
            Button("Continue to Amazon") {
                showBuyDialog = false
                if let url = amazonURL { UIApplication.shared.open(url) }
            }
            .buttonStyle(AccentButtonStyle())
            Button("Cancel") { showBuyDialog = false }
                .font(Theme.body(13, .medium))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
        }
        .padding(20)
        .presentationDetents([.height(240)])
        .presentationBackground(Theme.surface)
    }

    private var formatButton: some View {
        // Icon follows the web's leadFormatIcon — a hardcover read gets the
        // closed book, not headphones (user report 2026-07-14).
        clusterPill(icon: FormatIcon.lead(active: data.userState?.activeFormats ?? [],
                                          owned: data.userState?.ownedFormats ?? []),
                    label: (data.userState?.activeFormats.first).map(formatLabel) ?? "Format",
                    tint: Theme.neonBlue,
                    solid: !(data.userState?.activeFormats.isEmpty ?? true)) {
            showFormatSheet = true
        }
    }

    private var ownedButton: some View {
        // Web owned-button.tsx: SOLID purple + white once owned.
        let owned = data.userState?.ownedFormats.filter { $0 != "unknown" } ?? []
        return clusterPill(icon: "books.vertical",
                           label: owned.isEmpty ? "Owned" : "Owned · \(owned.count)",
                           tint: Theme.neonPurple, solid: !owned.isEmpty) {
            showOwnedSheet = true
        }
    }

    private var shelvesButton: some View {
        // Web add-to-shelf-button.tsx: SOLID blue once on any shelf.
        clusterPill(icon: "star",
                    label: data.bookShelfIds.isEmpty ? "Shelves" : "Shelves · \(data.bookShelfIds.count)",
                    tint: Theme.neonBlue, solid: !data.bookShelfIds.isEmpty) {
            showShelvesSheet = true
        }
    }

    private func clusterPill(icon: String, label: String, tint: Color, solid: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13))
                Text(label).font(Theme.body(14, .semibold)).lineLimit(1)
            }
            // Black text is a LIME-only rule; every other solid fill (the
            // blue Format pill etc.) takes white, like the web.
            .foregroundStyle(solid ? .white : tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(solid ? AnyShapeStyle(tint) : AnyShapeStyle(tint.opacity(0.08)))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(solid ? 1 : 0.35), lineWidth: 2))
            // Web gives active pills a soft same-hue glow.
            .shadow(color: tint.opacity(solid ? 0.3 : 0), radius: 8)
        }
    }

    private func formatLabel(_ f: String) -> String {
        ["hardcover": "Hardcover", "paperback": "Paperback", "ebook": "eBook", "audiobook": "Audio", "set": "Box Set"][f] ?? f
    }

    // ── State machine actions (byte-equivalent to the web flows) ──
    private func mainTap() async {
        busy = true; defer { busy = false }
        if isActive {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: book.id, state: "none")
            }
        } else {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: book.id, state: "tbr")
            }
        }
        await model.load()
    }

    private func selectState(_ state: String) async {
        // Finished/DNF intercept → date picker first (unless already that state)
        if (state == "completed" || state == "dnf") && currentState != state {
            pendingCompleteState = state
            showDatePicker = true
            return
        }
        // Starting a read always asks HOW you're reading it. The server
        // guesses from owned formats, which is a fine default but wrong for
        // anyone reading two formats at once or a format they don't own
        // (punch list #8).
        let startingRead = state == "currently_reading" && currentState != state
        busy = true; defer { busy = false }
        if currentState == state {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: book.id, state: "none")
            }
        } else {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: book.id, state: state)
            }
        }
        await model.load()
        // After the reload, so the sheet opens pre-filled with the guess.
        if startingRead { showFormatSheet = true }
    }

    private func setState(_ state: String, completionDate: String?, precision: String? = nil) async {
        busy = true; defer { busy = false }
        await ReadingStateAlert.shared.perform {
            try await APIClient.shared.setReadingState(
            bookId: book.id, state: state,
            completionDate: completionDate,
            completionPrecision: precision
            )
        }
        await model.load()
        if state == "completed" || state == "dnf" { model.completionTick += 1 }
    }
}

// ── Format / Owned multi-select sheet ──
private struct FormatSheet: View {
    let title: String
    @State var selected: [String]
    /// When set (the Owned flow), each selected format row gains a
    /// "choose edition" entry opening the OL edition picker.
    var editionBookId: String? = nil
    var onEditionsChanged: () -> Void = {}
    let onSave: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var editionFormat: String?

    private let formats = [("hardcover", "Hardcover"), ("paperback", "Paperback"), ("ebook", "eBook"), ("audiobook", "Audiobook")]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)
            ForEach(formats, id: \.0) { value, label in
                HStack(spacing: 0) {
                    Button {
                        if selected.contains(value) { selected.removeAll { $0 == value } }
                        else { selected.append(value) }
                    } label: {
                        HStack {
                            Image(systemName: selected.contains(value) ? "checkmark.square.fill" : "square")
                                .foregroundStyle(selected.contains(value) ? Theme.accent : Theme.muted)
                            Text(label)
                                .font(Theme.body(15))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                        }
                        .padding(.vertical, 6)
                    }
                    if editionBookId != nil && selected.contains(value) {
                        Button {
                            editionFormat = value
                        } label: {
                            HStack(spacing: 3) {
                                Text("edition")
                                    .font(Theme.body(12, .medium))
                                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                            }
                            .foregroundStyle(Theme.neonBlue)
                        }
                    }
                }
            }
            Button("Save") {
                onSave(selected)
                dismiss()
            }
            .buttonStyle(AccentButtonStyle())
        }
        .padding(20)
        .sheet(isPresented: Binding(
            get: { editionFormat != nil },
            set: { if !$0 { editionFormat = nil } }
        )) {
            if let bookId = editionBookId, let format = editionFormat {
                EditionPickerSheet(bookId: bookId, format: format, onChanged: onEditionsChanged)
                    .presentationDetents([.large])
                    .presentationBackground(Theme.bg)
            }
        }
    }
}

// ── Shelves picker — add-to-shelf-button.tsx popover ──
private struct ShelvesPickerSheet: View {
    let bookId: String
    @State var isFavorited: Bool
    let shelves: [BookPageShelf]
    @State var memberIds: Set<String>
    let onChanged: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var favoriteError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add to Shelf")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)

            // Top Shelf toggle — first row like the web popover (free tier)
            Button {
                Task {
                    struct Ok: Codable { let ok: Bool; let isFavorited: Bool }
                    do {
                        let res: Ok = try await APIClient.shared.post("/api/v1/books/\(bookId)/favorite", body: [:])
                        isFavorited = res.isFavorited
                        await onChanged()
                    } catch {
                        favoriteError = (error as? APIError)?.errorDescription ?? "Couldn't update Top Shelf."
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: isFavorited ? "star.fill" : "star")
                        .foregroundStyle(isFavorited ? Theme.accent : Theme.muted)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Top Shelf")
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(Theme.foreground)
                        Text("Your all-time favorites — pinned on your profile")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    if isFavorited { Text("✓").foregroundStyle(Theme.accent) }
                }
                .padding(.vertical, 8)
            }
            if let favoriteError {
                Text(favoriteError)
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(Theme.destructive)
            }
            Divider().background(Theme.border.opacity(0.6))
            if shelves.isEmpty {
                Text("No shelves yet — create one in My Library.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .padding(.vertical, 16)
            }
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(shelves) { shelf in
                        Button {
                            Task {
                                if memberIds.contains(shelf.id) {
                                    try? await APIClient.shared.removeBook(fromShelf: shelf.id, bookId: bookId)
                                    memberIds.remove(shelf.id)
                                } else {
                                    try? await APIClient.shared.addBook(toShelf: shelf.id, bookId: bookId)
                                    memberIds.insert(shelf.id)
                                }
                                await onChanged()
                            }
                        } label: {
                            HStack {
                                Text(shelf.name)
                                    .font(Theme.body(15))
                                    .foregroundStyle(Theme.foreground)
                                Spacer()
                                if memberIds.contains(shelf.id) {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(Theme.accent)
                                }
                            }
                            .padding(.vertical, 11)
                        }
                        Divider().background(Theme.border.opacity(0.4))
                    }
                }
            }
            Button("Done") { dismiss() }
                .buttonStyle(AccentButtonStyle())
        }
        .padding(20)
    }
}

// ── Stars row + review trigger (review-trigger.tsx) ──
private struct BookStarsRow: View {
    let data: BookDetailData
    var onReviewSaved: () -> Void = {}
    /// Raised by the page when the book was just finished — the wizard lives
    /// here, so the post-completion flow drives it through this binding.
    var autoOpen: Binding<Bool>? = nil
    /// Fired when the wizard closes, saved or cancelled.
    var onWizardClosed: () -> Void = {}
    @State private var wizardOpen = false

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                StarRow(rating: data.aggregate?.average ?? 0, size: 15)
                if let avg = data.aggregate?.average, avg > 0 {
                    Text(String(format: "%.1f avg.", avg))
                        .font(Theme.body(17, .semibold))
                        .foregroundStyle(Theme.foreground)
                    Text("·").foregroundStyle(Theme.muted)
                    NavigationLink(value: ReviewsRoute(bookIdOrSlug: data.slug ?? data.book.id, bookTitle: data.book.title)) {
                        Text("\(data.aggregate?.count ?? 0) review\(data.aggregate?.count == 1 ? "" : "s")")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.neonBlue)
                            .underline()
                    }
                }
            }
            .frame(maxWidth: .infinity)

            if data.hasCompleted || data.userState?.state == "completed" || data.userState?.state == "dnf" || data.userRating != nil {
                Button {
                    wizardOpen = true
                } label: {
                    // Same 14pt rounding as every other book-page button
                    // (user request 2026-07-14 — was the lone capsule).
                    Text(data.userRating != nil ? "Edit your review" : "Rate & review")
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.accentText)
                        .padding(.horizontal, 20).padding(.vertical, 9)
                        .background(Theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.accent.opacity(0.45), lineWidth: 1))
                        // Pin the hit region to the visible pill — taps near
                        // its lower edge were sometimes claimed by the
                        // content-flags banner below (user report 2026-07-22).
                        .contentShape(RoundedRectangle(cornerRadius: 14))
                }
            } else {
                Text("Mark as finished to review")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.top, 4)
        // Wins any hit-region overlap against the content-flags banner
        // rendered directly below in the page VStack (iOS 27 lets a
        // full-bleed sibling button's region bleed across the gap).
        .zIndex(1)
        #if DEBUG && targetEnvironment(simulator)
        .task {
            if ProcessInfo.processInfo.environment["TBRA_DEBUG_REVIEW"] != nil {
                try? await Task.sleep(for: .seconds(1))
                wizardOpen = true
            }
        }
        #endif
        .onChange(of: autoOpen?.wrappedValue ?? false) { _, wants in
            if wants {
                wizardOpen = true
                autoOpen?.wrappedValue = false
            }
        }
        .onChange(of: wizardOpen) { was, now in
            if was && !now { onWizardClosed() }
        }
        .fullScreenCover(isPresented: $wizardOpen) {
            ReviewWizardView(
                bookId: data.book.id,
                isFiction: data.book.isFiction,
                ratings: data.book.ratings,
                bookTitle: data.book.title,
                bookAuthors: data.book.authors.map(\.name),
                onSaved: onReviewSaved
            )
        }
    }
}

// ── Summary quote card — book-summary.tsx `frosted` variant ──
// Frosted glass w/ a BREATHING two-tone radial glow (purple + sky), visible
// border in both modes, and a giant serif ” overhanging the bottom-right,
// clipped by the card (user request 2026-07-14: outline was lost + quote
// marks too small).
private struct SummaryQuoteCard: View {
    let summary: String
    @Environment(\.colorScheme) private var colorScheme
    @State private var breathe = false

    var body: some View {
        let isLight = colorScheme == .light
        ZStack {
            // frosted-breathe: two radial ellipses, 6s ease-in-out infinite,
            // opacity .6→1 + scale 1→1.05 (globals.css frosted-blob).
            GeometryReader { geo in
                ZStack {
                    Ellipse()
                        .fill(RadialGradient(
                            colors: [isLight ? Color(hex: "7c3aed").opacity(0.10)
                                             : Color(hex: "a855f7").opacity(0.18), .clear],
                            center: .center, startRadius: 0, endRadius: geo.size.width * 0.35))
                        .frame(width: geo.size.width * 0.7, height: geo.size.height * 1.6)
                        .position(x: geo.size.width * 0.3, y: geo.size.height * 0.5)
                    Ellipse()
                        .fill(RadialGradient(
                            colors: [isLight ? Color(hex: "2563eb").opacity(0.07)
                                             : Color(hex: "38bdf8").opacity(0.12), .clear],
                            center: .center, startRadius: 0, endRadius: geo.size.width * 0.3))
                        .frame(width: geo.size.width * 0.6, height: geo.size.height * 1.2)
                        .position(x: geo.size.width * 0.7, y: geo.size.height * 0.5)
                }
                .opacity(breathe ? 1.0 : 0.6)
                .scaleEffect(breathe ? 1.05 : 1.0)
            }

            Text(summary)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground.opacity(0.7))
                .lineSpacing(5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                .padding(.trailing, 32)
        }
        // Giant serif ” overhanging the bottom-right corner. At the first
        // offsets only the round HEADS of the marks stayed visible — two
        // meaningless circles (user report 2026-07-14). Show most of the
        // glyph's ink (heads + tails) with just the tail tips clipped, and
        // bump opacity so it reads as quote marks.
        .overlay(alignment: .bottomTrailing) {
            Text("\u{201D}")
                .font(.custom("Georgia", size: 200))
                .foregroundStyle(Theme.foreground.opacity(isLight ? 0.08 : 0.10))
                .offset(x: 12, y: 78)
        }
        .background(isLight ? Color.black.opacity(0.03) : Color.white.opacity(0.06))
        // Web mobile: rounded-r-2xl + pl-[calc(50vw-50%+1rem)] — the card
        // bleeds off the LEFT screen edge; only right corners round.
        .clipShape(UnevenRoundedRectangle(
            topLeadingRadius: 0, bottomLeadingRadius: 0,
            bottomTrailingRadius: 16, topTrailingRadius: 16))
        .overlay(
            UnevenRoundedRectangle(
                topLeadingRadius: 0, bottomLeadingRadius: 0,
                bottomTrailingRadius: 16, topTrailingRadius: 16)
                .stroke(isLight ? Color.black.opacity(0.08) : Color.white.opacity(0.06), lineWidth: 1)
        )
        .padding(.leading, -20)   // cancel the page gutter → full-bleed left
        .onAppear {
            withAnimation(.easeInOut(duration: 6).repeatForever(autoreverses: true)) {
                breathe = true
            }
        }
    }
}

// ── What's Inside — content-profile.tsx, spoiler gate + 2-col grid ──
private struct WhatsInsideSection: View {
    let ratings: [ContentRating]
    var bookId: String = ""
    var isAdmin: Bool = false
    var onChanged: () -> Void = {}
    // Headless-verification hook: TBRA_DEBUG_REVEAL=1 skips the spoiler
    // blur so screenshots can read the grid (sim only).
    #if DEBUG && targetEnvironment(simulator)
    @State private var revealed = ProcessInfo.processInfo.environment["TBRA_DEBUG_REVEAL"] == "1"
    #else
    @State private var revealed = false
    #endif
    @State private var expanded: Set<String> = []
    @State private var editing: ContentRating?
    @State private var verifyingAll = false
    @State private var verifiedOverride: Set<String> = []

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    // Web content-profile.tsx CATEGORY_ORDER — display order is authoritative
    // here, NOT the API order (user request 2026-07-15: Romance/Sex first).
    private static let categoryOrder: [String] = [
        "romance_sex", "violence_gore", "profanity_language", "substance_use",
        "lgbtqia_representation", "religious_content", "magic_witchcraft",
        "occult_demonology", "political_ideological", "self_harm_suicide",
        "abuse_suffering", "other",
    ]
    // Web SHORT_NAMES — compact single-line labels.
    private static let shortNames: [String: String] = [
        "romance_sex": "Sexual content",
        "lgbtqia_representation": "LGBTQ+ Rep.",
        "profanity_language": "Profanity",
        "political_ideological": "Political content",
        "magic_witchcraft": "Magic & witchcraft",
        "occult_demonology": "Occult / demonology",
        "abuse_suffering": "Abuse & suffering",
    ]

    private var orderedRatings: [ContentRating] {
        ratings.sorted {
            (Self.categoryOrder.firstIndex(of: $0.categoryKey) ?? 999)
                < (Self.categoryOrder.firstIndex(of: $1.categoryKey) ?? 999)
        }
    }

    private func isVerified(_ r: ContentRating) -> Bool {
        r.evidenceLevel == "human_verified" || verifiedOverride.contains(r.categoryId)
    }
    private var allVerified: Bool {
        !ratings.isEmpty && orderedRatings.allSatisfy(isVerified)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                SectionHeading("What's Inside")
                Spacer()
                if isAdmin && !bookId.isEmpty {
                    if allVerified {
                        Text("All Verified")
                            .font(Theme.body(11, .semibold))
                            .foregroundStyle(Theme.accentText)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Theme.accent.opacity(0.12), in: Capsule())
                            .overlay(Capsule().stroke(Theme.accent.opacity(0.4), lineWidth: 1))
                    } else {
                        Button {
                            verifyAll()
                        } label: {
                            Text(verifyingAll ? "Verifying…" : "Verify All")
                                .font(Theme.body(11, .semibold))
                                .foregroundStyle(Theme.accentText)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(Theme.accent.opacity(0.1), in: Capsule())
                                .overlay(Capsule().stroke(Theme.accent.opacity(0.3), lineWidth: 1))
                        }
                        .disabled(verifyingAll)
                    }
                }
            }

            ZStack {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 22) {
                    ForEach(orderedRatings) { rating in
                        ratingCell(rating)
                    }
                }
                .blur(radius: revealed ? 0 : 12)
                .allowsHitTesting(revealed)

                if !revealed {
                    VStack(spacing: 10) {
                        Button {
                            withAnimation(.easeOut(duration: 0.25)) { revealed = true }
                        } label: {
                            Text("Reveal Content Details")
                                .font(Theme.body(17, .semibold))
                                .foregroundStyle(Theme.foreground)
                                .padding(.horizontal, 26).padding(.vertical, 13)
                                .background(Capsule().stroke(Theme.accent, lineWidth: 1.5))
                                .background(Theme.bg.opacity(0.6), in: Capsule())
                        }
                        Text("will contain mild spoilers")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .sheet(item: $editing) { rating in
            AdminRatingEditorSheet(
                bookId: bookId,
                rating: rating,
                displayName: Self.shortNames[rating.categoryKey] ?? rating.categoryName,
                onSaved: {
                    verifiedOverride.insert(rating.categoryId)
                    onChanged()
                }
            )
            .presentationDetents([.medium])
            .presentationBackground(Theme.bg)
        }
    }

    private func verifyAll() {
        verifyingAll = true
        Task {
            defer { verifyingAll = false }
            struct Ok: Codable { let ok: Bool }
            if let _: Ok = try? await APIClient.shared.request(
                "/api/v1/admin/books/\(bookId)/content-verify", method: "POST",
                body: ["all": true]) {
                for r in ratings { verifiedOverride.insert(r.categoryId) }
                onChanged()
            }
        }
    }

    private func intensityColor(_ level: Int) -> Color {
        switch level {
        case 1: return Color(dark: "38bdf8", light: "0ea5e9")
        case 2: return Color(dark: "facc15", light: "d97706")
        case 3: return Color(dark: "fb923c", light: "ea580c")
        case 4: return Color(dark: "f87171", light: "dc2626")
        default: return Theme.surfaceAlt
        }
    }

    private func ratingCell(_ rating: ContentRating) -> some View {
        let isExpanded = expanded.contains(rating.categoryId)
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 6) {
                // 13pt (was 15) so the title fits one line. The badge + admin
                // pencil live in a trailing group kept on a SINGLE row (HStack)
                // — an earlier pass stacked them in a VStack, which for admins
                // pushed the pencil onto its own line and made the row two lines
                // tall again, negating the whole point (user request
                // 2026-07-18: badge + pencil must stay inline, one line).
                Text(Self.shortNames[rating.categoryKey] ?? rating.categoryName)
                    .font(Theme.body(13, .semibold))
                    .foregroundStyle(Theme.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                HStack(spacing: 4) {
                    // Web evidenceBadge: "Verified" for human_verified, "AI"
                    // otherwise — both visible to all users.
                    if isVerified(rating) {
                        Text("Verified")
                            .font(Theme.body(10, .medium))
                            .foregroundStyle(Theme.accentText)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Theme.accent.opacity(0.12), in: Capsule())
                    } else {
                        Text("AI")
                            .font(Theme.body(10, .medium))
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Theme.surfaceAlt.opacity(0.8), in: Capsule())
                    }
                    if isAdmin && !bookId.isEmpty {
                        Button {
                            editing = rating
                        } label: {
                            // Compact pencil (18×18, no oversized circle) so the
                            // inline badge + pencil pair stays narrow enough to
                            // keep the title on one line for admins too.
                            Image(systemName: "pencil")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 18, height: 18)
                                .background(Theme.surfaceAlt.opacity(0.6), in: Circle())
                        }
                    }
                }
                .fixedSize()
            }

            // 4-segment intensity bar
            HStack(spacing: 4) {
                ForEach(0..<4, id: \.self) { i in
                    Capsule()
                        .fill(i < rating.intensity ? intensityColor(rating.intensity) : Theme.surfaceAlt)
                        .frame(height: 7)
                }
            }

            if let notes = rating.notes, !notes.isEmpty {
                Text(notes)
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(isExpanded ? nil : 3)
                    .lineSpacing(2)
                if notes.count > 90 {
                    Button {
                        withAnimation {
                            if isExpanded { expanded.remove(rating.categoryId) }
                            else { expanded.insert(rating.categoryId) }
                        }
                    } label: {
                        Text(isExpanded ? "Show less" : "Read more")
                            .font(Theme.body(13, .medium))
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
        }
    }
}

// ── Native cover picker (user request 2026-07-13: no more webview) ──
//
// Mirrors the web book-page cover modal: photo upload, paste-URL + Set,
// OpenLibrary edition covers, ISBNdb/Google candidates, audiobook square
// URL, and Remove. Candidates come from GET /api/v1/admin/cover-editor
// (server does the ISBN/OL lookups); saves hit the v1 admin cover route,
// which stamps cover_source='manual' + updated_at so changes ride the sync.

import PhotosUI

struct CoverPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let bookId: String
    let bookTitle: String

    @State private var data: APIClient.CoverEditorData?
    @State private var loadFailed = false
    @State private var urlText = ""
    @State private var audiobookUrlText = ""
    @State private var saving = false
    @State private var error: String?
    @State private var audiobookSaved = false
    @State private var photoItem: PhotosPickerItem?
    @State private var confirmRemove = false

    private let cols = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Cover for \u{201C}\(bookTitle)\u{201D}")
                        .font(Theme.heading(18, .bold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .padding(.top, 20)

                if let error {
                    Text(error)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.destructive)
                }

                // ── Upload ──
                sectionLabel("UPLOAD COVER")
                PhotosPicker(selection: $photoItem, matching: .images) {
                    HStack(spacing: 8) {
                        Image(systemName: "photo.badge.plus")
                            .font(.system(size: 13))
                        Text("Choose Photo")
                            .font(Theme.body(14, .semibold))
                    }
                    .foregroundStyle(Theme.onAccent)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10))
                }
                .onChange(of: photoItem) { _, item in
                    guard let item else { return }
                    Task { await uploadPhoto(item) }
                }
                Text("JPG, PNG, or WebP. Large photos are scaled to fit 2MB.")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.muted)
                    .padding(.top, -10)

                // ── Paste URL ──
                sectionLabel("PASTE COVER URL")
                HStack(spacing: 8) {
                    TextField("https://…", text: $urlText)
                        .font(Theme.body(14))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Theme.surfaceAlt.opacity(0.8))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                    Button {
                        save(url: urlText.trimmingCharacters(in: .whitespaces))
                    } label: {
                        Text("Set")
                            .font(Theme.body(14, .semibold))
                            .foregroundStyle(Theme.onAccent)
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(saving || urlText.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                // ── OpenLibrary editions ──
                if let data {
                    if !data.olEditions.isEmpty {
                        sectionLabel("OPEN LIBRARY EDITIONS (\(data.olEditions.count))")
                        LazyVGrid(columns: cols, spacing: 12) {
                            ForEach(data.olEditions, id: \.coverId) { ed in
                                Button {
                                    save(url: "https://covers.openlibrary.org/b/id/\(ed.coverId)-L.jpg")
                                } label: {
                                    VStack(spacing: 4) {
                                        CoverThumb(
                                            url: "https://covers.openlibrary.org/b/id/\(ed.coverId)-M.jpg",
                                            width: 76, height: 114, radius: 6)
                                        Text(caption(ed))
                                            .font(Theme.body(9))
                                            .foregroundStyle(Theme.muted)
                                            .lineLimit(1)
                                    }
                                }
                                .disabled(saving)
                            }
                        }
                    }

                    // ── ISBNdb + Google ──
                    if !data.external.isEmpty {
                        sectionLabel("ISBNDB & GOOGLE BOOKS (\(data.external.count))")
                        LazyVGrid(columns: cols, spacing: 12) {
                            ForEach(data.external, id: \.url) { cand in
                                Button {
                                    save(url: cand.url)
                                } label: {
                                    VStack(spacing: 4) {
                                        CoverThumb(url: cand.url, width: 76, height: 114, radius: 6)
                                        Text(cand.label)
                                            .font(Theme.body(9))
                                            .foregroundStyle(Theme.muted)
                                            .lineLimit(1)
                                    }
                                }
                                .disabled(saving)
                            }
                        }
                    }
                } else if loadFailed {
                    Text("Couldn't load cover candidates — URL and upload still work.")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().tint(Theme.accent)
                        Text("Finding covers…")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                }

                // ── Audiobook square ──
                sectionLabel("AUDIOBOOK COVER (SQUARE)")
                HStack(spacing: 8) {
                    TextField("https://…", text: $audiobookUrlText)
                        .font(Theme.body(14))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Theme.surfaceAlt.opacity(0.8))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                    Button {
                        saveAudiobook()
                    } label: {
                        Image(systemName: audiobookSaved ? "checkmark" : "arrow.down.circle")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(audiobookSaved ? Theme.accentText : Theme.onAccent)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(audiobookSaved ? Theme.accent.opacity(0.15) : Theme.accent,
                                        in: RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(saving)
                }
                Text("Only shows while the audiobook format is active. Clear the field and save to remove.")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.muted)
                    .padding(.top, -10)

                // ── Remove ──
                Button {
                    confirmRemove = true
                } label: {
                    Text("Remove cover")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.destructive)
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 20)
        }
        .background(Theme.bg)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            do {
                let res = try await APIClient.shared.coverEditor(bookId: bookId)
                data = res
                audiobookUrlText = res.book.audiobookCoverUrl ?? ""
            } catch {
                loadFailed = true
            }
        }
        .alert("Remove this cover?", isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) { save(url: nil) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The book will appear on the /admin/covers queue until a new cover is set.")
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(Theme.body(11, .semibold))
            .foregroundStyle(Theme.muted)
            .kerning(0.5)
    }

    private func caption(_ ed: APIClient.CoverEditorData.OLEdition) -> String {
        [ed.format, ed.year].compactMap { $0 }.joined(separator: " · ")
            .ifEmpty(ed.title ?? "")
    }

    private func save(url: String?) {
        saving = true; error = nil
        Task {
            do {
                try await APIClient.shared.setCover(bookId: bookId, url: url)
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Couldn't save the cover."
            }
            saving = false
        }
    }

    private func saveAudiobook() {
        let trimmed = audiobookUrlText.trimmingCharacters(in: .whitespaces)
        saving = true; error = nil
        Task {
            do {
                try await APIClient.shared.setAudiobookCover(
                    bookId: bookId, url: trimmed.isEmpty ? nil : trimmed)
                audiobookSaved = true
                try? await Task.sleep(for: .seconds(1.2))
                audiobookSaved = false
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Couldn't save the audiobook cover."
            }
            saving = false
        }
    }

    private func uploadPhoto(_ item: PhotosPickerItem) {
        saving = true; error = nil
        Task {
            defer { saving = false; photoItem = nil }
            guard let raw = try? await item.loadTransferable(type: Data.self),
                  var image = UIImage(data: raw) else {
                error = "Couldn't read that photo."
                return
            }
            // Scale + recompress until it fits the 2MB server cap.
            var quality: CGFloat = 0.85
            var jpeg = image.jpegData(compressionQuality: quality)
            while let d = jpeg, d.count > 2 * 1024 * 1024 {
                if quality > 0.5 {
                    quality -= 0.15
                } else if image.size.width > 800 {
                    let scale = 800 / image.size.width
                    let newSize = CGSize(width: 800, height: image.size.height * scale)
                    image = UIGraphicsImageRenderer(size: newSize).image { _ in
                        image.draw(in: CGRect(origin: .zero, size: newSize))
                    }
                    quality = 0.8
                } else {
                    break
                }
                jpeg = image.jpegData(compressionQuality: quality)
            }
            guard let final = jpeg, final.count <= 2 * 1024 * 1024 else {
                error = "Photo is too large even after compression."
                return
            }
            do {
                _ = try await APIClient.shared.uploadCover(bookId: bookId, jpeg: final)
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Upload failed."
            }
        }
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

// ── Admin Edit — web admin-edit-panel.tsx, native (user request 2026-07-14) ──
// Collapsible section, super-admin only: the 13 scalar fields + genre chips.
// Data comes from GET /api/v1/admin/books/[id]/fields (the book payload
// doesn't carry publisher/language/isbn10/date); saves POST the same route
// and always bump updated_at so edits ride the sync.

struct AdminEditSection: View {
    let bookId: String
    let genres: [String]
    let onChanged: () -> Void
    @State private var expanded = false
    @State private var fields: [String: AdminFieldValue] = [:]
    @State private var loaded = false
    @State private var editingField: AdminFieldDef?
    @State private var newGenre = ""
    @State private var busy = false
    @State private var error: String?

    enum AdminFieldValue: Hashable {
        case string(String?)
        case number(Int?)
        case bool(Bool)

        var display: String {
            switch self {
            case .string(let s): return s?.isEmpty == false ? s! : "—"
            case .number(let n): return n.map(String.init) ?? "—"
            case .bool(let b): return b ? "Yes" : "No"
            }
        }
    }

    struct AdminFieldDef: Identifiable {
        let key: String
        let label: String
        let kind: Kind
        enum Kind { case text, number, multiline, boolean, pacing }
        var id: String { key }
    }

    static let defs: [AdminFieldDef] = [
        .init(key: "title", label: "Title", kind: .text),
        .init(key: "publicationYear", label: "Publication Year", kind: .number),
        .init(key: "publicationDate", label: "Publication Date", kind: .text),
        .init(key: "pages", label: "Pages", kind: .number),
        .init(key: "audioLengthMinutes", label: "Audio Length (min)", kind: .number),
        // Tap cycles none -> Slow -> Medium -> Fast -> none (saves each tap).
        // Normally set by enrichment; editable for author-confirmed pacing.
        .init(key: "pacing", label: "Pacing", kind: .pacing),
        .init(key: "publisher", label: "Publisher", kind: .text),
        .init(key: "language", label: "Language", kind: .text),
        .init(key: "isbn13", label: "ISBN-13", kind: .text),
        .init(key: "isbn10", label: "ISBN-10", kind: .text),
        .init(key: "asin", label: "ASIN", kind: .text),
        .init(key: "isFiction", label: "Fiction", kind: .boolean),
        .init(key: "description", label: "Description", kind: .multiline),
        .init(key: "summary", label: "Summary", kind: .multiline),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    SectionHeading("Admin Edit")
                    Image(systemName: "wrench.and.screwdriver")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.neonPurple)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
            }

            if expanded {
                if let error {
                    Text(error).font(Theme.body(12)).foregroundStyle(Theme.destructive)
                }
                VStack(spacing: 0) {
                    ForEach(Self.defs) { def in
                        Button {
                            if def.kind == .boolean {
                                toggleBool(def)
                            } else if def.kind == .pacing {
                                cyclePacing(def)
                            } else {
                                editingField = def
                            }
                        } label: {
                            HStack(alignment: .top) {
                                Text(def.label)
                                    .font(Theme.body(13, .medium))
                                    .foregroundStyle(Theme.muted)
                                    .frame(width: 130, alignment: .leading)
                                Text(def.kind == .pacing
                                     ? Self.pacingLabel(fields[def.key]) : (fields[def.key]?.display ?? "…"))
                                    .font(Theme.body(13))
                                    .foregroundStyle(Theme.foreground.opacity(0.9))
                                    .lineLimit(def.kind == .multiline ? 2 : 1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Image(systemName: def.kind == .boolean ? "switch.2"
                                      : def.kind == .pacing ? "arrow.triangle.2.circlepath" : "pencil")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.muted.opacity(0.6))
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                        }
                        .disabled(busy || !loaded)
                        Divider().background(Theme.border.opacity(0.4))
                    }

                    // Genres
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Genres")
                            .font(Theme.body(13, .medium))
                            .foregroundStyle(Theme.muted)
                        FlowLayout(spacing: 6) {
                            ForEach(genres, id: \.self) { g in
                                HStack(spacing: 4) {
                                    Text(g).font(Theme.body(12))
                                    Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                                }
                                .foregroundStyle(Theme.foreground.opacity(0.85))
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Theme.surfaceAlt.opacity(0.8), in: Capsule())
                                .onTapGesture { genre(remove: g) }
                            }
                        }
                        HStack(spacing: 8) {
                            TextField("Add genre…", text: $newGenre)
                                .font(Theme.body(13))
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .background(Theme.surfaceAlt.opacity(0.6))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Button("Add") { genre(add: newGenre) }
                                .font(Theme.body(13, .semibold))
                                .foregroundStyle(Theme.neonBlue)
                                .disabled(newGenre.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                        }
                    }
                    .padding(14)
                }
                .background(Theme.surface.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.neonPurple.opacity(0.25), lineWidth: 1))
            }
        }
        .task(id: expanded) {
            guard expanded, !loaded else { return }
            await load()
        }
        .sheet(item: $editingField) { def in
            AdminFieldEditorSheet(
                def: def,
                initial: fields[def.key] ?? .string(nil),
                onSave: { newValue in save(def: def, value: newValue) }
            )
            .presentationDetents(def.kind == .multiline ? [.large] : [.medium])
            .presentationBackground(Theme.bg)
        }
    }

    private func load() async {
        struct Res: Codable {
            let ok: Bool
            let fields: Raw
            struct Raw: Codable {
                let title: String?; let publicationYear: Int?; let publicationDate: String?
                let pages: Int?; let audioLengthMinutes: Int?; let publisher: String?
                let language: String?; let isbn13: String?; let isbn10: String?
                let asin: String?; let isFiction: Bool?; let pacing: String?; let description: String?; let summary: String?
            }
        }
        guard let res: Res = try? await APIClient.shared.get("/api/v1/admin/books/\(bookId)/fields") else {
            error = "Couldn't load fields."
            return
        }
        let r = res.fields
        fields = [
            "title": .string(r.title), "publicationYear": .number(r.publicationYear),
            "publicationDate": .string(r.publicationDate), "pages": .number(r.pages),
            "audioLengthMinutes": .number(r.audioLengthMinutes), "publisher": .string(r.publisher),
            "language": .string(r.language), "isbn13": .string(r.isbn13), "isbn10": .string(r.isbn10),
            "asin": .string(r.asin), "isFiction": .bool(r.isFiction ?? true),
            "pacing": .string(r.pacing),
            "description": .string(r.description), "summary": .string(r.summary),
        ]
        loaded = true
    }

    private func toggleBool(_ def: AdminFieldDef) {
        guard case .bool(let current) = fields[def.key] else { return }
        save(def: def, value: .bool(!current))
    }

    static func pacingLabel(_ v: AdminFieldValue?) -> String {
        guard case .string(let s) = v, let s, !s.isEmpty else { return "—" }
        return s.prefix(1).uppercased() + s.dropFirst() + "-paced"
    }

    private func cyclePacing(_ def: AdminFieldDef) {
        var current: String? = nil
        if case .string(let s) = fields[def.key] { current = s }
        let next: String?
        switch current {
        case nil, "": next = "slow"
        case "slow": next = "medium"
        case "medium": next = "fast"
        default: next = nil
        }
        save(def: def, value: .string(next))
    }

    private func save(def: AdminFieldDef, value: AdminFieldValue) {
        busy = true; error = nil
        Task {
            defer { busy = false }
            var payload: [String: Any] = [:]
            switch value {
            case .string(let s): payload[def.key] = s ?? NSNull()
            case .number(let n): payload[def.key] = n ?? NSNull()
            case .bool(let b): payload[def.key] = b
            }
            struct Ok: Codable { let ok: Bool }
            do {
                let _: Ok = try await APIClient.shared.request(
                    "/api/v1/admin/books/\(bookId)/fields", method: "POST",
                    body: ["fields": payload])
                fields[def.key] = value
                onChanged()
            } catch {
                self.error = "Couldn't save \(def.label)."
            }
        }
    }

    private func genre(add: String? = nil, remove: String? = nil) {
        busy = true; error = nil
        Task {
            defer { busy = false }
            struct Ok: Codable { let ok: Bool }
            var body: [String: Any] = [:]
            if let add { body["add"] = add.trimmingCharacters(in: .whitespaces) }
            if let remove { body["remove"] = remove }
            do {
                let _: Ok = try await APIClient.shared.request(
                    "/api/v1/admin/books/\(bookId)/genres", method: "POST", body: body)
                newGenre = ""
                onChanged()
            } catch {
                self.error = "Couldn't update genres."
            }
        }
    }
}

private struct AdminFieldEditorSheet: View {
    let def: AdminEditSection.AdminFieldDef
    let initial: AdminEditSection.AdminFieldValue
    let onSave: (AdminEditSection.AdminFieldValue) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(def.label)
                    .font(Theme.heading(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Button("Save") {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    switch def.kind {
                    case .number:
                        onSave(.number(Int(trimmed)))
                    case .boolean:
                        break
                    default:
                        onSave(.string(trimmed.isEmpty ? nil : trimmed))
                    }
                    dismiss()
                }
                .font(Theme.body(15, .semibold))
                .foregroundStyle(Theme.neonBlue)
            }
            if def.kind == .multiline {
                TextEditor(text: $text)
                    .scrollContentBackground(.hidden)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.foreground)
                    .padding(10)
                    .background(Theme.surfaceAlt.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            } else {
                TextField(def.label, text: $text)
                    .font(Theme.body(15))
                    .keyboardType(def.kind == .number ? .numberPad : .default)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Theme.surfaceAlt.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                Spacer()
            }
        }
        .padding(20)
        .background(Theme.bg)
        .onAppear {
            switch initial {
            case .string(let s): text = s ?? ""
            case .number(let n): text = n.map(String.init) ?? ""
            case .bool: text = ""
            }
        }
    }
}

// ── Admin rating editor — web AdminEditModal (content-profile.tsx) ──
// Intensity 0-4 segmented + notes (≤500) + "Save & Verify": saving an edit
// also verifies that single category (evidence_level = human_verified).
struct AdminRatingEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let bookId: String
    let rating: ContentRating
    let displayName: String
    let onSaved: () -> Void

    @State private var intensity: Int
    @State private var notes: String
    @State private var saving = false
    @State private var error: String?

    private static let intensityLabels = ["None", "Mild", "Moderate", "Significant", "Extreme"]

    init(bookId: String, rating: ContentRating, displayName: String, onSaved: @escaping () -> Void) {
        self.bookId = bookId
        self.rating = rating
        self.displayName = displayName
        self.onSaved = onSaved
        _intensity = State(initialValue: rating.intensity)
        _notes = State(initialValue: rating.notes ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Edit \u{201C}\(displayName)\u{201D}")
                    .font(Theme.heading(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(.top, 18)

            VStack(alignment: .leading, spacing: 8) {
                Text("INTENSITY")
                    .font(Theme.body(11, .semibold)).kerning(0.5)
                    .foregroundStyle(Theme.muted)
                HStack(spacing: 6) {
                    ForEach(0...4, id: \.self) { level in
                        Button {
                            intensity = level
                        } label: {
                            Text(Self.intensityLabels[level])
                                .font(Theme.body(11, .semibold))
                                .foregroundStyle(intensity == level ? .black : Theme.muted)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 9)
                                .background(intensity == level ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.surfaceAlt.opacity(0.7)),
                                            in: RoundedRectangle(cornerRadius: 9))
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("NOTE (OPTIONAL, ≤500)")
                    .font(Theme.body(11, .semibold)).kerning(0.5)
                    .foregroundStyle(Theme.muted)
                TextEditor(text: $notes)
                    .scrollContentBackground(.hidden)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.foreground)
                    .frame(minHeight: 90)
                    .padding(10)
                    .background(Theme.surfaceAlt.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                    .onChange(of: notes) {
                        if notes.count > 500 { notes = String(notes.prefix(500)) }
                    }
            }

            if let error {
                Text(error).font(Theme.body(12)).foregroundStyle(Theme.destructive)
            }

            Button {
                save()
            } label: {
                Text(saving ? "Saving…" : "Save & Verify")
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .disabled(saving)
            Spacer()
        }
        .padding(.horizontal, 20)
        .background(Theme.bg)
    }

    private func save() {
        saving = true; error = nil
        Task {
            defer { saving = false }
            struct Ok: Codable { let ok: Bool }
            var body: [String: Any] = ["categoryKey": rating.categoryKey, "intensity": intensity]
            let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            body["notes"] = trimmed.isEmpty ? NSNull() : trimmed
            do {
                let _: Ok = try await APIClient.shared.request(
                    "/api/v1/admin/books/\(bookId)/content-verify", method: "POST", body: body)
                onSaved()
                dismiss()
            } catch {
                self.error = "Couldn't save."
            }
        }
    }
}

// ── About / Details — web book-about-details.tsx ──
// Two tabs (only when both exist): About = description with 500-char
// read-more; Details = labeled rows in the web's exact order.
struct BookAboutDetailsSection: View {
    let book: BookFull
    @State private var tab = "about"
    @State private var descExpanded = false

    private var hasDescription: Bool { !(book.description ?? "").isEmpty }

    private var detailRows: [(String, String)] {
        var rows: [(String, String)] = []
        if let date = formattedReleaseDate() { rows.append(("Release date", date)) }
        if let pages = book.pages { rows.append(("Pages", String(pages))) }
        if let mins = book.audioLengthMinutes {
            let h = mins / 60, m = mins % 60
            rows.append(("Audio length", h > 0 ? (m > 0 ? "\(h)h \(m)m" : "\(h)h") : "\(m)m"))
        }
        if let lang = book.language, !lang.isEmpty { rows.append(("Language", lang)) }
        if let pub = book.publisher, !pub.isEmpty { rows.append(("Publisher", pub)) }
        if let isbn = book.isbn13 ?? book.isbn10, !isbn.isEmpty { rows.append(("ISBN", isbn)) }
        if let asin = book.asin, !asin.isEmpty { rows.append(("ASIN", asin)) }
        if let fiction = book.isFiction { rows.append(("Type", fiction ? "Fiction" : "Nonfiction")) }
        if let series = book.seriesInfo {
            rows.append(("Series", book.seriesPosition.map { "\(series.name) #\(SeriesPos.label($0))" } ?? series.name))
        }
        return rows
    }

    var body: some View {
        let hasDetails = !detailRows.isEmpty
        if hasDescription || hasDetails {
            VStack(alignment: .leading, spacing: 14) {
                // Tab headers (both) or single heading (one)
                if hasDescription && hasDetails {
                    HStack(spacing: 18) {
                        tabButton("About", key: "about")
                        tabButton("Details", key: "details")
                        Spacer()
                    }
                } else {
                    SectionHeading(hasDescription ? "About" : "Details")
                }

                if (tab == "about" && hasDescription) || (hasDescription && !hasDetails) {
                    aboutBody
                } else {
                    detailsTable
                }
            }
        }
    }

    private func tabButton(_ label: String, key: String) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { tab = key }
        } label: {
            VStack(spacing: 5) {
                Text(label)
                    .font(Theme.heading(20, .bold))
                    .foregroundStyle(tab == key ? Theme.neonBlue : Theme.muted.opacity(0.4))
                Capsule()
                    .fill(tab == key ? Theme.neonBlue : .clear)
                    .frame(width: 34, height: 3)
            }
        }
    }

    /// Web renderMarkdown parity (book-about-details.tsx): descriptions also
    /// carry markdown-ish inline marks from enrichment sources — convert them
    /// to the HTML tags ReviewHTML already parses so asterisks/underscores
    /// never render literally (user report 2026-07-22). Order matters:
    /// triple → double → single, mirroring (and slightly hardening) the web.
    private func markdownLiteToHTML(_ s: String) -> String {
        var out = s
        func re(_ pattern: String, _ template: String) {
            guard let rx = try? NSRegularExpression(pattern: pattern) else { return }
            out = rx.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: template)
        }
        re("\\*\\*\\*(.+?)\\*\\*\\*", "<b><i>$1</i></b>")
        re("\\*\\*(.+?)\\*\\*", "<b>$1</b>")
        re("__(.+?)__", "<b>$1</b>")
        re("\\*(.+?)\\*", "<i>$1</i>")
        re("(?<!\\w)_(.+?)_(?!\\w)", "<i>$1</i>")
        return out
    }

    @ViewBuilder private var aboutBody: some View {
        let description = book.description ?? ""
        let isLong = description.count > 500
        let shown = isLong && !descExpanded ? String(description.prefix(500)) + "…" : description
        VStack(alignment: .leading, spacing: 6) {
            // Descriptions carry publisher HTML (<p>/<br>/<b>/<i>) — reuse the
            // review HTML renderer so tags never show raw.
            ReviewHTMLText(html: markdownLiteToHTML(shown), baseSize: 14)
                .id("about") // headless-verification scroll anchor
            if isLong {
                Button {
                    withAnimation { descExpanded.toggle() }
                } label: {
                    Text(descExpanded ? "Show less" : "Read more")
                        .font(Theme.body(13, .semibold))
                        .foregroundStyle(Theme.neonBlue)
                }
            }
        }
    }

    private var detailsTable: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(detailRows, id: \.0) { row in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(row.0.uppercased())
                        .font(Theme.body(11, .medium)).kerning(0.5)
                        .foregroundStyle(Theme.muted)
                        .frame(width: 100, alignment: .leading)
                    Text(row.1)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// Web formatReleaseDate: full date → "April 1, 2026"; "2025-12" →
    /// "December 2025"; else the bare year.
    private func formattedReleaseDate() -> String? {
        let months = ["January", "February", "March", "April", "May", "June", "July",
                      "August", "September", "October", "November", "December"]
        if let d = book.publicationDate, !d.isEmpty {
            let parts = d.split(separator: "-").map(String.init)
            if parts.count >= 3, let m = Int(parts[1]), let day = Int(parts[2]), (1...12).contains(m) {
                return "\(months[m - 1]) \(day), \(parts[0])"
            }
            if parts.count == 2, let m = Int(parts[1]), (1...12).contains(m) {
                return "\(months[m - 1]) \(parts[0])"
            }
            return d
        }
        if let year = book.publicationYear { return String(year) }
        return nil
    }
}

// ── Pre-release banner — the web's "📅 Releases <date>" strip on the book
// page (page.tsx). iOS had no equivalent, so an unreleased book looked
// identical to a shipped one (punch list #6, 2026-08-08; also reported from
// TestFlight on 2026-08-01 for Scion).
struct PreReleaseBanner: View {
    let publicationDate: String?
    let publicationYear: Int?

    private static let months = ["January", "February", "March", "April", "May", "June",
                                 "July", "August", "September", "October", "November", "December"]

    /// Mirrors the web's day/month/year precision cascade: a full date is only
    /// pre-release if the DAY is still ahead; a YYYY-MM only counts if the
    /// whole month is; a bare year only if the year is.
    private var releaseLabel: String? {
        let now = Date()
        let cal = Calendar.current
        if let raw = publicationDate, !raw.isEmpty {
            let parts = raw.split(separator: "-").map(String.init)
            if parts.count >= 3, let y = Int(parts[0]), let m = Int(parts[1]),
               let d = Int(parts[2]), (1...12).contains(m) {
                guard let date = cal.date(from: DateComponents(year: y, month: m, day: d)),
                      date > now else { return nil }
                return "\(Self.months[m - 1]) \(d), \(y)"
            }
            if parts.count == 2, let y = Int(parts[0]), let m = Int(parts[1]), (1...12).contains(m) {
                // End of that month — a book dated 2026-09 is still upcoming
                // through September 30th.
                guard let start = cal.date(from: DateComponents(year: y, month: m, day: 1)),
                      let end = cal.date(byAdding: DateComponents(month: 1, day: -1), to: start),
                      end > now else { return nil }
                return "\(Self.months[m - 1]) \(y)"
            }
            return nil
        }
        if let year = publicationYear, year > cal.component(.year, from: now) {
            return String(year)
        }
        return nil
    }

    var body: some View {
        if let label = releaseLabel {
            HStack(spacing: 8) {
                Image(systemName: "calendar")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.accentText)
                (Text("Releases ") + Text(label).fontWeight(.bold))
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.foreground)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(Theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.accent.opacity(0.30), lineWidth: 1))
        }
    }
}

// ── Content comfort-zone banner — web content-warning-banner.tsx (2026-07-16) ──
// Yellow expandable banner under the stars row: "N content flags for your
// settings" → per-flag rows (intensity conflicts, reviewer flags, note hits)
// + "See all content details ↓" which scrolls to What's Inside.

struct ContentFlagsBanner: View {
    let conflicts: [ContentConflict]
    let reviewerWarnings: [ReviewerWarning]
    let noteWarnings: [NoteWarning]
    let onSeeDetails: () -> Void
    @State private var expanded = false

    private static let intensityLabels = ["none", "mild", "moderate", "significant", "extreme"]
    private let yellow = Color(hex: "eab308")

    private var totalFlags: Int { conflicts.count + reviewerWarnings.count + noteWarnings.count }

    var body: some View {
        if totalFlags > 0 {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) { expanded.toggle() }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(yellow)
                        Text("\(totalFlags) content \(totalFlags == 1 ? "flag" : "flags") for your settings")
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(yellow.opacity(0.6))
                            .rotationEffect(.degrees(expanded ? 180 : 0))
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    // Pin the toggle's tap region to its own padded bounds —
                    // it was intermittently claiming taps aimed at the review
                    // button rendered above (user report 2026-07-22).
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if expanded {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(conflicts, id: \.categoryName) { c in
                            flagRow(
                                title: c.categoryName,
                                detail: "\(Self.intensityLabels[safe: c.bookIntensity] ?? "present") · max \(Self.intensityLabels[safe: c.userMax] ?? "limited")"
                            )
                        }
                        ForEach(reviewerWarnings, id: \.label) { w in
                            flagRow(
                                title: w.label,
                                detail: "\(w.count) \(w.count == 1 ? "reviewer" : "reviewers") flagged · you asked to avoid"
                            )
                        }
                        ForEach(noteWarnings, id: \.label) { w in
                            flagRow(
                                title: w.label,
                                detail: "noted in \(w.categories.joined(separator: ", ")) · you asked to avoid"
                            )
                        }
                        Button {
                            // Web parity: the link ONLY scrolls — no collapse.
                            // (Collapsing in the same transaction shifted the
                            // layout mid-scroll and the scroll went nowhere.)
                            onSeeDetails()
                        } label: {
                            Text("See all content details ↓")
                                .font(Theme.body(12, .medium))
                                .foregroundStyle(Theme.neonBlue)
                        }
                        .padding(.top, 6)
                    }
                    .padding(.horizontal, 16).padding(.bottom, 12)
                }
            }
            .background(yellow.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(yellow.opacity(0.3), lineWidth: 1))
        }
    }

    private func flagRow(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Theme.body(12, .medium))
                .foregroundStyle(Theme.foreground)
            Text(detail)
                .font(Theme.body(11))
                .foregroundStyle(Theme.foreground.opacity(0.7))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(yellow.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
