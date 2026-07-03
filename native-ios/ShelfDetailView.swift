import SwiftUI
import Observation

// Shelf detail — recreates /u/[username]/shelves/[slug]:
// back chevron + bold shelf name + "by <owner>" (lime), share icon,
// lime-dot book count, Shelf Order / Filters / lime ✎ Edit controls,
// then the tinted container card with a 3-column cover grid.

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
    @State private var model: ShelfDetailModel
    @State private var dragging: ShelfBook?

    init(shelfId: String) {
        _model = State(initialValue: ShelfDetailModel(shelfId: shelfId))
    }

    private let columns = [
        GridItem(.flexible(), spacing: 14),
        GridItem(.flexible(), spacing: 14),
        GridItem(.flexible(), spacing: 14),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                countRow
                controlsRow
                booksCard
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    private var ownerName: String {
        if case .signedIn(let user) = auth.phase {
            return user.displayName ?? user.username ?? "you"
        }
        return "you"
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 32, height: 36)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(model.shelf?.name ?? " ")
                    .font(Theme.heading(26, .bold))
                    .foregroundStyle(Theme.foreground)
                HStack(spacing: 4) {
                    Text("by")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                    Text(ownerName)
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.accent)
                }
            }
            Spacer()
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 18))
                .foregroundStyle(Theme.muted)
                .padding(.top, 6)
        }
        .padding(.top, 18)
    }

    private var countRow: some View {
        HStack(spacing: 8) {
            Circle().fill(Theme.accent).frame(width: 10, height: 10)
            Text("\(model.books.count) book\(model.books.count == 1 ? "" : "s")")
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
        }
    }

    private var controlsRow: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Text("Shelf Order")
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.foreground)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))

            HStack(spacing: 6) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 12))
                Text("Filters")
                    .font(Theme.body(14, .medium))
            }
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))

            Spacer()

            HStack(spacing: 5) {
                Image(systemName: "pencil")
                    .font(.system(size: 13))
                Text("Edit")
                    .font(Theme.body(15, .medium))
            }
            .foregroundStyle(Theme.accent)
        }
    }

    // The tinted container card holding the 3-column cover grid —
    // .currently-reading-card-base gradient (accent 8% → purple 6%).
    private var booksCard: some View {
        LazyVGrid(columns: columns, spacing: 20) {
            ForEach(model.books) { book in
                NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.bookId)) {
                    BookCell(book: book)
                }
                .buttonStyle(TapScaleButtonStyle())
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
            }
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [
                    Theme.accent.opacity(0.08),
                    Theme.neonPurple.opacity(0.06),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .background(Theme.surfaceAlt.opacity(0.65))
        )
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay {
            if model.books.isEmpty && !model.loading {
                Text("No books yet")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .padding(.vertical, 48)
            }
        }
    }
}

private struct BookCell: View {
    let book: ShelfBook

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                CoverThumb(url: book.coverImageUrl,
                           width: geo.size.width,
                           height: geo.size.width * 1.5,
                           radius: 8)
                    .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
            }
            .aspectRatio(2 / 3, contentMode: .fit)

            Text(book.title)
                .font(Theme.body(14, .semibold))
                .foregroundStyle(Theme.foreground)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text(book.authors.joined(separator: ", "))
                .font(Theme.body(12))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
        }
    }
}
