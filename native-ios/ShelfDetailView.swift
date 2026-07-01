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
        }
        .navigationTitle(model.shelf?.name ?? "Shelf")
        .toolbar { EditButton() }
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
            AsyncImage(url: book.coverImageUrl.flatMap(URL.init(string:))) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: { Color.gray.opacity(0.2) }
            .frame(width: 44, height: 66)
            .clipShape(RoundedRectangle(cornerRadius: 4))

            VStack(alignment: .leading, spacing: 2) {
                Text(book.title).font(.body).lineLimit(2)
                if let author = book.authors.first {
                    Text(author).font(.caption).foregroundStyle(.secondary)
                }
                if let note = book.note, !note.isEmpty {
                    Text(note).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
        }
    }
}
