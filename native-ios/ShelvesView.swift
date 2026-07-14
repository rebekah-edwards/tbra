import SwiftUI
import Observation

// My Library → Shelves — recreates /library/shelves (shelves-client.tsx):
// header with the lime "+ New Shelf" button (premium), My Shelves /
// Following pills, the glowing shelf cards (cover mosaic, name, Public
// pill, edit pencil, book count, shelf-color accent), the Following tab
// (shelves you follow, with owner attribution), and the create/edit sheet.

@MainActor
@Observable
final class ShelvesModel {
    var shelves: [ShelfSummary] = []
    var followed: [FollowedShelf] = []
    var error: String?
    var loading = false

    func load() async {
        loading = true; defer { loading = false }
        do {
            let res = try await APIClient.shared.shelves()
            shelves = res.mine
            followed = res.followed
        } catch {
            guard !APIError.isCancellation(error) else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load shelves."
        }
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
    @Environment(AuthStore.self) private var auth
    @State private var model = ShelvesModel()
    @State private var dragging: ShelfSummary?
    @State private var filter: ShelvesFilter = .mine
    @State private var createOpen = false
    @State private var editingSeed: ShelfEditSeed?

    enum ShelvesFilter { case mine, following }

    private var isPremium: Bool {
        if case .signedIn(let user) = auth.phase {
            return ["premium", "beta_tester", "admin", "super_admin"].contains(user.accountType ?? "")
        }
        return false
    }

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
                                NavigationLink(value: ShelfRoute(shelfId: shelf.id)) {
                                    ShelfCard(shelf: shelf)
                                }
                                // Pencil rides ON TOP of the link so its tap
                                // wins — it opens the editor directly (user
                                // request 2026-07-13: card = view, ✎ = edit).
                                .overlay(alignment: .topTrailing) {
                                    Button {
                                        editingSeed = ShelfEditSeed(shelf: shelf)
                                    } label: {
                                        Image(systemName: "pencil")
                                            .font(.system(size: 13, weight: .medium))
                                            .foregroundStyle(Theme.foreground.opacity(0.85))
                                            .frame(width: 34, height: 34)
                                            .background(Theme.scrim)
                                            .clipShape(Circle())
                                    }
                                    .padding(10)
                                }
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
                    } else if model.followed.isEmpty {
                        Text("You're not following any shelves yet.")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 48)
                    } else {
                        VStack(spacing: 12) {
                            ForEach(model.followed) { shelf in
                                NavigationLink(value: ShelfRoute(
                                    shelfId: shelf.id,
                                    ownerName: shelf.ownerDisplayName ?? "@\(shelf.ownerUsername)"
                                )) {
                                    FollowedShelfCard(shelf: shelf)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .refreshable { await model.load() }
            .task { await model.load() }
            .background(AmbientBackground())
            .floatingBack(topPadding: 16)
            .toolbar(.hidden, for: .navigationBar)
            .alert("Error", isPresented: .constant(model.error != nil)) {
                Button("OK") { model.error = nil }
            } message: { Text(model.error ?? "") }
            .sheet(isPresented: $createOpen) {
                EditShelfSheet(seed: nil) { Task { await model.load() } }
            }
            .sheet(item: $editingSeed) { seed in
                EditShelfSheet(seed: seed) { Task { await model.load() } }
            }
    }

    private var header: some View {
        HStack(spacing: 12) {
            // Placeholder — real back button is the .floatingBack overlay.
            Color.clear.frame(width: 40, height: 40)
            Text("Shelves")
                .font(Theme.heading(26, .bold))
                .foregroundStyle(Theme.foreground)
            Spacer()
            if isPremium && filter == .mine {
                Button {
                    createOpen = true
                } label: {
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
            }
        }
        .padding(.top, 16)
    }

    private var filterPills: some View {
        HStack(spacing: 10) {
            pill("My Shelves", active: filter == .mine) { filter = .mine }
            pill(model.followed.isEmpty ? "Following" : "Following (\(model.followed.count))",
                 active: filter == .following) { filter = .following }
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
    }
}

// One shelf card — mosaic, 2-line name, count + Public pill row, and the
// shelf-color glow (border tint + full-bleed bottom plank, like the
// profile shelf rails / web card).
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
            HStack(alignment: .top, spacing: 12) {
                // Narrow cropped slices, like the web mosaic.
                HStack(spacing: 0) {
                    ForEach(Array(shelf.coverUrls.prefix(3).enumerated()), id: \.offset) { _, url in
                        CoverThumb(url: url, width: 28, height: 72, radius: 0)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 5) {
                    Text(shelf.name)
                        .font(Theme.body(16, .bold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 8) {
                        Text("\(shelf.bookCount) book\(shelf.bookCount == 1 ? "" : "s")")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                        if shelf.isPublic {
                            Text("Public")
                                .font(Theme.body(11, .medium))
                                .foregroundStyle(Theme.muted)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 3)
                                .background(Theme.surfaceAlt.opacity(0.8))
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(.top, 4)

                Spacer(minLength: 0)

                // Visual slot for the pencil — the tappable button is an
                // overlay in the list cell (it must sit ABOVE the nav link).
                Color.clear.frame(width: 34, height: 34)
            }
            .padding(14)

            // The bookshelf plank — thin and FULL-BLEED, mirroring the
            // profile shelf rails (web: h-[5px] gradient + h-1.5 gap).
            Rectangle()
                .fill(LinearGradient(
                    colors: [tint.opacity(0.30), tint.opacity(0.45)],
                    startPoint: .top, endPoint: .bottom))
                .frame(height: 5)
            Color.clear.frame(height: 6)
        }
        .background(
            // Web card tint: linear-gradient(to bottom, color12, color22)
            LinearGradient(colors: [tint.opacity(0.07), tint.opacity(0.13)],
                           startPoint: .top, endPoint: .bottom)
                .background(Theme.surface.opacity(0.9))
        )
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(tint.opacity(0.19), lineWidth: 1)
        )
        // Web: under-card shadow strip (h-2 mx-2 black/10→transparent)
        .background(alignment: .bottom) {
            LinearGradient(colors: [.black.opacity(0.10), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 8)
                .padding(.horizontal, 8)
                .offset(y: 8)
        }
    }
}

// A shelf you follow — web Following tab card: mosaic, name, owner + count,
// description, thin plank.
private struct FollowedShelfCard: View {
    let shelf: FollowedShelf

    private var tint: Color {
        if let hex = shelf.color, hex.hasPrefix("#"), hex.count == 7 {
            return Color(hex: String(hex.dropFirst()))
        }
        return Color(hex: "d97706")
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                HStack(spacing: 0) {
                    ForEach(Array(shelf.coverUrls.prefix(3).enumerated()), id: \.offset) { _, url in
                        CoverThumb(url: url, width: 28, height: 72, radius: 0)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 4) {
                    Text(shelf.name)
                        .font(Theme.body(15, .bold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text("by \(shelf.ownerDisplayName ?? "@\(shelf.ownerUsername)") · \(shelf.bookCount) book\(shelf.bookCount == 1 ? "" : "s")")
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.muted)
                    if let description = shelf.description, !description.isEmpty {
                        Text(description)
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted.opacity(0.6))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                .padding(.top, 2)

                Spacer(minLength: 0)
            }
            .padding(14)

            Rectangle()
                .fill(LinearGradient(
                    colors: [tint.opacity(0.30), tint.opacity(0.45)],
                    startPoint: .top, endPoint: .bottom))
                .frame(height: 5)
            Color.clear.frame(height: 6)
        }
        .background(
            LinearGradient(colors: [tint.opacity(0.07), tint.opacity(0.13)],
                           startPoint: .top, endPoint: .bottom)
                .background(Theme.surface.opacity(0.9))
        )
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(tint.opacity(0.19), lineWidth: 1)
        )
    }
}

// ── Create / Edit shelf sheet (web: create-shelf-modal.tsx) ──

/// Seed for editing an existing shelf; nil seed = create mode.
struct ShelfEditSeed: Identifiable {
    let id: String
    let name: String
    let description: String?
    let color: String?
    let isPublic: Bool

    init(shelf: ShelfSummary) {
        id = shelf.id; name = shelf.name; description = shelf.description
        color = shelf.color; isPublic = shelf.isPublic
    }

    init(detail: ShelfDetail) {
        id = detail.id; name = detail.name; description = detail.description
        color = detail.color; isPublic = detail.isPublic
    }
}

struct EditShelfSheet: View {
    @Environment(\.dismiss) private var dismiss
    let seed: ShelfEditSeed?
    var onDone: () -> Void
    /// Called after a successful DELETE (detail pages pop themselves).
    var onDeleted: (() -> Void)? = nil

    @State private var name: String
    @State private var descriptionText: String
    @State private var color: String?
    @State private var isPublic: Bool
    @State private var error: String?
    @State private var saving = false
    @State private var confirmDelete = false

    // COLOR_PRESETS from create-shelf-modal.tsx (Amber = nil = default).
    private static let presets: [(name: String, value: String?, preview: String)] = [
        ("Amber", nil, "d97706"), ("Rose", "#f43f5e", "f43f5e"),
        ("Sky", "#38bdf8", "38bdf8"), ("Violet", "#8b5cf6", "8b5cf6"),
        ("Emerald", "#10b981", "10b981"), ("Slate", "#64748b", "64748b"),
        ("Coral", "#fb923c", "fb923c"), ("Fuchsia", "#d946ef", "d946ef"),
    ]

    init(seed: ShelfEditSeed?, onDone: @escaping () -> Void, onDeleted: (() -> Void)? = nil) {
        self.seed = seed
        self.onDone = onDone
        self.onDeleted = onDeleted
        _name = State(initialValue: seed?.name ?? "")
        _descriptionText = State(initialValue: seed?.description ?? "")
        _color = State(initialValue: seed?.color)
        _isPublic = State(initialValue: seed?.isPublic ?? false)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text(seed == nil ? "Create Shelf" : "Edit Shelf")
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

                VStack(alignment: .leading, spacing: 6) {
                    Text("Name")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                    TextField("Summer 2026 Reads", text: $name)
                        .font(Theme.body(15))
                        .padding(.horizontal, 12).padding(.vertical, 11)
                        .background(Theme.surfaceAlt.opacity(0.8))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Description (optional)")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                    TextField("Books I want to read this summer...", text: $descriptionText, axis: .vertical)
                        .font(Theme.body(15))
                        .lineLimit(2...4)
                        .padding(.horizontal, 12).padding(.vertical, 11)
                        .background(Theme.surfaceAlt.opacity(0.8))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Shelf Color")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                    FlowLayout(spacing: 8) {
                        ForEach(Self.presets, id: \.preview) { preset in
                            let active = preset.value == color
                            Button {
                                color = preset.value
                            } label: {
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(Color(hex: preset.preview))
                                        .frame(width: 14, height: 14)
                                    Text(preset.name)
                                        .font(Theme.body(11, .medium))
                                        .foregroundStyle(Color(hex: preset.preview))
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Color(hex: preset.preview).opacity(0.13), in: Capsule())
                                .overlay(Capsule().stroke(
                                    active ? Color(hex: preset.preview) : .clear, lineWidth: 1.5))
                            }
                        }
                    }
                }

                Toggle(isOn: $isPublic) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Public shelf")
                            .font(Theme.body(15, .medium))
                            .foregroundStyle(Theme.foreground)
                        Text("Anyone can view it from your profile")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .tint(Theme.accent)

                if let error {
                    Text(error)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.destructive)
                }

                Button {
                    save()
                } label: {
                    Text(saving ? "Saving…" : (seed == nil ? "Create Shelf" : "Save Changes"))
                        .font(Theme.body(16, .semibold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)

                if seed != nil {
                    Button {
                        confirmDelete = true
                    } label: {
                        Text("Delete Shelf")
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(Theme.destructive)
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.bottom, 8)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 30)
        }
        .background(Theme.bg)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .alert("Delete this shelf?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { deleteShelf() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The shelf and its book list are removed. Books stay in your library.")
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        saving = true; error = nil
        let desc = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                if let seed {
                    try await APIClient.shared.updateShelf(
                        id: seed.id, name: trimmed, description: desc,
                        isPublic: isPublic, color: color)
                } else {
                    try await APIClient.shared.createShelf(
                        name: trimmed, description: desc.isEmpty ? nil : desc,
                        isPublic: isPublic, color: color)
                }
                onDone()
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Couldn't save the shelf."
            }
            saving = false
        }
    }

    private func deleteShelf() {
        guard let seed else { return }
        saving = true
        Task {
            do {
                try await APIClient.shared.deleteShelf(id: seed.id)
                onDone()
                dismiss()
                onDeleted?()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Couldn't delete the shelf."
            }
            saving = false
        }
    }
}
