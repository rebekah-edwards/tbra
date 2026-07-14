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
    private var task: Task<Void, Never>?

    func queryChanged() {
        task?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; external = []; searching = false; return }
        searching = true
        task = Task {
            // Debounce as-you-type like the web client
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let found = (try? await APIClient.shared.search(q)) ?? []
            guard !Task.isCancelled else { return }
            results = found
            searching = false
            // Local-first, ISBNdb fallback: supplement when local < 5
            // (same trigger as the web search page).
            if found.count < 5 {
                struct Res: Codable { let ok: Bool; let results: [ExternalResult] }
                let res: Res? = try? await APIClient.shared.get(
                    "/api/v1/search/external", query: [URLQueryItem(name: "q", value: q)])
                guard !Task.isCancelled else { return }
                external = res?.results ?? []
            } else {
                external = []
            }
        }
    }
}

struct SearchRootView: View {
    @Environment(\.dismiss) private var dismiss
    var initialQuery: String? = nil

    var body: some View {
        NavigationStack {
            SearchView(onClose: { dismiss() }, initialQuery: initialQuery)
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
        }
    }
}

struct SearchView: View {
    let onClose: () -> Void
    /// Pre-filled by the floating overlay's "See more results" hand-off.
    var initialQuery: String? = nil
    @State private var model = SearchModel()
    @FocusState private var fieldFocused: Bool

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
                                SearchResultCard(result: result)
                            }
                        }
                    } else if model.query.trimmingCharacters(in: .whitespaces).count >= 2 && model.external.isEmpty {
                        Text("No matches in the library yet.")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
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
                                ExternalResultCard(result: result)
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .floatingBack()
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
    @State private var state: String?      // seeded from the server, updated optimistically

    init(result: SearchResult) {
        self.result = result
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: BookRoute(idOrSlug: result.slug ?? result.id)) {
                HStack(alignment: .top, spacing: 14) {
                    CoverThumb(url: result.coverImageUrl, width: 74, height: 111, radius: 8)
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
                            if state == value { Text("✓").foregroundStyle(Theme.accent) }
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
            try? await APIClient.shared.setReadingState(bookId: result.id, state: "none")
            state = nil
        } else {
            try? await APIClient.shared.setReadingState(bookId: result.id, state: "tbr")
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
            try? await APIClient.shared.setReadingState(bookId: result.id, state: "none")
            state = nil
        } else {
            try? await APIClient.shared.setReadingState(bookId: result.id, state: value)
            state = value
        }
    }

    private func setState(_ value: String, date: String?, precision: String?) async {
        busy = true; defer { busy = false }
        try? await APIClient.shared.setReadingState(
            bookId: result.id, state: value,
            completionDate: date, completionPrecision: precision
        )
        state = value
    }
}


// External (ISBNdb) result — importing happens on first state selection:
// POST /search/import creates the book (+ background enrichment), then the
// normal reading-state endpoint runs. Mirrors setBookStateWithImport.
private struct ExternalResultCard: View {
    let result: ExternalResult
    @State private var importedBookId: String?
    @State private var state: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                CoverThumb(url: result.coverUrl, width: 74, height: 111, radius: 8)
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
                        let bookId: String
                        if let importedBookId {
                            bookId = importedBookId
                        } else {
                            struct Body: Codable, Sendable {
                                let isbn: String; let title: String; let authors: [String]
                                let coverUrl: String?; let publicationYear: Int?; let pages: Int?
                            }
                            struct Ok: Codable { let ok: Bool; let bookId: String }
                            guard let res: Ok = try? await APIClient.shared.request(
                                "/api/v1/search/import", method: "POST",
                                json: Body(isbn: result.isbn, title: result.title, authors: result.authors,
                                           coverUrl: result.coverUrl, publicationYear: result.publicationYear,
                                           pages: result.pages)) else { return }
                            importedBookId = res.bookId
                            bookId = res.bookId
                        }
                        try? await APIClient.shared.setReadingState(bookId: bookId, state: state == nil ? "tbr" : "none")
                        state = state == nil ? "tbr" : nil
                    }
                } label: {
                    HStack(spacing: 5) {
                        if busy {
                            ProgressView().tint(state != nil ? .black : Theme.foreground).scaleEffect(0.7)
                        } else if state == nil {
                            Image(systemName: "plus").font(.system(size: 12, weight: .semibold))
                        }
                        Text(state == nil ? "Add to tbr*a" : "On your TBR ✓")
                            .font(Theme.body(14, .medium))
                    }
                    .foregroundStyle(state != nil ? .black : Theme.foreground)
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(state != nil ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.accent.opacity(0.2)))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Theme.accent.opacity(state != nil ? 1 : 0.6), lineWidth: 1.5))
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
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
    @State private var debounce: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { close() }

            VStack(spacing: 8) {
                pill
                if trimmed.count >= 2 { resultsPanel }
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
        .background(Theme.surface, in: Capsule())
        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 16, y: 6)
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
                    if res.books.isEmpty && res.series.isEmpty && res.authors.isEmpty && !searching {
                        Text("No books found")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .padding(.vertical, 20)
                    }
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
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 16, y: 6)
    }

    private func bookRow(_ book: Res.Book) -> some View {
        Button {
            onOpenBook(book.slug ?? book.id)
            close()
        } label: {
            HStack(spacing: 12) {
                CoverThumb(url: book.coverImageUrl, width: 40, height: 60, radius: 5)
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
        guard q.count >= 2 else { res = nil; return }
        debounce = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            searching = true
            defer { searching = false }
            do {
                let r: Res = try await APIClient.shared.get(
                    "/api/v1/search/unified", query: [URLQueryItem(name: "q", value: q)])
                if !Task.isCancelled { res = r }
            } catch {
                NSLog("TBRA-DEBUG overlay search failed: %@", String(describing: error))
            }
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
    }
}
