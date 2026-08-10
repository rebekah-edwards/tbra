import SwiftUI

// Reviews list — recreates /book/[id]/reviews (review-list-client +
// review-card.tsx): reviewer header (avatar, name — "Anonymous reader"
// when anonymous), stars, DNF badge, mood, review text, descriptor tag
// chips, dimension mini-ratings, and the helpful-vote pill.

struct ReviewsRoute: Hashable {
    let bookIdOrSlug: String
    let bookTitle: String
    /// Scroll to (and highlight) this review on arrival — used by the
    /// Friends Activity cards, which link to the individual review.
    var scrollToReviewId: String? = nil
}

struct BookReviewEntry: Codable, Hashable, Identifiable {
    let id: String
    let userId: String
    let displayName: String?
    let username: String?
    let avatarUrl: String?
    let isAnonymous: Bool
    let overallRating: Double?
    let mood: String?
    let reviewText: String?
    let didNotFinish: Bool
    let dnfPercentComplete: Int?
    let createdAt: String
    let dimensionRatings: [String: Double?]
    let dimensionTags: [String: [String]]
    let helpfulCount: Int
    let currentUserVoted: Bool
}

@MainActor
@Observable
final class ReviewsListModel {
    let bookIdOrSlug: String
    var reviews: [BookReviewEntry] = []
    var loaded = false

    init(bookIdOrSlug: String) { self.bookIdOrSlug = bookIdOrSlug }

    func load() async {
        struct Res: Codable { let ok: Bool; let reviews: [BookReviewEntry] }
        if let res: Res = try? await APIClient.shared.get("/api/v1/books/\(bookIdOrSlug)/reviews") {
            reviews = res.reviews
            loaded = true
        }
    }

    func toggleHelpful(_ review: BookReviewEntry) async {
        guard let i = reviews.firstIndex(where: { $0.id == review.id }) else { return }
        let wasVoted = reviews[i].currentUserVoted
        // optimistic swap
        var updated = reviews[i]
        updated = BookReviewEntry(
            id: updated.id, userId: updated.userId, displayName: updated.displayName,
            username: updated.username, avatarUrl: updated.avatarUrl, isAnonymous: updated.isAnonymous,
            overallRating: updated.overallRating, mood: updated.mood, reviewText: updated.reviewText,
            didNotFinish: updated.didNotFinish, dnfPercentComplete: updated.dnfPercentComplete,
            createdAt: updated.createdAt, dimensionRatings: updated.dimensionRatings,
            dimensionTags: updated.dimensionTags,
            helpfulCount: updated.helpfulCount + (wasVoted ? -1 : 1),
            currentUserVoted: !wasVoted
        )
        reviews[i] = updated
        struct Body: Codable, Sendable { let helpfulReviewId: String }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request(
            "/api/v1/books/\(bookIdOrSlug)/reviews", method: "POST",
            json: Body(helpfulReviewId: review.id))
    }
}

struct ReviewsListView: View {
    @Environment(\.dismiss) private var dismiss
    let bookTitle: String
    /// When set, scroll to this review after load and highlight it briefly.
    var scrollToReviewId: String? = nil
    @State private var model: ReviewsListModel

