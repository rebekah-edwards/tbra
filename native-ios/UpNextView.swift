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

    /// Persist the COMPLETE current order (the API requires the full set).
    func persistOrder() {
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
