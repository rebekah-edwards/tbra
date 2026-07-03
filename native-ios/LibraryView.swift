import SwiftUI

// My Library — recreates /library (library-client.tsx): header + stats,
// the My Shelves row card, the TBR/Activity/Owned segmented control,
// per-group sub-filter chips with counts, and the 3-column book grid.
// Grouping/filter/sort logic is ported line-for-line from the web client.
//
// Deferred (manifest): the advanced Filters expander (year/genre/rating/
// format) and sort menu — the "Filters ⌄" row renders as the entry point.

struct ShelvesListRoute: Hashable {}

struct LibraryRootView: View {
    var body: some View {
        NavigationStack {
            LibraryView()
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: ShelvesListRoute.self) { _ in
                    LibraryShelvesView()
                }
                .navigationDestination(for: String.self) { shelfId in
                    ShelfDetailView(shelfId: shelfId)
                }
                .navigationDestination(for: BookRoute.self) { route in
                    BookDetailView(idOrSlug: route.idOrSlug)
                }
        }
    }
}

@MainActor
@Observable
final class LibraryModel {
    var books: [LibraryBook] = []
    var error: String?
    var loading = false

    func load() async {
        loading = true; defer { loading = false }
        do { books = try await APIClient.shared.library() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load your library." }
    }
}

struct LibraryView: View {
    @State private var model = LibraryModel()
    @State private var group: Group = .tbr
    @State private var subFilter = "all"

    enum Group: String, CaseIterable {
        case tbr = "TBR", activity = "Activity", owned = "Owned"
    }

    // SUB_FILTERS from library-client.tsx
    private var subFilters: [(key: String, label: String)] {
        switch group {
        case .activity:
            return [("currently_reading", "Current Read"), ("completed", "Finished"),
                    ("paused", "Paused"), ("dnf", "DNF")]
        case .tbr:
            return [("all", "All"), ("owned", "Owned"), ("not_owned", "Not Owned"),
                    ("fiction", "Fiction"), ("nonfiction", "Non-Fiction")]
        case .owned:
            return [("all", "All"), ("hardcover", "Hardcover"), ("paperback", "Paperback"),
                    ("ebook", "eBook"), ("audiobook", "Audiobook")]
        }
    }

    private var columns: [GridItem] {
        [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                // My Shelves row card
                NavigationLink(value: ShelvesListRoute()) {
                    HStack(spacing: 12) {
                        Image(systemName: "books.vertical.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.accent)
                        Text("My Shelves")
                            .font(Theme.body(17, .semibold))
                            .foregroundStyle(Theme.foreground)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
                }
                .buttonStyle(TapScaleButtonStyle())

                groupSegments
                subFilterChips
                filtersRow

                content
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 40)
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onChange(of: group) { subFilter = group == .activity ? "currently_reading" : "all" }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("My Library")
                .font(Theme.heading(26, .bold))
                .foregroundStyle(Theme.foreground)
            Spacer()
            Text("\(ownedCount) owned · \(readCount) read · \(tbrCount) tbr")
                .font(Theme.body(12))
                .foregroundStyle(Theme.muted)
        }
    }

    private var ownedCount: Int { model.books.filter { !$0.ownedFormats.isEmpty }.count }
    private var readCount: Int { model.books.filter { $0.state == "completed" }.count }
    private var tbrCount: Int { model.books.filter { $0.state == "tbr" }.count }

    private var groupSegments: some View {
        HStack(spacing: 4) {
            ForEach(Group.allCases, id: \.self) { g in
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { group = g }
                } label: {
                    Text(g.rawValue)
                        .font(Theme.body(16, group == g ? .bold : .medium))
                        .foregroundStyle(group == g ? .black : Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(group == g ? Theme.accent : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(4)
        .background(Theme.surfaceAlt.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var subFilterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(subFilters, id: \.key) { key, label in
                    let active = subFilter == key
                    let count = countFor(key)
                    Button {
                        subFilter = key
                    } label: {
                        HStack(spacing: 6) {
                            Text(label)
                                .font(Theme.body(15, .medium))
                                .foregroundStyle(active ? Theme.neonBlue : Theme.muted)
                            Text("\(count)")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.muted.opacity(0.7))
                        }
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .background(Capsule().stroke(active ? Theme.neonBlue : Theme.border,
                                                     lineWidth: active ? 1.5 : 1))
                        .background((active ? Theme.neonBlue.opacity(0.08) : Theme.surfaceAlt.opacity(0.4)), in: Capsule())
                    }
                }
            }
        }
    }

    private var filtersRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 14))
            Text("Filters")
                .font(Theme.body(16))
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(Theme.muted)
    }

    @ViewBuilder private var content: some View {
        let books = filteredBooks
        if books.isEmpty && !model.loading {
            VStack(spacing: 10) {
                Text("Nothing here yet.")
                    .font(Theme.body(17))
                    .foregroundStyle(Theme.muted)
                Text("Find books to add")
                    .font(Theme.body(17, .medium))
                    .foregroundStyle(Theme.accent)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 60)
            .background(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
                ForEach(books) { book in
                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                        LibraryBookCard(book: book)
                    }
                    .buttonStyle(TapScaleButtonStyle())
                }
            }
        }
    }

    // filterBooks() from library-client.tsx, ported 1:1 (default sort: "recent")
    private var filteredBooks: [LibraryBook] {
        Self.filter(model.books, group: group, subFilter: subFilter)
    }

    private func countFor(_ key: String) -> Int {
        Self.filter(model.books, group: group, subFilter: key).count
    }

    private static func filter(_ books: [LibraryBook], group: Group, subFilter: String) -> [LibraryBook] {
        let sorted = books.sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
        switch group {
        case .activity:
            return sorted.filter { $0.state == subFilter }
        case .tbr:
            let tbr = sorted.filter { $0.state == "tbr" }
            switch subFilter {
            case "owned": return tbr.filter { !$0.ownedFormats.isEmpty }
            case "not_owned": return tbr.filter { $0.ownedFormats.isEmpty }
            case "fiction": return tbr.filter { $0.isFiction == true }
            case "nonfiction": return tbr.filter { $0.isFiction == false }
            default: return tbr
            }
        case .owned:
            let owned = sorted.filter { !$0.ownedFormats.isEmpty }
            if subFilter == "all" { return owned }
            return owned.filter { $0.ownedFormats.contains(subFilter) }
        }
    }
}

// The library grid card — BookCard with the library-specific accents:
// square aspect when the book is being actively read as an audiobook.
private struct LibraryBookCard: View {
    let book: LibraryBook

    private var isAudiobookActive: Bool {
        (book.state == "currently_reading" || book.state == "paused")
            && book.activeFormats == ["audiobook"]
    }

    var body: some View {
        GeometryReader { geo in
            CoverThumb(url: book.coverImageUrl,
                       width: geo.size.width,
                       height: isAudiobookActive ? geo.size.width : geo.size.width * 1.5,
                       radius: 10)
                .overlay(alignment: .bottomTrailing) {
                    if let rating = book.userRating, rating > 0 {
                        Text("\(String(format: "%.1f", rating)) ★")
                            .font(Theme.body(10, .medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.black.opacity(0.7), in: Capsule())
                            .padding(5)
                    }
                }
        }
        .aspectRatio(isAudiobookActive ? 1 : 2 / 3, contentMode: .fit)
    }
}
