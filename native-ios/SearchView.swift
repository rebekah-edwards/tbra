import SwiftUI

// Search — recreates /search (search-client.tsx): heading + subtitle,
// query field, "IN TBR*A LIBRARY" results with bordered cards (cover,
// title, author, year · pages) and the compact reading-state split pill
// + Owned pill. Local-first FTS via /api/v1/search; tapping a card opens
// the book page.
//
// Deferred (manifest): the ISBNdb external supplement + import-from-
// external flow ("MORE RESULTS" section on the web when local < 5).

/// Environment action so any screen (top bar, "Find books to add" links)
/// can open search without plumbing state through the tab tree.
struct OpenSearchKey: EnvironmentKey {
    static let defaultValue: @MainActor () -> Void = {}
}
extension EnvironmentValues {
    var openSearch: @MainActor () -> Void {
        get { self[OpenSearchKey.self] }
        set { self[OpenSearchKey.self] = newValue }
    }
}

struct ExternalResult: Codable, Hashable, Identifiable {
    var id: String { isbn }
    let isbn: String
    let title: String
    let authors: [String]
    let publicationYear: Int?
    let pages: Int?
    let coverUrl: String?
}

@MainActor
@Observable
final class SearchModel {
    var query = ""
    var results: [SearchResult] = []
    var external: [ExternalResult] = []
    var searching = false
    /// The ISBNdb supplement runs AFTER the local pass resolves. It needs its
    /// own flag: reusing `searching` would hide the local hits while it ran,
    /// but leaving both false made the screen claim "No matches in the library
    /// yet" for the whole external round-trip — which is what a book that is
    /// only in the wider catalog looked like (punch list #5/#6, 2026-08-08).
    var loadingExternal = false
    private var task: Task<Void, Never>?

    func queryChanged() {
        task?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            results = []; external = []; searching = false; loadingExternal = false
            return
        }
        searching = true
        task = Task {
            // Debounce as-you-type like the web client
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { searching = false; return }
            let found = (try? await APIClient.shared.search(q)) ?? []
            guard !Task.isCancelled else { searching = false; return }
            results = found
            searching = false
            // Local-first, ISBNdb fallback: supplement when local < 5
            // (same trigger as the web search page).
            guard found.count < 5 else { external = []; return }
            external = []
            loadingExternal = true
            defer { loadingExternal = false }
            struct Res: Codable { let ok: Bool; let results: [ExternalResult] }
            let res: Res? = try? await APIClient.shared.get(
                "/api/v1/search/external", query: [URLQueryItem(name: "q", value: q)])
            guard !Task.isCancelled else { return }
            external = res?.results ?? []
        }
    }
}

struct SearchRootView: View {
    @Environment(\.dismiss) private var dismiss
    var initialQuery: String? = nil
    /// Books open through the shell's chromed book cover (2026-07-25) —
    /// pushing them inside this chrome-less cover left the logo/menu missing.
    var onOpenBook: ((String) -> Void)? = nil

    var body: some View {
        NavigationStack {
            SearchView(onClose: { dismiss() }, initialQuery: initialQuery, onOpenBook: onOpenBook)
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
        }
    }
}

struct SearchView: View {
    let onClose: () -> Void
    /// Pre-filled by the floating overlay's "See more results" hand-off.
    var initialQuery: String? = nil
    /// Provided by the shell: opens a book in the chromed book cover.
    /// Fallback (nil, e.g. previews): push inside this stack.
    var onOpenBook: ((String) -> Void)? = nil
    @State private var model = SearchModel()
    @FocusState private var fieldFocused: Bool
    /// Fallback-path route for when no onOpenBook closure is provided.
    @State private var importedRoute: BookRoute?

    private func openBook(_ idOrSlug: String) {
        if let onOpenBook {
            onOpenBook(idOrSlug)
        } else {
            importedRoute = BookRoute(idOrSlug: idOrSlug)
        }
    }

