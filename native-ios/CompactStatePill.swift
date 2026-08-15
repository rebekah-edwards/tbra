import SwiftUI

/// The compact reading-state split pill from the web's search results /
/// series rows (reading-state-button.tsx compact mode): main tap toggles
/// tbr/remove, chevron opens the 5-state dropdown, Finished/DNF intercept
/// into the completion date sheet. Owns its state optimistically.
struct CompactStatePill: View {
    let bookId: String
    @State var state: String?
    var onChanged: ((String?) -> Void)? = nil
    /// Lets the host row elevate its zIndex / drop its clip while the
    /// dropdown is open (series cards clipped the menu — 2026-07-22).
    var onDropdownChange: ((Bool) -> Void)? = nil

    @State private var dropdownOpen = false
    @State private var showDatePicker = false
    @State private var pendingCompleteState = "completed"
    @State private var busy = false
    @State private var activeFormatSheetOpen = false

    private let states: [(String, String)] = [
        ("tbr", "To Read"), ("currently_reading", "Reading Now"),
        ("completed", "Finished"), ("paused", "Paused"), ("dnf", "DNF"),
    ]

    private var isActive: Bool { state != nil }
    private var stateLabel: String {
        switch state {
        case "tbr": return "To Read"
        case "currently_reading": return "Reading Now"
        case "completed": return "Finished"
        case "paused": return "Paused"
        case "dnf": return "DNF"
        default: return "To Read"
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            Button {
                Task { await mainTap() }
            } label: {
                HStack(spacing: 5) {
                    if !isActive { Image(systemName: "bookmark").font(.system(size: 12, weight: .semibold)) }
                    Text(stateLabel)
                        .font(Theme.body(14, .medium))
                }
                .foregroundStyle(isActive ? .black : Theme.foreground)
                .padding(.horizontal, 16).padding(.vertical, 9)
            }
            Rectangle()
                .fill(isActive ? .black.opacity(0.2) : Theme.accent.opacity(0.4))
                .frame(width: 1, height: 20)
            Button {
                withAnimation(.easeOut(duration: 0.12)) { dropdownOpen.toggle() }
                onDropdownChange?(dropdownOpen)
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(isActive ? .black : Theme.foreground)
                    .padding(.horizontal, 10).padding(.vertical, 11)
            }
        }
        .background(isActive ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.accent.opacity(0.2)))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Theme.accent.opacity(isActive ? 1 : 0.6), lineWidth: 1.5))
        .opacity(busy ? 0.6 : 1)
        .overlay(alignment: .topLeading) { dropdown }
        .zIndex(dropdownOpen ? 40 : 0)
        .sheet(isPresented: $showDatePicker) {
            CompletionDateSheet(
                title: pendingCompleteState == "dnf" ? "When did you stop reading?" : "When did you finish?"
            ) { date, precision in
                Task { await setState(pendingCompleteState, date: date, precision: precision) }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
        .sheet(isPresented: $activeFormatSheetOpen) {
            ActiveFormatSheet(bookId: bookId)
                .presentationDetents([.height(340)])
                .presentationBackground(Theme.surface)
        }
    }

    @ViewBuilder private var dropdown: some View {
        if dropdownOpen {
            VStack(spacing: 0) {
                ForEach(states, id: \.0) { value, label in
                    Button {
                        dropdownOpen = false
                        onDropdownChange?(false)
                        Task { await selectState(value) }
                    } label: {
                        HStack {
                            Text(label)
                                .font(Theme.body(13, .medium))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                            if state == value { Text("✓").foregroundStyle(Theme.accentText) }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(state == value ? Theme.accent.opacity(0.15) : .clear)
                    }
                    if value != "dnf" { Divider().background(Theme.border.opacity(0.5)) }
                }
            }
            .frame(width: 180)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 12, y: 4)
            .offset(y: 42)
        }
    }

    private func mainTap() async {
        busy = true; defer { busy = false }
        if isActive {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: bookId, state: "none")
            }
            state = nil
        } else {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: bookId, state: "tbr")
            }
            state = "tbr"
        }
        onChanged?(state)
    }

    private func selectState(_ value: String) async {
        if (value == "completed" || value == "dnf") && state != value {
            pendingCompleteState = value
            showDatePicker = true
            return
        }
        // Same rule as the book page: starting a read always asks for the
        // format rather than silently inheriting the owned guess (#8).
        let startingRead = value == "currently_reading" && state != value
        busy = true; defer { busy = false }
        if state == value {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: bookId, state: "none")
            }
            state = nil
        } else {
            await ReadingStateAlert.shared.perform {
                try await APIClient.shared.setReadingState(bookId: bookId, state: value)
            }
            state = value
        }
        onChanged?(state)
        if startingRead { activeFormatSheetOpen = true }
    }

    private func setState(_ value: String, date: String?, precision: String?) async {
        busy = true; defer { busy = false }
        await ReadingStateAlert.shared.perform {
            try await APIClient.shared.setReadingState(
            bookId: bookId, state: value,
            completionDate: date, completionPrecision: precision
            )
        }
        state = value
        onChanged?(state)
    }
}

/// The purple bordered "Owned · N" pill used beside the compact state pill.
struct OwnedPill: View {
    let count: Int

    var body: some View {
        if count > 0 {
            HStack(spacing: 6) {
                Image(systemName: "books.vertical").font(.system(size: 12))
                Text(count == 1 ? "Owned" : "Owned · \(count)")
                    .font(Theme.body(14, .medium))
            }
            .foregroundStyle(Theme.neonPurple)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(Capsule().stroke(Theme.neonPurple.opacity(0.35), lineWidth: 1.5))
        }
    }
}

