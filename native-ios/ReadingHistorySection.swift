import SwiftUI

// Reading History — recreates reading-history.tsx: one row per session
// (format icon, "MMM d, yyyy → MMM d, yyyy", Read #N badge for re-reads),
// tap to expand the per-session editor (start/finish date pickers, the
// format retro-tag toggles that drive Stats' pages-vs-listened split,
// delete w/ confirm), and the "+ Add re-read" flow.

struct ReadingHistorySection: View {
    let bookId: String
    let sessions: [ReadingSessionRow]
    let onChanged: () -> Void

    @State private var expandedId: String?
    @State private var showAddReread = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Reading History")

            VStack(spacing: 10) {
                ForEach(sessions) { session in
                    SessionRow(
                        bookId: bookId,
                        session: session,
                        expanded: expandedId == session.id,
                        onToggle: {
                            withAnimation(.easeOut(duration: 0.15)) {
                                expandedId = expandedId == session.id ? nil : session.id
                            }
                        },
                        onChanged: onChanged
                    )
                }
            }

            Button {
                showAddReread = true
            } label: {
                Label("Add re-read", systemImage: "plus")
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.neonBlue)
            }
            .sheet(isPresented: $showAddReread) {
                AddRereadSheet(bookId: bookId, onAdded: onChanged)
                    .presentationDetents([.medium])
                    .presentationBackground(Theme.surface)
            }
        }
    }
}

private struct SessionRow: View {
    let bookId: String
    let session: ReadingSessionRow
    let expanded: Bool
    let onToggle: () -> Void
    let onChanged: () -> Void

    @State private var startDate: Date = .init()
    @State private var endDate: Date = .init()
    @State private var pausedDate: Date = .init()
    @State private var hasEnd = false
    @State private var formats: Set<String>
    @State private var showDeleteConfirm = false
    @State private var busy = false

    init(bookId: String, session: ReadingSessionRow, expanded: Bool,
         onToggle: @escaping () -> Void, onChanged: @escaping () -> Void) {
        self.bookId = bookId
        self.session = session
        self.expanded = expanded
        self.onToggle = onToggle
        self.onChanged = onChanged
        _formats = State(initialValue: Set(session.activeFormats ?? []))
    }