    init(bookIdOrSlug: String, bookTitle: String, scrollToReviewId: String? = nil) {
        self.bookTitle = bookTitle
        self.scrollToReviewId = scrollToReviewId
        _model = State(initialValue: ReviewsListModel(bookIdOrSlug: bookIdOrSlug))
    }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Reviews")
                            .font(Theme.heading(24, .bold))
                            .foregroundStyle(Theme.foreground)
                        // Tappable — opens the book itself (user request
                        // 2026-07-12: arriving from the profile there was no
                        // path from a review to its book).
                        NavigationLink(value: BookRoute(idOrSlug: model.bookIdOrSlug)) {
                            HStack(spacing: 3) {
                                Text(bookTitle)
                                    .font(Theme.body(13, .medium))
                                    .lineLimit(1)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 9, weight: .semibold))
                            }
                            .foregroundStyle(Theme.neonBlue)
                        }
                    }
                }
                .padding(.top, 14)

                if model.reviews.isEmpty {
                    Text(model.loaded ? "No reviews yet — be the first!" : "Loading…")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else {
                    ForEach(model.reviews) { review in
                        reviewCard(review)
                            .id(review.id)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Theme.accent.opacity(
                                        review.id == scrollToReviewId ? 0.7 : 0), lineWidth: 2)
                            )
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load()
            if let target = scrollToReviewId {
                try? await Task.sleep(for: .milliseconds(150))
                withAnimation { proxy.scrollTo(target, anchor: .center) }
            }
        }
        .refreshable { await model.load() }
        }
    }

    private func reviewCard(_ review: BookReviewEntry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            // Reviewer header
            HStack(spacing: 10) {
                Group {
                    if review.isAnonymous {
                        ZStack {
                            Theme.surfaceAlt
                            Image(systemName: "person.fill.questionmark")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.muted)
                        }
                    } else if let avatarUrl = review.avatarUrl, let url = URL(string: avatarUrl) {
                        AsyncImage(url: url) { image in
                            image.resizable().aspectRatio(contentMode: .fill)
                        } placeholder: { Theme.surfaceAlt }
                    } else {
                        ZStack {
                            Theme.neonPurple.opacity(0.3)
                            Text(String((review.displayName ?? review.username ?? "?").prefix(1)).uppercased())
                                .font(Theme.body(14, .bold))
                                .foregroundStyle(Theme.foreground)
                        }
                    }
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 1) {
                    Text(review.isAnonymous ? "Anonymous reader" : (review.displayName ?? review.username ?? "Reader"))
                        .font(Theme.body(14, .semibold))
                        .foregroundStyle(Theme.foreground)
                    Text(DateFmt.display(review.createdAt, precision: nil))
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.muted)
                }
                Spacer()
                if review.didNotFinish {
                    Text(review.dnfPercentComplete.map { "DNF @ \($0)%" } ?? "DNF")
                        .font(Theme.body(11, .medium))
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.orange.opacity(0.12), in: Capsule())
                } else if let rating = review.overallRating {
                    StarRow(rating: rating)
                }
            }

            if let text = review.reviewText, !text.isEmpty {
                // Reviews are stored as sanitized HTML — render it styled
                // (p/div/br/bold/italic/lists) with tap-to-reveal spoilers,
                // never as raw tags (user report 2026-07-14).
                ReviewHTMLText(html: text)
            }

            // Per-dimension breakdown — web review-card.tsx groups tags under
            // the dimension they describe, with that dimension's stars. The
            // old native card flattened every tag into one unlabelled row, so
            // "Simple" gave no clue whether it meant the prose or the plot,
            // and the per-dimension stars + pacing never rendered at all.
            reviewDimensionDetails(review)

            // Helpful pill
            Button {
                Task { await model.toggleHelpful(review) }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: review.currentUserVoted ? "hand.thumbsup.fill" : "hand.thumbsup")
                        .font(.system(size: 11))
                    Text(review.helpfulCount > 0 ? "Helpful · \(review.helpfulCount)" : "Helpful")
                        .font(Theme.body(12, .medium))
                }
                // accentText, not accent: lime-on-translucent-lime is
                // unreadable in light mode (it stays lime in dark).
                .foregroundStyle(review.currentUserVoted ? Theme.accentText : Theme.muted)
                .padding(.horizontal, 11).padding(.vertical, 6)
                .background(review.currentUserVoted ? Theme.accent.opacity(0.1) : Theme.surfaceAlt.opacity(0.5), in: Capsule())
                .overlay(Capsule().stroke(review.currentUserVoted ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1))
            }
        }
        .padding(14)
        .background(Theme.surface.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
    }

    /// Per-dimension stars + the tags that belong to that dimension, plus the
    /// plot's pacing chip. Mirrors the web card's "See all details" block.
    /// Fiction and nonfiction dimensions are both walked and empty ones
    /// dropped, so the row doesn't need to know which kind of book this is.
    @ViewBuilder
    private func reviewDimensionDetails(_ review: BookReviewEntry) -> some View {
        let ordered = FICTION_DIMENSIONS + NONFICTION_DIMENSIONS
        let rows: [(key: String, label: String, rating: Double?, tags: [String])] =
            ordered.compactMap { dim in
                let raw = review.dimensionTags[dim.key] ?? []
                let tags = raw.filter { !$0.hasPrefix("pacing:") && !$0.hasPrefix("custom:") }
                let rating = review.dimensionRatings[dim.key] ?? nil
                guard rating != nil || !tags.isEmpty else { return nil }
                return (dim.key, dim.label, rating, tags)
            }

        // "pacing:medium" rides along in the plot tags rather than its own field.
        let pacing = (review.dimensionTags["plot"] ?? [])
            .first(where: { $0.hasPrefix("pacing:") })
            .map { String($0.dropFirst("pacing:".count)) }

        if !rows.isEmpty || pacing != nil {
            VStack(alignment: .leading, spacing: 9) {
                Divider().opacity(0.5)

                ForEach(rows, id: \.key) { row in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 7) {
                            Text(row.label)
                                .font(Theme.body(11, .semibold))
                                .foregroundStyle(Theme.muted)
                            if let rating = row.rating {
                                StarRow(rating: rating, size: 11)
                            }
                        }
                        if !row.tags.isEmpty {
                            FlowLayout(spacing: 6) {
                                ForEach(row.tags, id: \.self) { tag in
                                    Text(tag)
                                        .font(Theme.body(11, .medium))
                                        .foregroundStyle(Theme.foreground.opacity(0.85))
                                        .padding(.horizontal, 9).padding(.vertical, 4)
                                        .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
                                }
                            }
                        }
                    }
                }

                if let pacing {
                    HStack(spacing: 7) {
                        Text("Pacing")
                            .font(Theme.body(11, .semibold))
                            .foregroundStyle(Theme.muted)
                        Text(pacing.capitalized)
                            .font(Theme.body(11, .medium))
                            .foregroundStyle(Theme.foreground.opacity(0.85))
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
                    }
                }
            }
        }
    }
}