    var body: some View {
        ZStack {
            AmbientBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 16) {
                        Color.clear.frame(width: 40, height: 40)
                        Text("Search")
                            .font(Theme.heading(26, .bold))
                            .foregroundStyle(Theme.foreground)
                    }
                    .padding(.top, 14)

                    Text("Search for books by title, author, or series.")
                        .font(Theme.body(17))
                        .foregroundStyle(Theme.muted)

                    TextField("Title, author, or series", text: Bindable(model).query)
                        .focused($fieldFocused)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .brandedField()
                        .onChange(of: model.query) { model.queryChanged() }

                    if model.searching {
                        Text("Searching...")
                            .font(Theme.body(16))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 30)
                    } else if !model.results.isEmpty {
                        Text("IN TBR*A LIBRARY")
                            .font(Theme.body(13, .semibold))
                            .tracking(1.2)
                            .foregroundStyle(Theme.muted)
                            .padding(.top, 8)

                        VStack(spacing: 14) {
                            ForEach(model.results) { result in
                                SearchResultCard(result: result, onOpen: onOpenBook)
                            }
                        }
                    } else if model.query.trimmingCharacters(in: .whitespaces).count >= 2
                                && model.external.isEmpty && !model.loadingExternal {
                        Text("No matches in the library yet.")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 30)
                    }

                    if model.loadingExternal {
                        HStack(spacing: 8) {
                            ProgressView().tint(Theme.accent).scaleEffect(0.8)
                            Text("Searching the wider catalog...")
                                .font(Theme.body(15))
                                .foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 30)
                    }

                    if !model.external.isEmpty && !model.searching {
                        Text("MORE RESULTS")
                            .font(Theme.body(13, .semibold))
                            .tracking(1.2)
                            .foregroundStyle(Theme.muted)
                            .padding(.top, 8)
                        Text("From the wider catalog — adding one imports it to tbr*a.")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted.opacity(0.8))
                        VStack(spacing: 14) {
                            ForEach(model.external) { result in
                                ExternalResultCard(result: result) { bookId in
                                    openBook(bookId)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .floatingBack()
        .navigationDestination(item: $importedRoute) { route in
            BookDetailView(idOrSlug: route.idOrSlug)
                .modifier(PushedScreenChrome())
        }
        .onAppear {
            fieldFocused = true
            if let q = initialQuery, model.query.isEmpty {
                model.query = q
                model.queryChanged()
            }
            #if DEBUG && targetEnvironment(simulator)
            // Headless verification: pre-fill the query from the launch env.
            if let q = ProcessInfo.processInfo.environment["TBRA_DEBUG_QUERY"], model.query.isEmpty {
                model.query = q
                model.queryChanged()
            }
            #endif
        }
    }
}

// One result card — cover, meta, compact state pill + Owned pill.
private struct SearchResultCard: View {
    let result: SearchResult
    /// When set, opens via the shell's chromed book cover instead of a
    /// chrome-less push inside the search cover (2026-07-25).
    var onOpen: ((String) -> Void)? = nil
    @State private var state: String?      // seeded from the server, updated optimistically

    init(result: SearchResult, onOpen: ((String) -> Void)? = nil) {
        self.result = result
        self.onOpen = onOpen
        _state = State(initialValue: result.state)
    }
    @State private var dropdownOpen = false
    @State private var showDatePicker = false
    @State private var pendingCompleteState = "completed"
    @State private var busy = false

    private let states: [(String, String)] = [
        ("tbr", "To Read"), ("currently_reading", "Reading Now"),
        ("completed", "Finished"), ("paused", "Paused"), ("dnf", "DNF"),
    ]

    private var stateLabel: String {
        switch state {
        case "tbr": return "To Read"
        case "currently_reading": return "Reading Now"
        case "completed": return "Finished"
        case "paused": return "Paused"
        case "dnf": return "DNF"
        default: return "To Read"
        }
    }

    @ViewBuilder
    private func rowLink<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        if let onOpen {
            Button { onOpen(result.slug ?? result.id) } label: { label() }
        } else {
            NavigationLink(value: BookRoute(idOrSlug: result.slug ?? result.id)) { label() }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            rowLink {
                HStack(alignment: .top, spacing: 14) {
                    CoverThumb(url: result.coverImageUrl, width: 74, height: 111, radius: 8, title: result.title)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(result.title)
                            .font(Theme.body(18, .bold))
                            .foregroundStyle(Theme.foreground)
                            .multilineTextAlignment(.leading)
                        Text(result.authors.joined(separator: ", "))
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            if let year = result.publicationYear { Text(String(year)) }
                            if let pages = result.pages { Text("·"); Text("\(pages) pp") }
                        }
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted.opacity(0.8))
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
            }

            // Compact action row (reading-state-button.tsx compact mode)
            HStack(spacing: 10) {
                compactStatePill
                if result.ownedCount > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "books.vertical")
                            .font(.system(size: 12))
                        Text(result.ownedCount == 1 ? "Owned" : "Owned · \(result.ownedCount)")
                            .font(Theme.body(14, .medium))
                    }
                    .foregroundStyle(Theme.neonPurple)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Capsule().stroke(Theme.neonPurple.opacity(0.35), lineWidth: 1.5))
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
            .overlay(alignment: .topLeading) { dropdown }
        }
        .background(Theme.surface.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
        .zIndex(dropdownOpen ? 40 : 0)
        .opacity(busy ? 0.6 : 1)
        .sheet(isPresented: $showDatePicker) {
            CompletionDateSheet(
                title: pendingCompleteState == "dnf" ? "When did you stop reading?" : "When did you finish?"
            ) { date, precision in
                Task { await setState(pendingCompleteState, date: date, precision: precision) }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
    }

    private var isActive: Bool { state != nil }

    private var compactStatePill: some View {
        HStack(spacing: 0) {
            Button {
                Task { await mainTap() }
            } label: {
                HStack(spacing: 5) {
                    if !isActive { Image(systemName: "bookmark").font(.system(size: 12, weight: .semibold)) }
                    Text(stateLabel)
                        .font(Theme.body(14, .medium))
                }
                .foregroundStyle(isActive ? .black : Theme.foreground)
                .padding(.horizontal, 16).padding(.vertical, 9)
            }
            Rectangle()
                .fill(isActive ? .black.opacity(0.2) : Theme.accent.opacity(0.4))
                .frame(width: 1, height: 20)
            Button {
                withAnimation(.easeOut(duration: 0.12)) { dropdownOpen.toggle() }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(isActive ? .black : Theme.foreground)
                    .padding(.horizontal, 10).padding(.vertical, 11)
            }
        }
        .background(isActive ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.accent.opacity(0.2)))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Theme.accent.opacity(isActive ? 1 : 0.6), lineWidth: 1.5))
    }

    @ViewBuilder private var dropdown: some View {
        if dropdownOpen {
            VStack(spacing: 0) {
                ForEach(states, id: \.0) { value, label in
                    Button {
                        dropdownOpen = false
                        Task { await selectState(value) }
                    } label: {
                        HStack {
                            Text(label)
                                .font(Theme.body(13, .medium))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                            if state == value { Text("✓").foregroundStyle(Theme.accentText) }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(state == value ? Theme.accent.opacity(0.15) : .clear)
                    }
                    if value != "dnf" { Divider().background(Theme.border.opacity(0.5)) }
                }
            }
            .frame(width: 180)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 12, y: 4)
            .offset(y: 42)
        }
    }

    private func mainTap() async {
        busy = true; defer { busy = false }
        if isActive {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: result.id, state: "none")
            }
            state = nil
        } else {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: result.id, state: "tbr")
            }
            state = "tbr"
        }
    }

    private func selectState(_ value: String) async {
        if (value == "completed" || value == "dnf") && state != value {
            pendingCompleteState = value
            showDatePicker = true
            return
        }
        busy = true; defer { busy = false }
        if state == value {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: result.id, state: "none")
            }
            state = nil
        } else {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: result.id, state: value)
            }
            state = value
        }
    }

    private func setState(_ value: String, date: String?, precision: String?) async {
        busy = true; defer { busy = false }
        await ReadingStateAlert.shared.perform {
            try await APIClient.shared.setReadingState(
            bookId: result.id, state: value,
            completionDate: date, completionPrecision: precision
            )
        }
        state = value
    }
}


