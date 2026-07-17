import SwiftUI
import Observation

// Shelf detail — recreates /u/[username]/shelves/[slug] (shelf-view-client):
// back chevron + bold shelf name + "by <owner>" (links to the profile),
// share icon, shelf-color dot + book count, Shelf Order sort menu, Filters
// expander (genre + ownership), ✎ Edit (owner), then the shelf-tinted
// bookcase: rows of 3 covers with a floating plank under each row.

@MainActor
@Observable
final class ShelfDetailModel {
    let shelfId: String
    var shelf: ShelfDetail?
    var books: [ShelfBook] = []
    var error: String?
    var loading = false

    init(shelfId: String) { self.shelfId = shelfId }

    func load() async {
        loading = true; defer { loading = false }
        do {
            let detail = try await APIClient.shared.shelf(id: shelfId)
            shelf = detail
            books = detail.books
        } catch {
            guard !APIError.isCancellation(error) else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load shelf."
        }
    }

    /// Persist the COMPLETE current book order for this shelf.
    func persistOrder() {
        let ids = books.map(\.bookId)
        Task {
            do { try await APIClient.shared.reorderShelfBooks(shelfId: shelfId, bookIds: ids) }
            catch { await load() }
        }
    }

    func remove(bookId: String) {
        books.removeAll { $0.bookId == bookId }
        Task { try? await APIClient.shared.removeBook(fromShelf: shelfId, bookId: bookId) }
    }
}

