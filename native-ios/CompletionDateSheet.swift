import SwiftUI

// Completion-date sheet — recreates completion-date-picker.tsx: precision
// selector (Exact date / Month / Year — web defaults to MONTH), adaptive
// pickers, future dates blocked, and "Skip the date". Confirms with
// (dateString, precision) exactly like the web's onConfirm.

struct CompletionDateSheet: View {
    let title: String
    /// (date "YYYY-MM-DD" or nil, precision "exact"|"month"|"year" or nil)
    let onConfirm: (String?, String?) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var precision = "month"   // web default
    @State private var exactDate = Date()
    @State private var month: Int
    @State private var year: Int

    private let months = ["January", "February", "March", "April", "May", "June",
                          "July", "August", "September", "October", "November", "December"]
    private let years: [Int]
    private let currentMonth: Int
    private let currentYear: Int

    init(title: String, onConfirm: @escaping (String?, String?) -> Void) {
        self.title = title
        self.onConfirm = onConfirm
        let cal = Calendar.current
        let now = Date()
        let y = cal.component(.year, from: now)
        let m = cal.component(.month, from: now)
        currentYear = y
        currentMonth = m
        years = Array((y - 30)...y).reversed()
        _month = State(initialValue: m)
        _year = State(initialValue: y)
    }

    private var isFuture: Bool {
        precision == "month" && year == currentYear && month > currentMonth
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.heading(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Text("All selections are optional")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
            }

            Picker("", selection: $precision) {
                Text("Exact date").tag("exact")
                Text("Month").tag("month")
                Text("Year").tag("year")
            }
            .pickerStyle(.segmented)

            switch precision {
            case "exact":
                DatePicker("", selection: $exactDate, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .tint(Theme.accent)
                    .frame(maxHeight: 320)
            case "month":
                HStack(spacing: 0) {
                    Picker("Month", selection: $month) {
                        ForEach(1...12, id: \.self) { m in
                            Text(months[m - 1]).tag(m)
                        }
                    }
                    .pickerStyle(.wheel)
                    Picker("Year", selection: $year) {
                        ForEach(years, id: \.self) { y in
                            Text(String(y)).tag(y)
                        }
                    }
                    .pickerStyle(.wheel)
                }
                .frame(height: 140)
            default:
                Picker("Year", selection: $year) {
                    ForEach(years, id: \.self) { y in
                        Text(String(y)).tag(y)
                    }
                }
                .pickerStyle(.wheel)
                .frame(height: 140)
            }

            if isFuture {
                Text("That's in the future — pick an earlier month.")
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(Theme.destructive)
            }

            Button("Save") {
                let dateStr: String
                switch precision {
                case "exact":
                    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
                    dateStr = f.string(from: exactDate)
                case "month":
                    dateStr = String(format: "%04d-%02d-01", year, month)
                default:
                    dateStr = String(format: "%04d-01-01", year)
                }
                onConfirm(dateStr, precision)
                dismiss()
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(isFuture)

            Button("Skip the date") {
                onConfirm(nil, nil)
                dismiss()
            }
            .font(Theme.body(13, .medium))
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity)
        }
        .padding(20)
        .background(Theme.surface)
    }
}

// ── "What to Read Next" — post-completion-suggestions.tsx ──
// The web pops this bottom sheet ~500ms after a book is marked Finished, on
// top of the review wizard. iOS had neither (punch list #7, 2026-08-08).

struct PostCompletionSuggestion: Codable, Identifiable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let reason: String?
}

struct PostCompletionSheet: View {
    let bookId: String
    /// Opens a suggested book in the shell's chromed book cover.
    var onOpenBook: (String) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss

    @State private var seriesNext: PostCompletionSuggestion?
    @State private var similar: [PostCompletionSuggestion] = []
    @State private var loading = true
    @State private var started = false
    @State private var added: Set<String> = []

    private struct Res: Codable {
        let ok: Bool
        let seriesNext: PostCompletionSuggestion?
        let similarBooks: [PostCompletionSuggestion]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("What to Read Next")
                    .font(Theme.heading(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }

            if loading {
                ProgressView().tint(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let seriesNext {
                            section("CONTINUE THE SERIES", [seriesNext])
                        }
                        if !similar.isEmpty {
                            section("SIMILAR BOOKS", similar)
                        }
                    }
                }
            }
        }
        .padding(20)
        .background(Theme.surface)
        // .onAppear + a free-standing Task, NOT .task: the book page reloads
        // behind this sheet as it appears, and .task's view-lifetime
        // cancellation killed the request with NSURLError -999 every time.
        .onAppear {
            guard !started else { return }
            started = true
            Task {
                let res: Res? = try? await APIClient.shared
                    .get("/api/v1/books/\(bookId)/post-completion")
                seriesNext = res?.seriesNext
                similar = res?.similarBooks ?? []
                loading = false
                // Dismiss only when the server genuinely had nothing to
                // suggest — never on a failed request, which would flash the
                // sheet shut before it rendered.
                if res != nil && seriesNext == nil && similar.isEmpty { dismiss() }
            }
        }
    }

    private func section(_ label: String, _ books: [PostCompletionSuggestion]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(Theme.body(11, .semibold))
                .tracking(1.0)
                .foregroundStyle(Theme.muted)
            ForEach(books) { row($0) }
        }
    }

    private func row(_ book: PostCompletionSuggestion) -> some View {
        HStack(spacing: 12) {
            Button {
                dismiss()
                onOpenBook(book.slug ?? book.id)
            } label: {
                HStack(spacing: 12) {
                    CoverThumb(url: book.coverImageUrl, width: 40, height: 60, radius: 5, title: book.title)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(book.title)
                            .font(Theme.body(14, .semibold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(book.reason ?? book.authors.prefix(2).joined(separator: ", "))
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 4)
                }
            }
            .buttonStyle(.plain)

            Button {
                added.insert(book.id)
                Task {
                    try? await APIClient.shared.setReadingState(bookId: book.id, state: "tbr")
                }
            } label: {
                Text(added.contains(book.id) ? "Added" : "+ TBR")
                    .font(Theme.body(11, .semibold))
                    .foregroundStyle(added.contains(book.id) ? Theme.muted : Theme.onAccent)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(added.contains(book.id) ? Theme.surfaceAlt : Theme.accent, in: Capsule())
            }
            .disabled(added.contains(book.id))
        }
        .padding(10)
        .background(Theme.surfaceAlt.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
    }
}