/// Web compact-owned-button.tsx parity (2026-07-22): ALWAYS visible — solid
/// purple when any format is owned, translucent outline when none — and taps
/// open a format checklist that writes owned formats directly from the list.
struct CompactOwnedButton: View {
    let bookId: String
    @State var formats: Set<String>
    var onDropdownChange: ((Bool) -> Void)? = nil

    @State private var open = false
    @State private var busy = false
    /// Web parity (owned-button.tsx): a checked format offers "Specify
    /// edition", opening the OpenLibrary picker. The book page's own Owned
    /// sheet had this; the compact pill didn't (punch list #8, 2026-08-08).
    @State private var editionFormat: String?

    init(bookId: String, formats: [String], onDropdownChange: ((Bool) -> Void)? = nil) {
        self.bookId = bookId
        _formats = State(initialValue: Set(formats.filter { $0 != "unknown" }))
        self.onDropdownChange = onDropdownChange
    }

    private let all: [(String, String, String)] = [
        ("hardcover", "book.closed", "Hardcover"),
        ("paperback", "book", "Paperback"),
        ("ebook", "ipad", "eBook"),
        ("audiobook", "headphones", "Audiobook"),
    ]

    private var isOwned: Bool { !formats.isEmpty }

    var body: some View {
        Button {
            withAnimation(.easeOut(duration: 0.12)) { open.toggle() }
            onDropdownChange?(open)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "books.vertical").font(.system(size: 12))
                Text(isOwned ? (formats.count == 1 ? "Owned" : "Owned · \(formats.count)") : "Owned")
                    .font(Theme.body(14, .medium))
            }
            .foregroundStyle(isOwned ? .white : Theme.muted)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(isOwned ? AnyShapeStyle(Theme.neonPurple) : AnyShapeStyle(Theme.neonPurple.opacity(0.1)))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Theme.neonPurple.opacity(isOwned ? 1 : 0.4), lineWidth: 1.5))
        }
        .opacity(busy ? 0.6 : 1)
        .overlay(alignment: .topLeading) { dropdown }
        .zIndex(open ? 40 : 0)
        .sheet(isPresented: Binding(
            get: { editionFormat != nil },
            set: { if !$0 { editionFormat = nil } }
        )) {
            if let format = editionFormat {
                EditionPickerSheet(bookId: bookId, format: format, onChanged: {})
                    .presentationDetents([.large])
                    .presentationBackground(Theme.bg)
            }
        }
    }

    @ViewBuilder private var dropdown: some View {
        if open {
            VStack(spacing: 0) {
                ForEach(all, id: \.0) { key, icon, label in
                    Button {
                        Task { await toggle(key) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: formats.contains(key) ? "checkmark.square.fill" : "square")
                                .font(.system(size: 14))
                                .foregroundStyle(formats.contains(key) ? Theme.neonPurple : Theme.muted)
                            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(Theme.muted)
                            Text(label)
                                .font(Theme.body(13, formats.contains(key) ? .medium : .regular))
                                .foregroundStyle(formats.contains(key) ? Theme.foreground : Theme.muted)
                            Spacer()
                        }
                        .padding(.horizontal, 12).padding(.vertical, 9)
                    }
                    if formats.contains(key) {
                        Button {
                            editionFormat = key
                        } label: {
                            HStack(spacing: 3) {
                                Text("Specify edition")
                                    .font(Theme.body(11, .medium))
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 8, weight: .semibold))
                                Spacer()
                            }
                            .foregroundStyle(Theme.neonPurple)
                            .padding(.leading, 34).padding(.trailing, 12)
                            .padding(.bottom, 8)
                        }
                    }
                    if key != "audiobook" { Divider().background(Theme.border.opacity(0.5)) }
                }
            }
            .frame(width: 170)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 12, y: 4)
            .offset(y: 42)
        }
    }

    private func toggle(_ key: String) async {
        busy = true; defer { busy = false }
        var next = formats
        if next.contains(key) { next.remove(key) } else { next.insert(key) }
        do {
            try await APIClient.shared.setFormats(bookId: bookId, owned: Array(next))
            formats = next
        } catch { /* keep prior state on failure */ }
    }
}

/// Format picker shown right after a book is moved to Reading Now from a
/// compact row (punch list #8). Self-contained because the compact pill
/// doesn't carry the book payload: it pre-fills with whatever the server
/// guessed from owned formats, which the reader can then correct.
struct ActiveFormatSheet: View {
    let bookId: String
    @Environment(\.dismiss) private var dismiss

    @State private var selected: [String] = []
    @State private var loaded = false

    private let formats = [("hardcover", "Hardcover"), ("paperback", "Paperback"),
                           ("ebook", "eBook"), ("audiobook", "Audiobook")]

    private struct Res: Codable {
        struct UserState: Codable { let activeFormats: [String]? }
        let ok: Bool
        let userState: UserState?
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("How are you reading it?")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)
            ForEach(formats, id: \.0) { value, label in
                Button {
                    if selected.contains(value) { selected.removeAll { $0 == value } }
                    else { selected.append(value) }
                } label: {
                    HStack {
                        Image(systemName: selected.contains(value) ? "checkmark.square.fill" : "square")
                            .foregroundStyle(selected.contains(value) ? Theme.accent : Theme.muted)
                        Text(label)
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.foreground)
                        Spacer()
                    }
                    .padding(.vertical, 6)
                }
            }
            Button("Save") {
                Task { try? await APIClient.shared.setFormats(bookId: bookId, active: selected) }
                dismiss()
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(!loaded)
        }
        .padding(20)
        .task {
            let res: Res? = try? await APIClient.shared.get("/api/v1/books/\(bookId)")
            selected = res?.userState?.activeFormats ?? []
            loaded = true
        }
    }
}
