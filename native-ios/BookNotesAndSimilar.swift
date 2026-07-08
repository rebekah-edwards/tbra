import SwiftUI

// Reading Notes on the book page (book-reading-notes.tsx): note cards
// with progress/mood/pace pills, the privacy toggle (private by default,
// lime when shared), and delete. Plus More Like This (similar-books.tsx):
// personalized cover rail with match reasons.

struct BookNotesSection: View {
    let bookId: String
    let notes: [BookNote]
    let onChanged: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Reading Notes")
            VStack(spacing: 10) {
                ForEach(notes) { note in
                    BookNoteCard(note: note, onChanged: onChanged)
                }
            }
        }
    }
}

private struct BookNoteCard: View {
    let note: BookNote
    let onChanged: () -> Void
    @State private var busy = false
    @State private var showDeleteConfirm = false

    private static let moods: [String: (String, String)] = [
        "excited": ("🔥", "Excited"), "tense": ("😰", "Tense"), "emotional": ("😢", "Emotional"),
        "bored": ("😴", "Bored"), "relaxed": ("😌", "Relaxed"), "curious": ("🤔", "Curious"),
        "confused": ("😵", "Confused"), "nostalgic": ("🥹", "Nostalgic"),
    ]
    private static let paces: [String: (String, String)] = [
        "slow": ("🐢", "Slow"), "steady": ("🚶", "Steady"), "fast": ("🏃", "Fast"), "flying": ("🚀", "Flying"),
    ]

    private var isPrivate: Bool { note.isPrivate != false }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let pct = note.percentComplete { metaPill("\(pct)%") }
                if let page = note.pageNumber { metaPill("p. \(page)") }
                if let mood = note.mood, let m = Self.moods[mood] { metaPill("\(m.0) \(m.1)") }
                if let pace = note.pace, let p = Self.paces[pace] { metaPill("\(p.0) \(p.1)") }
                Spacer()
                Button {
                    busy = true
                    Task {
                        struct Ok: Codable { let ok: Bool; let isPrivate: Bool }
                        let _: Ok? = try? await APIClient.shared.request("/api/v1/reading-notes/\(note.id)", method: "PATCH")
                        busy = false
                        onChanged()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isPrivate ? "lock" : "person.2")
                            .font(.system(size: 9))
                        Text(isPrivate ? "Private" : "Shared")
                            .font(Theme.body(10, .medium))
                    }
                    .foregroundStyle(isPrivate ? Theme.muted : Theme.accent)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(isPrivate ? Theme.surfaceAlt.opacity(0.7) : Theme.accent.opacity(0.1), in: Capsule())
                }
                Button {
                    showDeleteConfirm = true
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.muted)
                }
            }
            Text(note.noteText)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground.opacity(0.9))
        }
        .padding(14)
        .opacity(busy ? 0.6 : 1)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border.opacity(0.7), lineWidth: 1))
        .confirmationDialog("Delete this note?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete note", role: .destructive) {
                Task {
                    struct Ok: Codable { let ok: Bool }
                    let _: Ok? = try? await APIClient.shared.request("/api/v1/reading-notes/\(note.id)", method: "DELETE")
                    onChanged()
                }
            }
        }
    }

    private func metaPill(_ text: String) -> some View {
        Text(text)
            .font(Theme.body(11, .medium))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
    }
}

// ── More Like This ──

struct SimilarBooksSection: View {
    let bookId: String
    @State private var books: [LiteBook] = []
    @State private var reasons: [String: String] = [:]
    @State private var loaded = false

    var body: some View {
        Group {
            if !books.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeading("More Like This")
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(books) { book in
                                NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        CoverThumb(url: book.coverImageUrl, width: 100, height: 150, radius: 8)
                                        Text(book.title)
                                            .font(Theme.body(12, .medium))
                                            .foregroundStyle(Theme.foreground.opacity(0.9))
                                            .lineLimit(2)
                                            .multilineTextAlignment(.leading)
                                        Text(book.authors.joined(separator: ", "))
                                            .font(Theme.body(11))
                                            .foregroundStyle(Theme.muted)
                                            .lineLimit(1)
                                        if let reason = reasons[book.id], !reason.isEmpty {
                                            Text(reason)
                                                .font(Theme.body(9, .medium))
                                                .foregroundStyle(Theme.accent)
                                                .lineLimit(2)
                                        }
                                    }
                                    .frame(width: 100, alignment: .leading)
                                }
                            }
                        }
                        .padding(.trailing, 32)
                    }
                    .mask(
                        LinearGradient(stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 0.85),
                            .init(color: .clear, location: 1),
                        ], startPoint: .leading, endPoint: .trailing)
                    )
                }
            }
        }
        .task {
            guard !loaded else { return }
            loaded = true
            struct Row: Codable {
                let id: String; let slug: String?; let title: String
                let coverImageUrl: String?; let authors: [String]
                let reason: String?; let hasContentConflict: Bool
            }
            struct Res: Codable { let ok: Bool; let results: [Row] }
            guard let res: Res = try? await APIClient.shared.get("/api/v1/books/\(bookId)/similar") else { return }
            books = res.results.map {
                LiteBook(id: $0.id, slug: $0.slug, title: $0.title, coverImageUrl: $0.coverImageUrl,
                         authors: $0.authors, aggregateRating: nil, hasContentConflict: $0.hasContentConflict)
            }
            for row in res.results where row.reason != nil { reasons[row.id] = row.reason }
        }
    }
}

// ── More in this Series — book-series.tsx rail ──
struct BookSeriesRail: View {
    let series: BookSeriesInfo
    let currentBookId: String
    @State private var books: [SeriesBookRow] = []
    @State private var loaded = false

    var body: some View {
        Group {
            if !books.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionHeading("More in this Series")
                        Spacer()
                        NavigationLink(value: SeriesRoute(slug: series.slug ?? series.id)) {
                            HStack(spacing: 3) {
                                Text("View all")
                                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                            }
                            .font(Theme.body(13, .medium))
                            .foregroundStyle(Theme.neonBlue)
                        }
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(books) { book in
                                NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        CoverThumb(url: book.coverImageUrl, width: 92, height: 138, radius: 8)
                                        if let pos = book.position {
                                            Text(pos.truncatingRemainder(dividingBy: 1) == 0
                                                 ? "Book \(Int(pos))" : "Book \(String(format: "%.1f", pos))")
                                                .font(Theme.body(11, .medium))
                                                .foregroundStyle(Theme.muted)
                                        }
                                        Text(book.title)
                                            .font(Theme.body(12, .medium))
                                            .foregroundStyle(Theme.foreground.opacity(0.9))
                                            .lineLimit(2)
                                            .multilineTextAlignment(.leading)
                                            .frame(width: 92, alignment: .leading)
                                    }
                                }
                            }
                        }
                        .padding(.trailing, 32)
                    }
                    .mask(
                        LinearGradient(stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 0.85),
                            .init(color: .clear, location: 1),
                        ], startPoint: .leading, endPoint: .trailing)
                    )
                }
            }
        }
        .task {
            guard !loaded else { return }
            loaded = true
            struct Res: Codable { let ok: Bool; let name: String; let books: [SeriesBookRow] }
            guard let res: Res = try? await APIClient.shared.get("/api/v1/series/\(series.slug ?? series.id)") else { return }
            books = res.books.filter { $0.id != currentBookId && !$0.isBoxSet }
        }
    }
}
