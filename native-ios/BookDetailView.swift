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
struct BookRoute: Hashable {
    let idOrSlug: String
}

@MainActor
@Observable
final class BookDetailModel {
    let idOrSlug: String
    var data: BookDetailData?
    var error: String?
    var loading = false

    init(idOrSlug: String) { self.idOrSlug = idOrSlug }

    func load() async {
        loading = true; defer { loading = false }
        do { data = try await APIClient.shared.bookDetail(idOrSlug) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load this book." }
    }
}

struct BookDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: BookDetailModel

    init(idOrSlug: String) {
        _model = State(initialValue: BookDetailModel(idOrSlug: idOrSlug))
    }

    var body: some View {
        ScrollViewReader { scrollProxy in
        ScrollView {
            if let data = model.data {
                VStack(alignment: .leading, spacing: 20) {
                    BookHero(data: data, onBack: { dismiss() })
                    BookActionCluster(model: model, data: data)
                    BookStarsRow(data: data, onReviewSaved: { Task { await model.load() } })
                    if let summary = data.book.summary, !summary.isEmpty {
                        SummaryQuoteCard(summary: summary)
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
                        FriendsWhoReadSection(friends: data.friendsWhoRead)
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
                        WhatsInsideSection(ratings: data.book.ratings)
                    }
                    BookFooterActions(
                        bookId: data.book.id,
                        bookTitle: data.book.title,
                        isHidden: data.isHidden,
                        onChanged: { Task { await model.load() } }
                    )
                    SimilarBooksSection(bookId: data.book.id)
                        .id("similar")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            } else {
                // Loading / failed state — keep a back affordance on screen
                // (the hero's back button only exists once data renders).
                VStack(alignment: .leading, spacing: 24) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.35), in: Circle())
                            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                    }
                    if model.loading {
                        ProgressView().tint(Theme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 100)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(AmbientBackground())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load()
            #if DEBUG && targetEnvironment(simulator)
            if let anchor = ProcessInfo.processInfo.environment["TBRA_DEBUG_SCROLL_TO"] {
                try? await Task.sleep(for: .seconds(1))
                withAnimation { scrollProxy.scrollTo(anchor, anchor: .top) }
            }
            #endif
        }
        .refreshable { await model.load() }
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
    let onBack: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var book: BookFull { data.book }
    private var isLight: Bool { colorScheme == .light }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.foreground.opacity(0.9))
                        .frame(width: 40, height: 40)
                        .background(Theme.scrim, in: Circle())
                        .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                }
                Spacer()
            }

            // Blurred-cover hero card — the genre/age pills half-overlap the
            // top-right edge (web: absolute -top-3 right-4) and the share
            // button half-overlaps the bottom-left (bottom-0 left-4
            // translate-y-1/2), so the card gets breathing room top+bottom.
            heroCard
                .padding(.top, 14)
                .padding(.bottom, 20)
        }
        // Page-level hero bleed (.book-hero-img): the big soft color wash
        // behind everything is what gives the page its vibrance.
        .background(alignment: .top) { heroBleed }
    }

    private var heroCard: some View {
        HStack(alignment: .center, spacing: 16) {   // web: items-center
            CoverThumb(url: book.coverImageUrl, width: 110, height: book.audioLengthMinutes != nil && book.pages == nil ? 110 : 165, radius: 10)
                .shadow(color: .black.opacity(0.5), radius: 12, y: 6)

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
                            Text("#\(pos) in \(series.name)")
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                        }
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.neonBlue)
                    }
                }
                HStack(spacing: 6) {
                    if let year = book.publicationYear { Text(String(year)) }
                    if let mins = book.audioLengthMinutes {
                        Text("·")
                        Label("\(mins / 60)h \(mins % 60)m", systemImage: "headphones")
                    } else if let pages = book.pages {
                        Text("·")
                        Text("\(pages)p")
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
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.foreground.opacity(0.9))
                        .frame(width: 40, height: 40)
                        .background(Theme.surface, in: Circle())
                        .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                        .shadow(color: .black.opacity(0.3), radius: 5, y: 2)
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
            if let cover = book.coverImageUrl, let url = URL(string: cover) {
                CoverBlurImage(url: url)
                (isLight ? Color.white.opacity(0.38) : Color.black.opacity(0.30))
            }
        }
    }

    /// Page-level bleed — .book-hero-img exactly:
    /// dark: opacity .6, saturate 1.5, brightness 1.1, blur 64, scale 1.5
    /// light: opacity .9, blur 64, saturate 2.5, brightness 1.6, screen
    @ViewBuilder private var heroBleed: some View {
        if let cover = book.coverImageUrl, let url = URL(string: cover) {
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
                .frame(height: 380)
                .clipped()
                .mask(
                    LinearGradient(stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: 0.55),
                        .init(color: .clear, location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                )
                .allowsHitTesting(false)
            } placeholder: { Color.clear }
            .padding(.horizontal, -20)
            .padding(.top, -60)
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
        }
        .sheet(isPresented: $showTbrNoteEditor) {
            TbrNoteEditorSheet(bookId: book.id, existing: data.tbrNote) {
                Task { await model.load() }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
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
                                Text("✓").foregroundStyle(Theme.accent)
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
                // Buddy Read → creates one for this book, opens the detail
                Button {
                    stateDropdownOpen = false
                    Task {
                        struct Body: Codable, Sendable { let bookId: String }
                        struct Ok: Codable { let ok: Bool; let slug: String? }
                        if let res: Ok = try? await APIClient.shared.request(
                            "/api/v1/buddy-reads", method: "POST", json: Body(bookId: book.id)),
                           let slug = res.slug {
                            createdBuddyReadSlug = slug
                        }
                    }
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
            .foregroundStyle(data.upNextPosition != nil ? Theme.accent : Theme.muted)
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
        clusterPill(icon: "headphones",
                    label: (data.userState?.activeFormats.first).map(formatLabel) ?? "Format",
                    tint: Theme.neonBlue,
                    solid: !(data.userState?.activeFormats.isEmpty ?? true)) {
            showFormatSheet = true
        }
    }

    private var ownedButton: some View {
        let owned = data.userState?.ownedFormats.filter { $0 != "unknown" } ?? []
        return clusterPill(icon: "books.vertical",
                           label: owned.isEmpty ? "Owned" : "Owned · \(owned.count)",
                           tint: Theme.neonPurple, solid: false) {
            showOwnedSheet = true
        }
    }

    private var shelvesButton: some View {
        clusterPill(icon: "star",
                    label: data.bookShelfIds.isEmpty ? "Shelves" : "Shelves · \(data.bookShelfIds.count)",
                    tint: Theme.neonBlue, solid: false) {
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
        }
        .buttonStyle(TapScaleButtonStyle())
    }

    private func formatLabel(_ f: String) -> String {
        ["hardcover": "Hardcover", "paperback": "Paperback", "ebook": "eBook", "audiobook": "Audio", "set": "Box Set"][f] ?? f
    }

    // ── State machine actions (byte-equivalent to the web flows) ──
    private func mainTap() async {
        busy = true; defer { busy = false }
        if isActive {
            try? await APIClient.shared.setReadingState(bookId: book.id, state: "none")
        } else {
            try? await APIClient.shared.setReadingState(bookId: book.id, state: "tbr")
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
        busy = true; defer { busy = false }
        if currentState == state {
            try? await APIClient.shared.setReadingState(bookId: book.id, state: "none")
        } else {
            try? await APIClient.shared.setReadingState(bookId: book.id, state: state)
        }
        await model.load()
    }

    private func setState(_ state: String, completionDate: String?, precision: String? = nil) async {
        busy = true; defer { busy = false }
        try? await APIClient.shared.setReadingState(
            bookId: book.id, state: state,
            completionDate: completionDate,
            completionPrecision: precision
        )
        await model.load()
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
                    Text(data.userRating != nil ? "Edit your review" : "Rate & review")
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.accentText)
                        .padding(.horizontal, 20).padding(.vertical, 9)
                        .background(Theme.accent.opacity(0.1), in: Capsule())
                        .overlay(Capsule().stroke(Theme.accent.opacity(0.45), lineWidth: 1))
                }
            } else {
                Text("Mark as finished to review")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.top, 4)
        #if DEBUG && targetEnvironment(simulator)
        .task {
            if ProcessInfo.processInfo.environment["TBRA_DEBUG_REVIEW"] != nil {
                try? await Task.sleep(for: .seconds(1))
                wizardOpen = true
            }
        }
        #endif
        .fullScreenCover(isPresented: $wizardOpen) {
            ReviewWizardView(
                bookId: data.book.id,
                isFiction: data.book.isFiction,
                ratings: data.book.ratings,
                onSaved: onReviewSaved
            )
        }
    }
}

