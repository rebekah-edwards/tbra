import SwiftUI
import Observation

@MainActor
@Observable
final class ShelvesModel {
    var shelves: [ShelfSummary] = []
    var error: String?
    var loading = false

    func load() async {
        loading = true; defer { loading = false }
        do { shelves = try await APIClient.shared.shelves() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load shelves." }
    }

    /// Reorder the shelves themselves; persist the COMPLETE new order.
    func move(from offsets: IndexSet, to destination: Int) {
        shelves.move(fromOffsets: offsets, toOffset: destination)
        let ids = shelves.map(\.id)
        Task {
            do { try await APIClient.shared.reorderShelves(shelfIds: ids) }
            catch { await load() }
        }
    }
}

struct ShelvesView: View {
    @State private var model = ShelvesModel()

    var body: some View {
        NavigationStack {
            List {
                ForEach(model.shelves) { shelf in
                    NavigationLink(value: shelf.id) {
                        ShelfRow(shelf: shelf)
                    }
                }
                .onMove(perform: model.move)
                .listRowBackground(Theme.surface)
                .listRowSeparatorTint(Theme.border)
            }
            .scrollContentBackground(.hidden)
            .background(AmbientBackground())
            .navigationTitle("Shelves")
            .toolbar { EditButton().font(Theme.body(15, .medium)) }
            .navigationDestination(for: String.self) { shelfId in
                ShelfDetailView(shelfId: shelfId)
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

private struct ShelfRow: View {
    let shelf: ShelfSummary
    var body: some View {
        HStack(spacing: 12) {
            // Small cover mosaic from the first few covers.
            HStack(spacing: -8) {
                ForEach(Array(shelf.coverUrls.prefix(3).enumerated()), id: \.offset) { index, url in
                    CoverThumb(url: url, width: 30, height: 45, radius: 3)
                        .zIndex(Double(3 - index))
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(shelf.name)
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(Theme.foreground)
                Text("\(shelf.bookCount) book\(shelf.bookCount == 1 ? "" : "s")")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.vertical, 2)
    }
}