// External (ISBNdb) result — "Add to tbr*a" imports the book (POST
// /search/import creates the row + kicks background enrichment) and then
// navigates INTO the book page, which shows the enrichment wait overlay
// until content details land. No reading state is set — shelving is the
// user's explicit choice on the book page (user request 2026-07-25; the
// old flow silently added to the TBR and dead-ended in search).
private struct ExternalResultCard: View {
    let result: ExternalResult
    let onImported: (String) -> Void
    @State private var importedBookId: String?
    @State private var busy = false
    @State private var importError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                CoverThumb(url: result.coverUrl, width: 74, height: 111, radius: 8, title: result.title)
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.title)
                        .font(Theme.body(18, .bold))
                        .foregroundStyle(Theme.foreground)
                        .multilineTextAlignment(.leading)
                    Text(result.authors.joined(separator: ", "))
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        if let year = result.publicationYear { Text(String(year)) }
                        if let pages = result.pages { Text("·"); Text("\(pages) pp") }
                    }
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(14)

            HStack(spacing: 10) {
                Button {
                    guard !busy else { return }
                    busy = true
                    Task {
                        defer { busy = false }
                        if let importedBookId {
                            onImported(importedBookId)
                            return
                        }
                        struct Body: Codable, Sendable {
                            let isbn: String; let title: String; let authors: [String]
                            let coverUrl: String?; let publicationYear: Int?; let pages: Int?
                        }
                        struct Ok: Codable { let ok: Bool; let bookId: String }
                        do {
                            let res: Ok = try await APIClient.shared.request(
                                "/api/v1/search/import", method: "POST",
                                json: Body(isbn: result.isbn, title: result.title, authors: result.authors,
                                           coverUrl: result.coverUrl, publicationYear: result.publicationYear,
                                           pages: result.pages))
                            importedBookId = res.bookId
                            onImported(res.bookId)
                        } catch {
                            // Was `try?` + a bare return: a failed import left
                            // the button looking tapped-but-dead with no
                            // explanation (punch list #7).
                            importError = (error as? APIError)?.errorDescription
                                ?? "Couldn't add that book. Please try again."
                        }
                    }
                } label: {
                    HStack(spacing: 5) {
                        if busy {
                            ProgressView().tint(Theme.foreground).scaleEffect(0.7)
                        } else {
                            Image(systemName: importedBookId == nil ? "plus" : "book")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        Text(importedBookId == nil ? "Add to tbr*a" : "View book")
                            .font(Theme.body(14, .medium))
                    }
                    .foregroundStyle(Theme.foreground)
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(AnyShapeStyle(Theme.accent.opacity(0.2)))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Theme.accent.opacity(0.6), lineWidth: 1.5))
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)

            if let importError {
                Text(importError)
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(Theme.destructive)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 12)
            }
        }
        .background(Theme.surface.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border.opacity(0.7), lineWidth: 1))
    }
}