// ── Summary quote card — book-summary.tsx frosted card ──
private struct SummaryQuoteCard: View {
    let summary: String

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Text(summary)
                .font(Theme.body(17))
                .foregroundStyle(Theme.foreground.opacity(0.92))
                .lineSpacing(5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(22)
                .padding(.trailing, 30)
            Text("\u{201D}")
                .font(Theme.heading(90, .bold))
                .foregroundStyle(Theme.foreground.opacity(0.07))
                .offset(x: -6, y: 34)
        }
        .background(.white.opacity(0.05))
        // Web mobile: rounded-r-2xl + pl-[calc(50vw-50%+1rem)] — the card
        // bleeds off the LEFT screen edge; only right corners round.
        .clipShape(UnevenRoundedRectangle(
            topLeadingRadius: 0, bottomLeadingRadius: 0,
            bottomTrailingRadius: 16, topTrailingRadius: 16))
        .padding(.leading, -20)   // cancel the page gutter → full-bleed left
    }
}

// ── What's Inside — content-profile.tsx, spoiler gate + 2-col grid ──
private struct WhatsInsideSection: View {
    let ratings: [ContentRating]
    @State private var revealed = false
    @State private var expanded: Set<String> = []

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading("What's Inside")

            ZStack {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 22) {
                    ForEach(ratings) { rating in
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
                Text(rating.categoryName)
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(Theme.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 2)
                if rating.evidenceLevel == "human_verified" {
                    Text("Verified")
                        .font(Theme.body(10, .medium))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Theme.accent.opacity(0.12), in: Capsule())
                }
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
