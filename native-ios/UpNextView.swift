import SwiftUI
import Observation

@MainActor
@Observable
final class UpNextModel {
    var items: [UpNextItem] = []
    var error: String?
    var loading = false

    func load() async {
        loading = true; defer { loading = false }
        do { items = try await APIClient.shared.upNext() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load Up Next." }
    }

    /// Optimistic reorder: update locally, then persist the COMPLETE new order.
    func move(from offsets: IndexSet, to destination: Int) {
        items.move(fromOffsets: offsets, toOffset: destination)
        let ids = items.map(\.bookId)
        Task {
            do { try await APIClient.shared.reorderUpNext(bookIds: ids) }
            catch { await load() } // reconcile with server on failure
        }
    }

    func remove(at offsets: IndexSet) {
        let removed = offsets.map { items[$0].bookId }
        items.remove(atOffsets: offsets)
        Task {
            for id in removed { try? await APIClient.shared.removeFromUpNext(bookId: id) }
        }
    }
}

struct UpNextView: View {
    @State private var model = UpNextModel()

    var body: some View {
        NavigationStack {
            List {
                // A plain List gives native drag-to-reorder via .onMove, and on
                // iOS 27 inherits the improved drag preview / drop animation for
                // free. (For reordering inside a *custom* layout — LazyVStack,
                // grid — use the iOS 27 `.reorderable()` + `.reorderContainer(for:)`
                // modifiers instead; not needed here since Up Next is a list.)
                ForEach(model.items) { item in
                    UpNextRow(item: item)
                }
                .onMove(perform: model.move)
                .onDelete(perform: model.remove)
                .listRowBackground(Theme.surface)
                .listRowSeparatorTint(Theme.border)
            }
            .scrollContentBackground(.hidden)
            .background(AmbientBackground())
            .navigationTitle("Up Next")
            .toolbar { EditButton().font(Theme.body(15, .medium)) }
            .overlay {
                if model.items.isEmpty && !model.loading {
                    ContentUnavailableView("Nothing queued", systemImage: "books.vertical")
                }
            }
            .refreshable { await model.load() }
            .task { await model.load() }
            .alert("Error", isPresented: .constant(model.error != nil)) {
                Button("OK") { model.error = nil }
            } message: { Text(model.error ?? "") }
            .tint(Theme.neonBlue)   // tappable text is neon blue on the web
        }
    }
}

private struct UpNextRow: View {
    let item: UpNextItem
    var body: some View {
        HStack(spacing: 12) {
            CoverThumb(url: item.coverImageUrl)

            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                if let author = item.authorName {
                    Text(author)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