// ── Review HTML rendering — web review-card.tsx parity (2026-07-14) ──
// The editor saves sanitized HTML (p/div/br/strong/em/u/s/ul/ol/li/
// blockquote + span.spoiler-tag). The web renders it directly; natively we
// parse to styled segments. Spoilers reproduce the web effect exactly:
// text hidden by a solid surface-alt chip (transparent text, NOT blur),
// tap to reveal, tap again to re-hide — each spoiler independently.

enum ReviewHTML {
    struct Segment: Hashable {
        var text: String
        var bold = false
        var italic = false
        var underline = false
        var strike = false
        var spoilerIndex: Int? = nil
    }

    static func parse(_ html: String) -> [Segment] {
        var segments: [Segment] = []
        var current = ""
        var bold = 0, italic = 0, underline = 0, strike = 0
        var spoilerDepth = 0
        var spoilerCount = 0
        var currentSpoiler: Int? = nil

        func flush() {
            guard !current.isEmpty else { return }
            segments.append(Segment(
                text: current, bold: bold > 0, italic: italic > 0,
                underline: underline > 0, strike: strike > 0,
                spoilerIndex: currentSpoiler))
            current = ""
        }
        func newline(_ n: Int = 1) {
            // Collapse runs — never more than one blank line.
            let trailing = current.isEmpty
                ? (segments.last?.text.suffix(2) ?? "")
                : current.suffix(2)
            if trailing.hasSuffix("\n\n") { return }
            current += trailing.hasSuffix("\n") ? String(repeating: "\n", count: max(0, n - 1)) : String(repeating: "\n", count: n)
        }

        var i = html.startIndex
        while i < html.endIndex {
            let ch = html[i]
            if ch == "<" {
                guard let close = html[i...].firstIndex(of: ">") else { break }
                let rawTag = String(html[html.index(after: i)..<close]).trimmingCharacters(in: .whitespaces)
                let isClosing = rawTag.hasPrefix("/")
                let name = rawTag.drop(while: { $0 == "/" })
                    .prefix(while: { $0.isLetter || $0.isNumber }).lowercased()
                switch name {
                case "br":
                    current += "\n"
                case "p", "div", "blockquote":
                    if isClosing { flush(); newline(2) }
                case "li":
                    if !isClosing { flush(); newline(1); current += "•  " }
                case "ul", "ol":
                    if isClosing { flush(); newline(2) }
                case "strong", "b":
                    flush(); bold += isClosing ? -1 : 1; bold = max(0, bold)
                case "em", "i":
                    flush(); italic += isClosing ? -1 : 1; italic = max(0, italic)
                case "u":
                    flush(); underline += isClosing ? -1 : 1; underline = max(0, underline)
                case "s", "strike", "del":
                    flush(); strike += isClosing ? -1 : 1; strike = max(0, strike)
                case "span":
                    if !isClosing && rawTag.contains("spoiler-tag") {
                        flush()
                        currentSpoiler = spoilerCount
                        spoilerDepth += 1
                        spoilerCount += 1
                    } else if isClosing && spoilerDepth > 0 {
                        flush()
                        spoilerDepth -= 1
                        if spoilerDepth == 0 { currentSpoiler = nil }
                    }
                default:
                    break // unknown tag — ignore
                }
                i = html.index(after: close)
            } else if ch == "&" {
                // Minimal entity decode (the sanitizer only emits these)
                let rest = html[i...]
                let entities: [(String, String)] = [
                    ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                    ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"), ("&nbsp;", " "),
                ]
                if let (ent, repl) = entities.first(where: { rest.hasPrefix($0.0) }) {
                    current += repl
                    i = html.index(i, offsetBy: ent.count)
                } else {
                    current += "&"
                    i = html.index(after: i)
                }
            } else {
                current += String(ch)
                i = html.index(after: i)
            }
        }
        flush()
        // Trim leading/trailing whitespace-only shape
        while let first = segments.first, first.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            segments.removeFirst()
        }
        while let last = segments.last, last.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            segments.removeLast()
        }
        if var last = segments.popLast() {
            while last.text.hasSuffix("\n") { last.text.removeLast() }
            segments.append(last)
        }
        return segments
    }

    static func attributed(_ segments: [Segment], revealed: Set<Int>, baseSize: CGFloat = 15) -> AttributedString {
        var out = AttributedString()
        for seg in segments {
            var part = AttributedString(seg.text)
            var font = Theme.body(baseSize)
            if seg.bold && seg.italic { font = Theme.body(baseSize, .bold).italic() }
            else if seg.bold { font = Theme.body(baseSize, .bold) }
            else if seg.italic { font = font.italic() }
            part.font = font
            if seg.underline { part.underlineStyle = .single }
            if seg.strike { part.strikethroughStyle = .single }
            if let idx = seg.spoilerIndex {
                part.link = URL(string: "tbra-spoiler://\(idx)")
                if revealed.contains(idx) {
                    part.foregroundColor = Theme.foreground.opacity(0.9)
                    part.backgroundColor = .clear
                } else {
                    // Web .spoiler-tag: transparent text over a solid
                    // surface-alt block.
                    part.foregroundColor = .clear
                    part.backgroundColor = Theme.surfaceAlt
                }
            } else {
                part.foregroundColor = Theme.foreground.opacity(0.9)
            }
            out += part
        }
        return out
    }
}

/// Drop-in replacement for the plain review Text — parses the stored HTML
/// and handles per-spoiler tap-to-reveal via link taps.
struct ReviewHTMLText: View {
    let html: String
    var baseSize: CGFloat = 15
    @State private var revealed: Set<Int> = []

    private var segments: [ReviewHTML.Segment] { ReviewHTML.parse(html) }

    var body: some View {
        Text(ReviewHTML.attributed(segments, revealed: revealed, baseSize: baseSize))
            .lineSpacing(2)
            .environment(\.openURL, OpenURLAction { url in
                if url.scheme == "tbra-spoiler", let idx = Int(url.host() ?? "") {
                    withAnimation(.easeOut(duration: 0.2)) {
                        if revealed.contains(idx) { revealed.remove(idx) }
                        else { revealed.insert(idx) }
                    }
                    return .handled
                }
                return .systemAction
            })
    }
}
