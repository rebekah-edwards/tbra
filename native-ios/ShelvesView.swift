import SwiftUI
import Observation

// My Library → Shelves — recreates /library/shelves (shelves-client.tsx):
// "< Shelves" header with the lime "+ New Shelf" button, My Shelves /
// Following pills, then the glowing shelf cards (cover mosaic, name,
// Public pill, edit pencil, book count, shelf-color accent).

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

    /// Persist the COMPLETE current shelf order.
    func persistOrder() {
        let ids = shelves.map(\.id)
        Task {
            do { try await APIClient.shared.reorderShelves(shelfIds: ids) }
            catch { await load() }
        }
    }
}

struct LibraryShelvesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = ShelvesModel()
    @State private var dragging: ShelfSummary?
    @State private var filter: ShelvesFilter = .mine

    enum ShelvesFilter { case mine, following }

    // NOTE: no NavigationStack of its own — this screen is pushed inside the
    // My Library tab's stack (LibraryRootView), matching the web's IA where
    // /library/shelves is a sub-page of /library.
    var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    filterPills

                    if filter == .mine {
                        VStack(spacing: 16) {
                            ForEach(model.shelves) { shelf in
                                NavigationLink(value: shelf.id) {
                                    ShelfCard(shelf: shelf)
                                }
                                .buttonStyle(TapScaleButtonStyle())
                                .opacity(dragging?.id == shelf.id ? 0.4 : 1)
                                .onDrag {
                                    dragging = shelf
                                    return NSItemProvider(object: shelf.id as NSString)
                                }
                                .onDrop(of: [.text], delegate: GridReorderDelegate(
                                    item: shelf,
                                    items: $model.shelves,
                                    dragging: $dragging,
                                    commit: { model.persistOrder() }
                                ))
                            }
                        }
                    } else {
                        Text("Shelves you follow will show up here")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 48)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .refreshable { await model.load() }
            .task { await model.load() }
            .toolbar(.hidden, for: .navigationBar)
            .alert("Error", isPresented: .constant(model.error != nil)) {
                Button("OK") { model.error = nil }
            } message: { Text(model.error ?? "") }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 30, height: 34)
            }
            Text("Shelves")
                .font(Theme.heading(26, .bold))
                .foregroundStyle(Theme.foreground)
            Spacer()
            HStack(spacing: 5) {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .bold))
                Text("New Shelf")
                    .font(Theme.body(14, .semibold))
            }
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Theme.accent)
            .clipShape(Capsule())
        }
        .padding(.top, 20)
    }

    private var filterPills: some View {
        HStack(spacing: 10) {
            pill("My Shelves", active: filter == .mine) { filter = .mine }
            pill("Following", active: filter == .following) { filter = .following }
        }
    }

    private func pill(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.body(15, .semibold))
                .foregroundStyle(active ? Theme.onAccent : Theme.muted)
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(active ? Theme.accent : Theme.surfaceAlt)
                .clipShape(Capsule())
        }
        .buttonStyle(TapScaleButtonStyle())
    }
}

// One shelf card — mosaic, name + Public pill, count, pencil, and the
// shelf-color glow (border tint + bottom accent bar), like the web card.
private struct ShelfCard: View {
    let shelf: ShelfSummary

    private var tint: Color {
        if let hex = shelf.color, hex.hasPrefix("#"), hex.count == 7 {
            return Color(hex: String(hex.dropFirst()))
        }
        return Theme.accent
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                // Narrow cropped slices, like the web mosaic (~100pt total).
                HStack(spacing: 0) {
                    ForEach(Array(shelf.coverUrls.prefix(3).enumerated()), id: \.offset) { _, url in
                        CoverThumb(url: url, width: 34, height: 76, radius: 0)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(shelf.name)
                            .font(Theme.body(17, .bold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(1)
                        if shelf.isPublic {
                            Text("Public")
                                .font(Theme.body(11, .medium))
                                .foregroundStyle(Theme.muted)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Theme.surfaceAlt.opacity(0.8))
                                .clipShape(Capsule())
                        }
                    }
                    Text("\(shelf.bookCount) book\(shelf.bookCount == 1 ? "" : "s")")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                }
                .padding(.top, 6)

                Spacer(minLength: 0)

                Image(systemName: "pencil")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.foreground.opacity(0.85))
                    .frame(width: 32, height: 32)
                    .background(.black.opacity(0.30))
                    .clipShape(Circle())
            }
            .padding(14)

            // Bottom accent bar in the shelf's color.
            Rectangle()
                .fill(tint.opacity(0.55))
                .frame(height: 3)
        }
        .background(Theme.surface.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(tint.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: tint.opacity(0.12), radius: 12, y: 4)
    }
}
