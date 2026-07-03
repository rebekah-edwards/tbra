import SwiftUI

/// The compact reading-state split pill from the web's search results /
/// series rows (reading-state-button.tsx compact mode): main tap toggles
/// tbr/remove, chevron opens the 5-state dropdown, Finished/DNF intercept
/// into the completion date sheet. Owns its state optimistically.
struct CompactStatePill: View {
    let bookId: String
    @State var state: String?
    var onChanged: ((String?) -> Void)? = nil

    @State private var dropdownOpen = false
    @State private var showDatePicker = false
    @State private var pendingCompleteState = "completed"
    @State private var busy = false

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
            ) { date in
                Task { await setState(pendingCompleteState, date: date) }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.surface)
        }
    }

    @ViewBuilder private var dropdown: some View {
        if dropdownOpen {
            VStack(spacing: 0) {
                ForEach(states, id: \.0) { value, label in
                    Button {
                        dropdownOpen = false
                        Task { await selectState(value) }
                    } label: {
                        HStack {
                            Text(label)
                                .font(Theme.body(13, .medium))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                            if state == value { Text("✓").foregroundStyle(Theme.accent) }
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
            try? await APIClient.shared.setReadingState(bookId: bookId, state: "none")
            state = nil
        } else {
            try? await APIClient.shared.setReadingState(bookId: bookId, state: "tbr")
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
        busy = true; defer { busy = false }
        if state == value {
            try? await APIClient.shared.setReadingState(bookId: bookId, state: "none")
            state = nil
        } else {
            try? await APIClient.shared.setReadingState(bookId: bookId, state: value)
            state = value
        }
        onChanged?(state)
    }

    private func setState(_ value: String, date: String?) async {
        busy = true; defer { busy = false }
        try? await APIClient.shared.setReadingState(
            bookId: bookId, state: value,
            completionDate: date, completionPrecision: date != nil ? "exact" : nil
        )
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