    private var leadFormat: String? {
        // Web leadFormatIcon: ONE format → its own icon (hardcover ≠
        // paperback ≠ ebook ≠ audiobook); multiple → neutral stack.
        let f = session.activeFormats ?? []
        if f.isEmpty { return nil }
        if f.count == 1 { return FormatIcon.symbol(for: f[0]) }
        return "books.vertical"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 10) {
                    Image(systemName: leadFormat ?? "book.closed")
                        .font(.system(size: 14))
                        .foregroundStyle(leadFormat != nil ? Theme.neonBlue : Theme.muted.opacity(0.5))
                        .frame(width: 22)
                    Text(rangeLabel)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.foreground.opacity(0.9))
                    if session.readNumber > 1 {
                        Text("Read #\(session.readNumber)")
                            .font(Theme.body(11, .medium))
                            .foregroundStyle(Theme.neonPurple)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .overlay(Capsule().stroke(Theme.neonPurple.opacity(0.4), lineWidth: 1))
                    }
                    if session.state == "currently_reading" {
                        // Green pill ⇒ BLACK text, always (brand rule; the
                        // lime-on-lime version was unreadable — 2026-07-15).
                        Text("Reading")
                            .font(Theme.body(11, .semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Theme.accent, in: Capsule())
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .padding(14)
            }

            if expanded {
                editor
                    .padding(.horizontal, 14)
                    .padding(.bottom, 14)
            }
        }
        .background(Theme.surface.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
        .onAppear { seedDates() }
        .confirmationDialog("Delete this reading session?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete session", role: .destructive) {
                Task {
                    struct Ok: Codable { let ok: Bool }
                    let _: Ok? = try? await APIClient.shared.request("/api/v1/reading-sessions/\(session.id)", method: "DELETE")
                    onChanged()
                }
            }
        }
    }

    private var rangeLabel: String {
        let start = DateFmt.display(session.startedAt, precision: session.startedAtExplicit == true ? "exact" : nil)
        if let completion = session.completionDate {
            return "\(start) → \(DateFmt.display(completion, precision: session.completionPrecision))"
        }
        return session.state == "currently_reading" ? "Started \(start)" : start
    }

    private func seedDates() {
        if let s = session.startedAt, let d = DateFmt.parse(s) { startDate = d }
        if let c = session.completionDate, let d = DateFmt.parse(c) { endDate = d; hasEnd = true }
        if let p = session.pausedAt, let d = DateFmt.parse(p) { pausedDate = d }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider().background(Theme.border.opacity(0.6))

            DatePicker("Started", selection: $startDate, displayedComponents: .date)
                .font(Theme.body(14))
                .tint(Theme.accent)
                .onChange(of: startDate) { save(["startedAt": DateFmt.iso(startDate)]) }

            // Paused date — only for paused sessions, mirroring the web
            // session editor (user request 2026-07-22: couldn't move a
            // pause date from iOS at all).
            if session.state == "paused" {
                DatePicker("Paused", selection: $pausedDate, displayedComponents: .date)
                    .font(Theme.body(14))
                    .tint(Theme.accent)
                    .onChange(of: pausedDate) { save(["pausedAt": DateFmt.iso(pausedDate)]) }
            }

            if session.state != "currently_reading" {
                HStack {
                    DatePicker("Finished", selection: $endDate, displayedComponents: .date)
                        .font(Theme.body(14))
                        .tint(Theme.accent)
                        .disabled(!hasEnd)
                        .onChange(of: endDate) { if hasEnd { save(["completionDate": DateFmt.iso(endDate)]) } }
                    Toggle("", isOn: $hasEnd)
                        .labelsHidden()
                        .tint(Theme.accent)
                        .onChange(of: hasEnd) {
                            save(["completionDate": hasEnd ? DateFmt.iso(endDate) : nil])
                        }
                }
            }

            Text("FORMAT")
                .font(Theme.body(10, .semibold)).tracking(1.2)
                .foregroundStyle(Theme.muted)
            // 2×2 grid: four chips in one HStack overflowed the card and
            // wrapped mid-word ("Hardcov/er" — user report 2026-07-22).
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)],
                      alignment: .leading, spacing: 8) {
                formatChip("hardcover", icon: "book.closed", label: "Hardcover")
                formatChip("paperback", icon: "book", label: "Paperback")
                formatChip("ebook", icon: "ipad", label: "eBook")
                formatChip("audiobook", icon: "headphones", label: "Audio")
            }

            Button {
                showDeleteConfirm = true
            } label: {
                Label("Delete session", systemImage: "trash")
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(Theme.destructive)
            }
            .padding(.top, 2)
        }
        .opacity(busy ? 0.6 : 1)
    }

    private func formatChip(_ key: String, icon: String, label: String) -> some View {
        let selected = formats.contains(key)
        return Button {
            if selected { formats.remove(key) } else { formats.insert(key) }
            save(["activeFormats": Array(formats)])
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11))
                Text(label).font(Theme.body(12, .medium)).lineLimit(1).fixedSize()
            }
            .foregroundStyle(selected ? Theme.accentText : Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(selected ? Theme.accent.opacity(0.12) : Theme.surfaceAlt.opacity(0.5), in: Capsule())
            .overlay(Capsule().stroke(selected ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1))
        }
    }

    private func save(_ fields: [String: Any?]) {
        busy = true
        Task {
            defer { busy = false }
            struct Patch: Codable, Sendable {
                var startedAt: String?
                var completionDate: String??
                var pausedAt: String?
                var activeFormats: [String]?

                enum CodingKeys: String, CodingKey { case startedAt, completionDate, pausedAt, activeFormats }
                func encode(to encoder: Encoder) throws {
                    var c = encoder.container(keyedBy: CodingKeys.self)
                    try c.encodeIfPresent(startedAt, forKey: .startedAt)
                    if let completionDate {
                        try c.encode(completionDate, forKey: .completionDate) // encodes value or explicit null
                    }
                    try c.encodeIfPresent(pausedAt, forKey: .pausedAt)
                    try c.encodeIfPresent(activeFormats, forKey: .activeFormats)
                }
            }
            var patch = Patch()
            if let v = fields["startedAt"] as? String { patch.startedAt = v }
            if fields.keys.contains("completionDate") { patch.completionDate = .some(fields["completionDate"] as? String) }
            if let v = fields["pausedAt"] as? String { patch.pausedAt = v }
            if let v = fields["activeFormats"] as? [String] { patch.activeFormats = v }
            struct Ok: Codable { let ok: Bool }
            let _: Ok? = try? await APIClient.shared.request("/api/v1/reading-sessions/\(session.id)", method: "PATCH", json: patch)
            onChanged()
        }
    }
}

private struct AddRereadSheet: View {
    let bookId: String
    let onAdded: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var startDate = Date()
    @State private var endDate = Date()
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add a re-read")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
            DatePicker("Started", selection: $startDate, displayedComponents: .date)
                .tint(Theme.accent)
            DatePicker("Finished", selection: $endDate, displayedComponents: .date)
                .tint(Theme.accent)
            Button {
                saving = true
                Task {
                    struct Body: Codable, Sendable { let startedAt: String; let completionDate: String }
                    struct Ok: Codable { let ok: Bool }
                    let _: Ok? = try? await APIClient.shared.request(
                        "/api/v1/books/\(bookId)/reread", method: "POST",
                        json: Body(startedAt: DateFmt.iso(startDate), completionDate: DateFmt.iso(endDate)))
                    saving = false
                    onAdded()
                    dismiss()
                }
            } label: {
                if saving { ProgressView().tint(.black) } else { Text("Add") }
            }
            .buttonStyle(AccentButtonStyle())
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bg)
    }
}

/// Shared date parsing/formatting for session timestamps (ISO w/ or w/o
/// fractional seconds, or SQLite "YYYY-MM-DD HH:MM:SS").
enum DateFmt {
    static func parse(_ s: String) -> Date? {
        if let d = ISO8601DateFormatter().date(from: s) { return d }
        if let d = ISO8601DateFormatter.withFractional.date(from: s) { return d }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let d = f.date(from: s) { return d }
        let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd"
        return day.date(from: String(s.prefix(10)))
    }

    static func iso(_ d: Date) -> String {
        ISO8601DateFormatter.withFractional.string(from: d)
    }

    static func display(_ s: String?, precision: String?) -> String {
        guard let s, let date = parse(s) else { return "—" }
        let f = DateFormatter()
        switch precision {
        case "year": f.dateFormat = "yyyy"
        case "month": f.dateFormat = "MMM yyyy"
        default: f.dateFormat = "MMM d, yyyy"
        }
        return f.string(from: date)
    }
}