struct ShelfDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    let route: ShelfRoute
    @State private var model: ShelfDetailModel
    @State private var dragging: ShelfBook?

    // SORT_OPTIONS from shelf-view-client.tsx
    enum ShelfSort: String, CaseIterable {
        case position = "Shelf Order"
        case dateAdded = "Date Added"
        case title = "Title"
        case author = "Author"
        case userRating = "Your Rating"
        case overallRating = "Overall Rating"
        case pubYear = "Pub Year"
        case pages = "Pages"
    }
    @State private var sort: ShelfSort = .position
    @State private var filtersOpen = false
    @State private var genreFilter: String?
    @State private var ownershipFilter: String?   // "owned" | "unowned"

    init(route: ShelfRoute) {
        self.route = route
        _model = State(initialValue: ShelfDetailModel(shelfId: route.shelfId))
    }

    /// Following-tab shelves are someone else's — no edit/reorder.
    private var isOwner: Bool { route.ownerName == nil }

    /// Shelf accent — the web tints the whole page with the shelf color.
    private var tint: Color {
        if let hex = model.shelf?.color, hex.hasPrefix("#"), hex.count == 7 {
            return Color(hex: String(hex.dropFirst()))
        }
        return Theme.accent
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                countRow
                controlsRow
                if filtersOpen { filtersPanel }
                bookcase
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .tracksScrollAtTop()
        .floatingBack(topPadding: 14)
        .overlay(alignment: .topTrailing) {
            if let shelf = model.shelf, shelf.isPublic, let username = shelf.ownerUsername,
               let url = URL(string: "https://thebasedreader.app/u/\(username)/shelves/\(shelf.slug)") {
                ShareLink(item: url) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 18))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 44, height: 44)
                }
                .padding(.trailing, 16)
                .padding(.top, 12)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onAppear {
            // Refresh when returning from the pushed editor (the .task
            // above only fires on first appearance).
            if model.shelf != nil { Task { await model.load() } }
        }
    }

    private var ownerName: String {
        if let name = route.ownerName { return name }
        if let shelf = model.shelf {
            if let display = shelf.ownerDisplayName { return display }
            if let username = shelf.ownerUsername { return "@\(username)" }
        }
        if case .signedIn(let user) = auth.phase {
            return user.displayName ?? user.username ?? "you"
        }
        return "you"
    }

    /// Blue in light mode (lime is illegible on white), lime in dark.
    private let linkTint = Color(dark: "a3e635", light: "0ea5e9")

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            // Placeholder — real back button is the .floatingBack overlay.
            Color.clear.frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(model.shelf?.name ?? " ")
                    .font(Theme.heading(26, .bold))
                    .foregroundStyle(Theme.foreground)
                HStack(spacing: 4) {
                    Text("by")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                    if let username = model.shelf?.ownerUsername {
                        NavigationLink(value: UserRoute(username: username)) {
                            Text(ownerName)
                                .font(Theme.body(14, .medium))
                                .foregroundStyle(linkTint)
                        }
                    } else {
                        Text(ownerName)
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(linkTint)
                    }
                }
            }
            Spacer()
            // Placeholder — the tappable ShareLink is a screen-level overlay
            // (iOS 27 bug #4: top-strip buttons in scroll content go dead).
            Color.clear.frame(width: 36, height: 40)
        }
        .padding(.top, 14)
    }

    private var countRow: some View {
        HStack(spacing: 8) {
            Circle().fill(tint).frame(width: 10, height: 10)
            Text("\(displayBooks.count) book\(displayBooks.count == 1 ? "" : "s")")
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
        }
    }

    private var activeFilterCount: Int {
        (genreFilter != nil ? 1 : 0) + (ownershipFilter != nil ? 1 : 0)
    }

    private var controlsRow: some View {
        HStack(spacing: 10) {
            Menu {
                ForEach(ShelfSort.allCases, id: \.self) { key in
                    Button(key.rawValue) { sort = key }
                }
            } label: {
                HStack(spacing: 8) {
                    Text(sort.rawValue)
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.foreground)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            }

            Button {
                withAnimation(.easeOut(duration: 0.15)) { filtersOpen.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(.system(size: 12))
                    Text(activeFilterCount > 0 ? "Filters (\(activeFilterCount))" : "Filters")
                        .font(Theme.body(14, .medium))
                }
                .foregroundStyle(activeFilterCount > 0 ? Theme.accent : Theme.muted)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12).stroke(
                    activeFilterCount > 0 ? Theme.accent.opacity(0.3) : Theme.border, lineWidth: 1))
            }

            Spacer()

            if isOwner {
                // Straight into the FULL editor page (web
                // /library/shelves/[slug]): add books, reorder, notes,
                // rename/recolor, share, delete.
                NavigationLink(value: ShelfEditorRoute(shelfId: model.shelfId)) {
                    HStack(spacing: 5) {
                        Image(systemName: "pencil")
                            .font(.system(size: 13))
                        Text("Edit")
                            .font(Theme.body(15, .medium))
                    }
                    .foregroundStyle(linkTint)
                }
            }
        }
    }

    private var filtersPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !availableGenres.isEmpty {
                HStack(spacing: 10) {
                    Text("GENRE")
                        .font(Theme.body(10, .medium))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 48, alignment: .leading)
                    Menu {
                        Button("All Genres") { genreFilter = nil }
                        ForEach(availableGenres, id: \.self) { g in
                            Button(g) { genreFilter = g }
                        }
                    } label: {
                        menuValueLabel(genreFilter ?? "All Genres")
                    }
                }
            }
            HStack(spacing: 10) {
                Text("OWNED")
                    .font(Theme.body(10, .medium))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 48, alignment: .leading)
                Menu {
                    Button("All") { ownershipFilter = nil }
                    Button("Owned") { ownershipFilter = "owned" }
                    Button("Unowned") { ownershipFilter = "unowned" }
                } label: {
                    menuValueLabel(ownershipFilter == "owned" ? "Owned"
                                   : ownershipFilter == "unowned" ? "Unowned" : "All")
                }
            }
            if activeFilterCount > 0 {
                Button {
                    genreFilter = nil; ownershipFilter = nil
                } label: {
                    Text("Clear filters")
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.neonBlue)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surfaceAlt.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
    }

    private func menuValueLabel(_ value: String) -> some View {
        HStack(spacing: 6) {
            Text(value)
                .font(Theme.body(13))
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface.opacity(0.8))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
    }

    private var availableGenres: [String] {
        var counts: [String: Int] = [:]
        for book in model.books {
            for g in book.genres { counts[g, default: 0] += 1 }
        }
        return counts.sorted { $0.value > $1.value }.map(\.key)
    }

    // Filters + sort, ported from shelf-view-client.tsx.
    private var displayBooks: [ShelfBook] {
        var books = model.books
        if let g = genreFilter { books = books.filter { $0.genres.contains(g) } }
        if ownershipFilter == "owned" { books = books.filter { !$0.ownedFormats.isEmpty } }
        else if ownershipFilter == "unowned" { books = books.filter { $0.ownedFormats.isEmpty } }
        switch sort {
        case .position: return books.sorted { $0.position < $1.position }
        case .dateAdded: return books.sorted { $0.addedAt > $1.addedAt }
        case .title: return books.sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
        case .author: return books.sorted { ($0.authors.first ?? "").localizedCompare($1.authors.first ?? "") == .orderedAscending }
        case .userRating: return books.sorted { ($0.userRating ?? 0) > ($1.userRating ?? 0) }
        case .overallRating: return books.sorted { ($0.aggregateRating ?? 0) > ($1.aggregateRating ?? 0) }
        case .pubYear: return books.sorted { ($0.publicationYear ?? 0) > ($1.publicationYear ?? 0) }
        case .pages: return books.sorted { ($0.pages ?? 9999) < ($1.pages ?? 9999) }
        }
    }

    /// Reordering only makes sense on the untouched custom order.
    private var canReorder: Bool {
        isOwner && sort == .position && activeFilterCount == 0
    }

    // The shelf-tinted bookcase — rows of 3, each with a floating plank
    // (web: bg accent06→10, border accent15, plank accent30→45 + 6pt gap).
    @ViewBuilder private var bookcase: some View {
        let books = displayBooks
        if books.isEmpty && !model.loading {
            Text(activeFilterCount > 0 ? "No books match your filters." : "This shelf is empty.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [5]))
                )
        } else {
            let rows: [[ShelfBook]] = stride(from: 0, to: books.count, by: 3).map {
                Array(books[$0..<min($0 + 3, books.count)])
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .top, spacing: 16) {
                        ForEach(row) { book in
                            bookCell(book)
                        }
                        // Keep 3-column widths on partial rows.
                        ForEach(0..<(3 - row.count), id: \.self) { _ in
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 10)

                    Rectangle()
                        .fill(LinearGradient(
                            colors: [tint.opacity(0.19), tint.opacity(0.27)],
                            startPoint: .top, endPoint: .bottom))
                        .frame(height: 5)
                    Color.clear.frame(height: 6)
                }
            }
            .background(
                LinearGradient(colors: [tint.opacity(0.024), tint.opacity(0.063)],
                               startPoint: .top, endPoint: .bottom)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(0.082), lineWidth: 1))
        }
    }

    @ViewBuilder private func bookCell(_ book: ShelfBook) -> some View {
        let cell = NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.bookId)) {
            BookOnShelfCell(book: book, ownerAvatarUrl: model.shelf?.ownerAvatarUrl)
        }
        if canReorder {
            cell
                .opacity(dragging?.id == book.id ? 0.4 : 1)
                .onDrag {
                    dragging = book
                    return NSItemProvider(object: book.bookId as NSString)
                }
                .onDrop(of: [.text], delegate: GridReorderDelegate(
                    item: book,
                    items: $model.books,
                    dragging: $dragging,
                    commit: { model.persistOrder() }
                ))
        } else {
            cell
        }
    }
}