// ── Floating search overlay — web nav search-bar.tsx parity (2026-07-15) ──
// The search icon opens THIS (pill + grouped quick results over a dimmed
// backdrop), not a full page. The footer and Return key hand off to the
// full SearchRootView cover for deep results + external add.

struct FloatingSearchOverlay: View {
    @Binding var open: Bool
    let onOpenBook: (String) -> Void
    let onOpenSeries: (String) -> Void
    let onOpenAuthor: (String) -> Void
    let onFullSearch: (String) -> Void

    struct Res: Codable {
        struct Hit: Codable { let id: String; let name: String; let bookCount: Int }
        struct Book: Codable {
            let id: String; let slug: String?; let title: String
            let coverImageUrl: String?; let authors: [String]
            let publicationYear: Int?; let state: String?
        }
        let ok: Bool
        let books: [Book]
        let series: [Hit]
        let authors: [Hit]
        let sectionOrder: [String]
    }

    @State private var query = ""
    @State private var res: Res?
    @State private var searching = false
    /// The dropdown used to query ONLY the local index, so it could never
    /// surface a book tbr*a didn't already have — "the dropdown feels useless"
    /// (punch list #6, 2026-08-08). It now supplements thin local results with
    /// the same ISBNdb pass the full search page uses; tapping one hands off
    /// to full search, which owns the import flow.
    @State private var external: [ExternalResult] = []
    @State private var loadingExternal = false
    @State private var debounce: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { close() }

