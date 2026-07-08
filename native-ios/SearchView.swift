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

    var body: some View {
        NavigationStack {
            SearchView(onClose: { dismiss() })
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
        }
    }
}

struct SearchView: View {
    let onClose: () -> Void
    @State private var model = SearchModel()
    @FocusState private var fieldFocused: Bool

    var body: some View {
        ZStack {
            AmbientBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 16) {
                        Button(action: onClose) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.foreground.opacity(0.9))
                                .frame(width: 40, height: 40)
                                .background(.black.opacity(0.35), in: Circle())
                                .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                        }
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
        .onAppear {
            fieldFocused = true
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
