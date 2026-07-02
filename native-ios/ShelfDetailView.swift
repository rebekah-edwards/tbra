import SwiftUI
import Observation

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

    /// Optimistic reorder within the shelf; persist the COMPLETE new order.
    func move(from offsets: IndexSet, to destination: Int) {
        books.move(fromOffsets: offsets, toOffset: destination)
        let ids = books.map(\.bookId)
        Task {
            do { try await APIClient.shared.reorderShelfBooks(shelfId: shelfId, bookIds: ids) }
            catch { await load() }
        }
    }

    func remove(at offsets: IndexSet) {
        let removed = offsets.map { books[$0].bookId }
        books.remove(atOffsets: offsets)
        Task {
            for id in removed {
                try? await APIClient.shared.removeBook(fromShelf: shelfId, bookId: id)
            }
        }
    }
}

struct ShelfDetailView: View {
    @State private var model: ShelfDetailModel

    init(shelfId: String) {
        _model = State(initialValue: ShelfDetailModel(shelfId: shelfId))
    }

    var body: some View {
        List {
            // Native drag-to-reorder within the shelf via .onMove (iOS 27 drag
            // physics for free). Reorder persistence sends the whole ordered
            // list — matching the API's "complete set" requirement.
            ForEach(model.books) { book in
                ShelfBookRow(book: book)
            }
            .onMove(perform: model.move)
            .onDelete(perform: model.remove)
            .listRowBackground(Theme.surface)
            .listRowSeparatorTint(Theme.border)
        }
        .scrollContentBackground(.hidden)
        .background(AmbientBackground())
        .navigationTitle(model.shelf?.name ?? "Shelf")
        .toolbar { EditButton().font(Theme.body(15, .medium)) }
        .overlay {
            if model.books.isEmpty && !model.loading {
                ContentUnavailableView("No books yet", systemImage: "book.closed")
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}

private struct ShelfBookRow: View {
    let book: ShelfBook
    var body: some View {
        HStack(spacing: 12) {
            CoverThumb(url: book.coverImageUrl)

            VStack(alignment: .leading, spacing: 3) {
                Text(book.title)
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                if let author = book.authors.first {
                    Text(author)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
                if let note = book.note, !note.isEmpty {
                    Text(note)
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.muted.opacity(0.7))
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