            // GlassEffectContainer lets the pill + dropdown render as sibling
            // Liquid Glass shapes that blend when close (iOS 26 design
            // language — user request 2026-07-25 replacing the opaque
            // web-styled surfaces).
            GlassEffectContainer(spacing: 8) {
                VStack(spacing: 8) {
                    pill
                    if trimmed.count >= 2 { resultsPanel }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
        .onAppear { focused = true }
    }

    private var pill: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.muted)
            TextField("Search books, authors, series...", text: $query)
                .font(Theme.body(16))
                .foregroundStyle(Theme.foreground)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .onSubmit { if trimmed.count >= 2 { handOff() } }
                .onChange(of: query) { runSearch() }
            if searching {
                ProgressView().tint(Theme.accent).scaleEffect(0.8)
            } else if !query.isEmpty {
                Button {
                    query = ""; res = nil
                    external = []; loadingExternal = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.muted.opacity(0.7))
                }
            }
            Button("Cancel") { close() }
                .font(Theme.body(12, .medium))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16).padding(.vertical, 13)
        // Liquid Glass (was opaque Theme.surface + border): the material
        // supplies its own edge highlight and depth — no stroke/shadow.
        .glassEffect(.regular, in: Capsule())
    }

    private var resultsPanel: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let res {
                    ForEach(res.sectionOrder, id: \.self) { section in
                        switch section {
                        case "books": ForEach(res.books, id: \.id) { bookRow($0) }
                        case "series": ForEach(res.series, id: \.id) { hitRow($0, kind: "series") }
                        case "authors": ForEach(res.authors, id: \.id) { hitRow($0, kind: "author") }
                        default: EmptyView()
                        }
                    }
                    if res.books.isEmpty && res.series.isEmpty && res.authors.isEmpty
                        && !searching && !loadingExternal && external.isEmpty {
                        Text("No books found")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .padding(.vertical, 20)
                    }
                }

                if loadingExternal {
                    HStack(spacing: 8) {
                        ProgressView().tint(Theme.accent).scaleEffect(0.7)
                        Text("Searching the wider catalog...")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }

                if !external.isEmpty {
                    Text("NOT IN TBR*A YET — TAP TO ADD")
                        .font(Theme.body(10, .semibold))
                        .tracking(1.0)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 6)
                    ForEach(external) { externalRow($0) }
                }

                Button { handOff() } label: {
                    Text("See more results or add a book")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .overlay(alignment: .top) { Divider().background(Theme.border.opacity(0.5)) }
            }
        }
        .frame(maxHeight: UIScreen.main.bounds.height * 0.55)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        // Liquid Glass dropdown, matching the pill (was opaque surface).
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16))
    }

    /// A wider-catalog hit. Tapping hands off to the full search page with the
    /// query intact — that screen owns the tested "Add to tbr*a" import flow,
    /// so the dropdown doesn't need a second copy of it.
    private func externalRow(_ result: ExternalResult) -> some View {
        Button { handOff() } label: {
            HStack(spacing: 12) {
                CoverThumb(url: result.coverUrl, width: 40, height: 60, radius: 5, title: result.title)
                VStack(alignment: .leading, spacing: 2) {
                    Text(result.title)
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Text([result.authors.prefix(2).joined(separator: ", "),
                          result.publicationYear.map(String.init) ?? ""]
                        .filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                Spacer()
                Text("Add")
                    .font(Theme.body(10, .semibold))
                    .foregroundStyle(Theme.onAccent)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Theme.accent, in: Capsule())
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .overlay(alignment: .bottom) { Divider().background(Theme.border.opacity(0.35)) }
    }

    private func bookRow(_ book: Res.Book) -> some View {
        Button {
            onOpenBook(book.slug ?? book.id)
            close()
        } label: {
            HStack(spacing: 12) {
                CoverThumb(url: book.coverImageUrl, width: 40, height: 60, radius: 5, title: book.title)
                VStack(alignment: .leading, spacing: 2) {
                    Text(book.title)
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Text([book.authors.prefix(2).joined(separator: ", "),
                          book.publicationYear.map(String.init) ?? ""]
                        .filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                Spacer()
                if let state = book.state, let label = Self.stateLabels[state] {
                    Text(label)
                        .font(Theme.body(10, .medium))
                        .foregroundStyle(Theme.accentText)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Theme.accent.opacity(0.12), in: Capsule())
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.muted.opacity(0.5))
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .overlay(alignment: .bottom) { Divider().background(Theme.border.opacity(0.35)) }
    }

    private func hitRow(_ hit: Res.Hit, kind: String) -> some View {
        Button {
            if kind == "series" { onOpenSeries(hit.id) } else { onOpenAuthor(hit.id) }
            close()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 5)
                        .fill((kind == "series" ? Theme.accent : Theme.neonBlue).opacity(0.1))
                    Image(systemName: kind == "series" ? "books.vertical" : "person")
                        .font(.system(size: 15))
                        .foregroundStyle(kind == "series" ? Theme.accentText : Theme.neonBlue)
                }
                .frame(width: 40, height: 60)
                VStack(alignment: .leading, spacing: 2) {
                    Text(hit.name)
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Text("\(hit.bookCount) book\(hit.bookCount == 1 ? "" : "s")\(kind == "series" ? " in series" : "")")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.muted.opacity(0.5))
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .overlay(alignment: .bottom) { Divider().background(Theme.border.opacity(0.35)) }
    }

    private static let stateLabels: [String: String] = [
        "completed": "Finished", "currently_reading": "Reading",
        "tbr": "TBR", "paused": "Paused", "dnf": "DNF",
    ]

    private func runSearch() {
        debounce?.cancel()
        let q = trimmed
        guard q.count >= 2 else { res = nil; external = []; loadingExternal = false; return }
        debounce = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            searching = true
            var local: Res?
            do {
                local = try await APIClient.shared.get(
                    "/api/v1/search/unified", query: [URLQueryItem(name: "q", value: q)])
                if !Task.isCancelled, let local { res = local }
            } catch {
                NSLog("TBRA-DEBUG overlay search failed: %@", String(describing: error))
            }
            searching = false
            guard !Task.isCancelled else { return }

            // Supplement only when the local index came back thin. The ISBNdb
            // search budget is shared (2,000/day across web + native), so this
            // deliberately does NOT fire on every keystroke-length query.
            let localBooks = local?.books.count ?? 0
            guard q.count >= 4, localBooks < 3 else { external = []; return }
            external = []
            loadingExternal = true
            defer { loadingExternal = false }
            struct ExtRes: Codable { let ok: Bool; let results: [ExternalResult] }
            let ext: ExtRes? = try? await APIClient.shared.get(
                "/api/v1/search/external", query: [URLQueryItem(name: "q", value: q)])
            guard !Task.isCancelled else { return }
            external = Array((ext?.results ?? []).prefix(4))
        }
    }

    private func handOff() {
        let q = trimmed
        close()
        onFullSearch(q)
    }

    private func close() {
        open = false
        query = ""; res = nil
        external = []; loadingExternal = false
    }
}