// One book on the shelf (web BookOnShelf): cover with spine shadow +
// owner-avatar rating pill, then 2-line title and author.
private struct BookOnShelfCell: View {
    let book: ShelfBook
    let ownerAvatarUrl: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                CoverThumb(url: book.coverImageUrl,
                           width: geo.size.width,
                           height: geo.size.width * 1.5,
                           radius: 4, title: book.title)
                    .overlay(alignment: .leading) {
                        LinearGradient(colors: [.black.opacity(0.20), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: 3)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .shadow(color: .black.opacity(0.3), radius: 5, x: 2, y: 2)
                    .overlay(alignment: .bottomTrailing) {
                        if let rating = book.userRating, rating > 0 {
                            AvatarRatingPill(avatarUrl: ownerAvatarUrl, rating: rating)
                                .padding(4)
                        }
                    }
            }
            .aspectRatio(2 / 3, contentMode: .fit)

            Text(book.title)
                .font(Theme.body(13, .semibold))
                .foregroundStyle(Theme.foreground)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text(book.authors.joined(separator: ", "))
                .font(Theme.body(11))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// ── Full shelf editor (web: /library/shelves/[slug] owner view) ──
//
// The card tap opens the read view (ShelfDetailView); the ✎ opens THIS:
// Add Books, Select/bulk-remove, Delete Shelf, drag-reorder rows, per-book
// notes, ✕ remove, plus the header pencil (name/color sheet) and share.

struct ShelfEditorRoute: Hashable {
    let shelfId: String
}

struct ShelfEditorView: View {
    @Environment(\.dismiss) private var dismiss
    let shelfId: String
    @State private var model: ShelfDetailModel
    @State private var dragging: ShelfBook?
    @State private var editingSeed: ShelfEditSeed?
    @State private var addOpen = false
    @State private var selectMode = false
    @State private var selected: Set<String> = []
    @State private var confirmDelete = false
    @State private var editingNoteBookId: String?
    @State private var noteText = ""
    @State private var confirmRemoveBookId: String?

    init(shelfId: String) {
        self.shelfId = shelfId
        _model = State(initialValue: ShelfDetailModel(shelfId: shelfId))
    }

    private var tint: Color {
        if let hex = model.shelf?.color, hex.hasPrefix("#"), hex.count == 7 {
            return Color(hex: String(hex.dropFirst()))
        }
        return Color(hex: "d97706")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                metaRow
                actionBar
                bookList
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .tracksScrollAtTop()
        .floatingBack(topPadding: 14)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .refreshable { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .alert("Delete \"\(model.shelf?.name ?? "this shelf")\"?", isPresented: $confirmDelete) {
            Button("Yes, Delete", role: .destructive) { deleteShelf() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the shelf and its book list. Your books are not affected.")
        }
        .sheet(item: $editingSeed) { seed in
            EditShelfSheet(seed: seed,
                           onDone: { Task { await model.load() } },
                           onDeleted: { dismiss() })
        }
        .sheet(isPresented: $addOpen) {
            AddBooksSheet(shelfId: shelfId,
                          shelfBookIds: Set(model.books.map(\.bookId))) {
                Task { await model.load() }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            // Placeholder — real back button is the .floatingBack overlay.
            Color.clear.frame(width: 40, height: 40)
            Text(model.shelf?.name ?? " ")
                .font(Theme.heading(24, .bold))
                .foregroundStyle(Theme.foreground)
                .lineLimit(2)
            Spacer()
            // Pencil — the name/description/color/visibility sheet.
            Button {
                if let shelf = model.shelf { editingSeed = ShelfEditSeed(detail: shelf) }
            } label: {
                Image(systemName: "pencil")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 38, height: 38)
                    .background(Theme.surfaceAlt.opacity(0.7), in: Circle())
            }
            if let shelf = model.shelf, shelf.isPublic, let username = shelf.ownerUsername,
               let url = URL(string: "https://thebasedreader.app/u/\(username)/shelves/\(shelf.slug)") {
                ShareLink(item: url) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 38, height: 38)
                        .background(Theme.surfaceAlt.opacity(0.7), in: Circle())
                }
            }
        }
        .padding(.top, 14)
    }

    private var metaRow: some View {
        HStack(spacing: 8) {
            Circle().fill(tint).frame(width: 10, height: 10)
            Text("\(model.books.count) book\(model.books.count == 1 ? "" : "s")")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
            if model.shelf?.isPublic == true {
                Text("Public")
                    .font(Theme.body(10, .medium))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Theme.surfaceAlt.opacity(0.8), in: Capsule())
            }
        }
    }

    @ViewBuilder private var actionBar: some View {
        if selectMode {
            HStack(spacing: 10) {
                Text("\(selected.count) selected")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                Spacer()
                Button {
                    bulkRemove()
                } label: {
                    Text("Remove Selected")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.destructive)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(Theme.destructive.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10)
                            .stroke(Theme.destructive.opacity(0.2), lineWidth: 1))
                }
                .disabled(selected.isEmpty)
                .opacity(selected.isEmpty ? 0.4 : 1)
                Button {
                    selectMode = false; selected = []
                } label: {
                    Text("Cancel")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.muted)
                }
            }
        } else {
            HStack(spacing: 10) {
                Button {
                    addOpen = true
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .bold))
                        Text("Add Books")
                            .font(Theme.body(13, .medium))
                    }
                    .foregroundStyle(Theme.accentText)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10)
                        .stroke(Theme.accent.opacity(0.2), lineWidth: 1))
                }
                if !model.books.isEmpty {
                    Button {
                        selectMode = true
                    } label: {
                        Text("Select")
                            .font(Theme.body(13, .medium))
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Theme.surfaceAlt.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10)
                                .stroke(Theme.border, lineWidth: 1))
                    }
                }
                Button {
                    confirmDelete = true
                } label: {
                    Text("Delete Shelf")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.destructive)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(Theme.destructive.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10)
                            .stroke(Theme.destructive.opacity(0.2), lineWidth: 1))
                }
                Spacer()
            }
        }
    }

    @ViewBuilder private var bookList: some View {
        if model.books.isEmpty {
            VStack(spacing: 6) {
                Text("No books on this shelf yet.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                Text("Add some from any book page, or use Add Books above.")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted.opacity(0.6))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [5]))
            )
        } else {
            VStack(spacing: 0) {
                ForEach(model.books) { book in
                    bookRow(book)
                    if book.id != model.books.last?.id {
                        Divider().background(Theme.border.opacity(0.5))
                    }
                }
            }
            .padding(.horizontal, 12)
            .background(Theme.surface.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
        }
    }

    @ViewBuilder private func bookRow(_ book: ShelfBook) -> some View {
        HStack(spacing: 10) {
            if selectMode {
                Button {
                    if selected.contains(book.bookId) { selected.remove(book.bookId) }
                    else { selected.insert(book.bookId) }
                } label: {
                    Image(systemName: selected.contains(book.bookId)
                          ? "checkmark.square.fill" : "square")
                        .font(.system(size: 19))
                        .foregroundStyle(selected.contains(book.bookId) ? Theme.accent : Theme.muted.opacity(0.5))
                }
            } else {
                GripDots()
                    .frame(width: 18, height: 40)
                    .contentShape(Rectangle())
                    .onDrag {
                        dragging = book
                        return NSItemProvider(object: book.bookId as NSString)
                    }
            }

            CoverThumb(url: book.coverImageUrl, width: 44, height: 66, radius: 4, title: book.title)

            VStack(alignment: .leading, spacing: 3) {
                Text(book.title)
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(1)
                Text(book.authors.joined(separator: ", "))
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                if editingNoteBookId == book.bookId {
                    HStack(spacing: 6) {
                        TextField("Add a note...", text: $noteText)
                            .font(Theme.body(12))
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .background(Theme.surfaceAlt.opacity(0.8))
                            .clipShape(RoundedRectangle(cornerRadius: 7))
                            .onSubmit { saveNote(book) }
                        Button {
                            saveNote(book)
                        } label: {
                            Text("Save")
                                .font(Theme.body(11, .medium))
                                .foregroundStyle(Theme.accentText)
                        }
                    }
                } else if let note = book.note, !note.isEmpty {
                    Button {
                        noteText = note
                        editingNoteBookId = book.bookId
                    } label: {
                        Text(note)
                            .font(Theme.body(11))
                            .italic()
                            .foregroundStyle(Theme.muted.opacity(0.7))
                            .lineLimit(1)
                    }
                } else {
                    Button {
                        noteText = ""
                        editingNoteBookId = book.bookId
                    } label: {
                        Text("+ Add note")
                            .font(Theme.body(10))
                            .foregroundStyle(Theme.muted.opacity(0.4))
                    }
                }
            }

            Spacer(minLength: 0)

            if !selectMode {
                if confirmRemoveBookId == book.bookId {
                    HStack(spacing: 5) {
                        Button {
                            withAnimation { model.remove(bookId: book.bookId) }
                            confirmRemoveBookId = nil
                        } label: {
                            Text("Remove")
                                .font(Theme.body(11, .medium))
                                .foregroundStyle(Theme.destructive)
                                .padding(.horizontal, 8).padding(.vertical, 5)
                                .background(Theme.destructive.opacity(0.15), in: RoundedRectangle(cornerRadius: 7))
                        }
                        Button {
                            confirmRemoveBookId = nil
                        } label: {
                            Text("Cancel")
                                .font(Theme.body(11, .medium))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                } else {
                    Button {
                        confirmRemoveBookId = book.bookId
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.muted.opacity(0.5))
                            .frame(width: 30, height: 30)
                            .contentShape(Rectangle())
                    }
                }
            }
        }
        .padding(.vertical, 10)
        .opacity(dragging?.id == book.id ? 0.4 : 1)
        .onDrop(of: [.text], delegate: GridReorderDelegate(
            item: book,
            items: $model.books,
            dragging: $dragging,
            commit: { model.persistOrder() }
        ))
    }

    private func saveNote(_ book: ShelfBook) {
        let trimmed = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        editingNoteBookId = nil
        Task {
            try? await APIClient.shared.updateShelfBookNote(
                shelfId: shelfId, bookId: book.bookId,
                note: trimmed.isEmpty ? nil : trimmed)
            await model.load()
        }
    }

    private func bulkRemove() {
        let ids = selected
        selected = []
        selectMode = false
        withAnimation { model.books.removeAll { ids.contains($0.bookId) } }
        Task {
            for id in ids {
                try? await APIClient.shared.removeBook(fromShelf: shelfId, bookId: id)
            }
        }
    }

    private func deleteShelf() {
        Task {
            do {
                try await APIClient.shared.deleteShelf(id: shelfId)
                dismiss()
            } catch {
                model.error = (error as? APIError)?.errorDescription ?? "Couldn't delete the shelf."
            }
        }
    }
}

// ── Add Books sheet (web: AddBooksModal — search your library, toggle) ──

private struct AddBooksSheet: View {
    @Environment(\.dismiss) private var dismiss
    let shelfId: String
    let shelfBookIds: Set<String>
    var onChanged: () -> Void

    @State private var allBooks: [LibraryBook] = []
    @State private var search = ""
    @State private var added: Set<String> = []
    @State private var removed: Set<String> = []
    @State private var loaded = false

    private func isOnShelf(_ id: String) -> Bool {
        if removed.contains(id) { return false }
        if added.contains(id) { return true }
        return shelfBookIds.contains(id)
    }

    private var filtered: [LibraryBook] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return Array(allBooks.prefix(50)) }
        return allBooks.filter {
            $0.title.lowercased().contains(q)
                || $0.authors.contains { $0.lowercased().contains(q) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Add Books")
                    .font(Theme.heading(20, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(.top, 20)

            TextField("Search your library...", text: $search)
                .font(Theme.body(15))
                .padding(.horizontal, 12).padding(.vertical, 11)
                .background(Theme.surfaceAlt.opacity(0.8))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))

            ScrollView {
                LazyVStack(spacing: 0) {
                    if !loaded {
                        Text("Loading…")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .padding(.vertical, 24)
                    } else if filtered.isEmpty {
                        Text("No books found")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .padding(.vertical, 24)
                    } else {
                        ForEach(filtered) { book in
                            Button {
                                toggle(book)
                            } label: {
                                HStack(spacing: 10) {
                                    CoverThumb(url: book.coverImageUrl, width: 32, height: 48, radius: 3, title: book.title)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(book.title)
                                            .font(Theme.body(14))
                                            .foregroundStyle(Theme.foreground)
                                            .lineLimit(1)
                                        Text(book.authors.joined(separator: ", "))
                                            .font(Theme.body(12))
                                            .foregroundStyle(Theme.muted)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: isOnShelf(book.id)
                                          ? "checkmark.square.fill" : "square")
                                        .font(.system(size: 19))
                                        .foregroundStyle(isOnShelf(book.id) ? Theme.accent : Theme.muted.opacity(0.5))
                                }
                                .padding(.vertical, 7)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 20)
        .background(Theme.bg)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            allBooks = (try? await APIClient.shared.library()) ?? []
            loaded = true
        }
        .onDisappear { onChanged() }
    }

    private func toggle(_ book: LibraryBook) {
        let on = isOnShelf(book.id)
        if on {
            added.remove(book.id); removed.insert(book.id)
        } else {
            removed.remove(book.id); added.insert(book.id)
        }
        Task {
            if on { try? await APIClient.shared.removeBook(fromShelf: shelfId, bookId: book.id) }
            else { try? await APIClient.shared.addBook(toShelf: shelfId, bookId: book.id) }
        }
    }
}
