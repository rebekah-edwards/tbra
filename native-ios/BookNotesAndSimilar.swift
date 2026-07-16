import SwiftUI

// Reading Notes on the book page (book-reading-notes.tsx): note cards
// with progress/mood/pace pills, the privacy toggle (private by default,
// lime when shared), and delete. Plus More Like This (similar-books.tsx):
// personalized cover rail with match reasons.

struct BookNotesSection: View {
    let bookId: String
    let notes: [BookNote]
    let onChanged: () -> Void
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Reading Notes")
            if expanded || notes.count == 1 {
                VStack(spacing: 10) {
                    ForEach(notes) { note in
                        BookNoteCard(note: note, onChanged: onChanged)
                    }
                }
                if notes.count > 1 {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { expanded = false }
                    } label: {
                        Text("Show latest only")
                            .font(Theme.body(13, .medium))
                            .foregroundStyle(Theme.neonBlue)
                            .frame(maxWidth: .infinity)
                    }
                }
            } else if let latest = notes.first {
                // Collapsed: the most recent note rides on a disappearing
                // stack of the older ones (profile-journal peek pattern);
                // "View all" opens the full list (user request 2026-07-14).
                ZStack {
                    if notes.count >= 3 {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Theme.surface.opacity(0.3))
                            .overlay(RoundedRectangle(cornerRadius: 14)
                                .stroke(Theme.border.opacity(0.4), lineWidth: 1))
                            .padding(.horizontal, 24)
                            .offset(y: 12)
                    }
                    RoundedRectangle(cornerRadius: 14)
                        .fill(Theme.surface.opacity(0.45))
                        .overlay(RoundedRectangle(cornerRadius: 14)
                            .stroke(Theme.border.opacity(0.55), lineWidth: 1))
                        .padding(.horizontal, 12)
                        .offset(y: 6)
                    BookNoteCard(note: latest, onChanged: onChanged)
                }
                .padding(.bottom, 12)
                Button {
                    withAnimation(.easeOut(duration: 0.2)) { expanded = true }
                } label: {
                    Text("View all \(notes.count) notes")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.neonBlue)
                        .frame(maxWidth: .infinity)
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
            if books.isEmpty {
                // NOT EmptyView: an EmptyView never "appears", so the
                // onAppear fetch below would never fire — the section was
                // permanently dead on iOS 27 (found 2026-07-14). A 1pt clear
                // placeholder participates in layout and triggers it.
                Color.clear.frame(height: 1)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    // Web heading is "Similar Books" (similar-books.tsx)
                    SectionHeading("Similar Books")
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(books) { book in
                                NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                                    // Web card = cover + italic reason ONLY
                                    // (no title/author — user request 2026-07-15).
                                    VStack(alignment: .leading, spacing: 5) {
                                        CoverThumb(url: book.coverImageUrl, width: 120, height: 180, radius: 8)
                                        if let reason = reasons[book.id], !reason.isEmpty {
                                            Text(reason)
                                                .font(Theme.body(10).italic())
                                                .foregroundStyle(Theme.muted.opacity(0.7))
                                                .lineLimit(3)
                                                .multilineTextAlignment(.center)
                                                .frame(width: 120)
                                        }
                                    }
                                    .frame(width: 120, alignment: .leading)
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
        // onAppear + UNSTRUCTURED Task on purpose: .task is cancelled the
        // moment the section scrolls back off-screen (iOS 27 fires appear
        // lazily for scroll content), so a fast scroll-past killed the fetch
        // mid-flight and `loaded` blocked every retry — the section then
        // never rendered (found 2026-07-14, same for the series rail).
        .onAppear {
            guard !loaded else { return }
            loaded = true
            Task {
                struct Row: Codable {
                    let id: String; let slug: String?; let title: String
                    let coverImageUrl: String?; let authors: [String]
                    let reason: String?; let hasContentConflict: Bool
                }
                struct Res: Codable { let ok: Bool; let results: [Row] }
                do {
                    let res: Res = try await APIClient.shared.get("/api/v1/books/\(bookId)/similar")
                    books = res.results.map {
                        LiteBook(id: $0.id, slug: $0.slug, title: $0.title, coverImageUrl: $0.coverImageUrl,
                                 authors: $0.authors, aggregateRating: nil, hasContentConflict: $0.hasContentConflict)
                    }
                    for row in res.results where row.reason != nil { reasons[row.id] = row.reason }
                } catch {
                    NSLog("TBRA-DEBUG similar books failed: %@", String(describing: error))
                }
            }
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
            if books.isEmpty {
                // See SimilarBooksSection — EmptyView never appears, which
                // dead-locked the onAppear fetch forever.
                Color.clear.frame(height: 1)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionHeading("More In This Series")
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
                    // Web book-series.tsx: 120pt cards, the CURRENT book is
                    // INCLUDED with a lime ring and the rail auto-centers on
                    // it; siblings render at 80% opacity.
                    ScrollViewReader { proxy in
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 12) {
                                ForEach(books) { book in
                                    let isCurrent = book.id == currentBookId
                                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                                        VStack(alignment: .leading, spacing: 5) {
                                            CoverThumb(url: book.coverImageUrl, width: 120, height: 180, radius: 8)
                                                .overlay {
                                                    if isCurrent {
                                                        RoundedRectangle(cornerRadius: 8)
                                                            .stroke(Theme.accent, lineWidth: 2)
                                                            .padding(-4)
                                                    }
                                                }
                                                .opacity(isCurrent ? 1 : 0.8)
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
                                                .frame(width: 120, alignment: .leading)
                                        }
                                    }
                                    .disabled(isCurrent)
                                    .id(book.id)
                                }
                            }
                            .padding(.vertical, 6)
                            // Leading room for the current-book ring — it
                            // draws 4pt OUTSIDE the cover and was clipped
                            // when the current book is first in the rail.
                            .padding(.leading, 5)
                            .padding(.trailing, 32)
                        }
                        .mask(
                            LinearGradient(stops: [
                                .init(color: .black, location: 0),
                                .init(color: .black, location: 0.85),
                                .init(color: .clear, location: 1),
                            ], startPoint: .leading, endPoint: .trailing)
                        )
                        .onChange(of: books) {
                            proxy.scrollTo(currentBookId, anchor: .center)
                        }
                    }
                }
            }
        }
        // Unstructured Task — see SimilarBooksSection: .task cancels on
        // scroll-past and the section never recovered.
        .onAppear {
            guard !loaded else { return }
            loaded = true
            Task {
                struct Res: Codable { let ok: Bool; let name: String; let books: [SeriesBookRow] }
                do {
                    let res: Res = try await APIClient.shared.get("/api/v1/series/\(series.slug ?? series.id)")
                    // Web filter: only integer-position "core" books (drops .5
                    // novellas and unnumbered volumes), box sets excluded.
                    books = res.books.filter { book in
                        guard !book.isBoxSet, let pos = book.position else { return false }
                        return pos.truncatingRemainder(dividingBy: 1) == 0
                    }
                } catch {
                    NSLog("TBRA-DEBUG series rail failed: %@", String(describing: error))
                }
            }
        }
    }
}
