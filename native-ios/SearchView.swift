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

@MainActor
@Observable
final class SearchModel {
    var query = ""
    var results: [SearchResult] = []
    var searching = false
    private var task: Task<Void, Never>?

    func queryChanged() {
        task?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; searching = false; return }
        searching = true
        task = Task {
            // Debounce as-you-type like the web client
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let found = (try? await APIClient.shared.search(q)) ?? []
            guard !Task.isCancelled else { return }
            results = found
            searching = false
        }
    }
}

struct SearchRootView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            SearchView(onClose: { dismiss() })
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: BookRoute.self) { route in
                    BookDetailView(idOrSlug: route.idOrSlug)
                }
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
                    } else if model.query.trimmingCharacters(in: .whitespaces).count >= 2 {
                        Text("No matches in the library yet.")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 30)
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
            .buttonStyle(TapScaleButtonStyle())

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
            ) { date in
                Task { await setState(pendingCompleteState, date: date) }
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

    private func setState(_ value: String, date: String?) async {
        busy = true; defer { busy = false }
        try? await APIClient.shared.setReadingState(
            bookId: result.id, state: value,
            completionDate: date, completionPrecision: date != nil ? "exact" : nil
        )
        state = value
    }
}
