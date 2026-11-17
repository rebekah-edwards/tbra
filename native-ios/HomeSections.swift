import SwiftUI

// The home page's lower sections, recreated from the web components:
// Pick From Your Shelf (tbr-suggestion-card.tsx), Because You Liked
// (because-you-liked.tsx), Friends Activity (friends-activity.tsx),
// Discover Something New (page.tsx HorizontalScroll + book-card.tsx),
// the (?) InfoBubble, and the goal-edit sheet (reading-goal-card.tsx).

// ── BookCard — the site's cover card: bare cover, rating pill, conflict badge ──
struct BookCardMini: View {
    let book: LiteBook

    var body: some View {
        CoverThumb(url: book.coverImageUrl, width: 130, height: 195, radius: 10, title: book.title)
            .overlay(alignment: .bottomTrailing) {
                if let rating = book.aggregateRating, rating > 0 {
                    Text("\(String(format: "%.1f", rating)) ★")
                        .font(Theme.body(10, .medium))
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.5), in: Capsule())
                        .padding(6)
                }
            }
            .overlay(alignment: .topLeading) {
                if book.hasContentConflict {
                    Text("!")
                        .font(Theme.body(11, .bold))
                        .foregroundStyle(.black)
                        .frame(width: 20, height: 20)
                        .background(.yellow.opacity(0.9), in: Circle())
                        .padding(6)
                }
            }
    }
}

// ── Horizontal scroll row with the right-edge fade hint (.mask-fade-right) ──
struct HorizontalBookRow: View {
    let books: [LiteBook]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                ForEach(books) { book in
                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                        BookCardMini(book: book)
                    }
                }
            }
            .padding(.trailing, 48)
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

// ── (?) info bubble → dimmed modal, like info-bubble.tsx ──
struct InfoBubble: View {
    let text: String
    @State private var open = false

    var body: some View {
        Button {
            open = true
        } label: {
            Text("?")
                .font(Theme.body(11, .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 22, height: 22)
                .overlay(Circle().stroke(Theme.border, lineWidth: 1))
        }
        .sheet(isPresented: $open) {
            VStack(alignment: .leading, spacing: 12) {
                Text(text)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.foreground)
                Button("Got it") { open = false }
                    .buttonStyle(AccentButtonStyle())
            }
            .padding(20)
            .presentationDetents([.height(220)])
            .presentationBackground(Theme.surface)
        }
    }
}

// ── Pick From Your Shelf — tbr-suggestion-card.tsx, both states ──
struct TbrSuggestionCard: View {
    @Environment(\.openSearch) private var openSearch
    @State var book: TbrSuggestion?
    @State private var shuffling = false

    var body: some View {
        Group {
            if let book, DesignPreview.on {
                cardV2(book)
            } else if let book {
                VStack(spacing: 0) {
                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                        HStack(spacing: 16) {
                            CoverThumb(url: book.coverImageUrl, width: 70, height: 105, radius: 8, title: book.title)
                                .shadow(color: .black.opacity(0.3), radius: 5, y: 2)
                            VStack(alignment: .leading, spacing: 3) {
                                // .tbr-reason-tag — lime in dark mode; branded
                                // BLUE in light mode (lime is unreadable on the
                                // white card — user request 2026-07-11).
                                Text((book.reason ?? "From Your TBR").uppercased())
                                    .font(Theme.body(DesignPreview.on ? 11 : 10, DesignPreview.on ? .bold : .medium))
                                    .tracking(1.0)
                                    .foregroundStyle(DesignPreview.on ? Theme.muted : Color(dark: "a3e635", light: "0ea5e9"))
                                Text(book.title)
                                    .font(Theme.body(16, .bold))
                                    .foregroundStyle(Theme.foreground)
                                    .lineLimit(2)
                                if !book.authors.isEmpty {
                                    Text(book.authors.joined(separator: ", "))
                                        .font(Theme.body(14))
                                        .foregroundStyle(Theme.muted)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(16)
                    }

                    Divider().background(Theme.border)

                    Button {
                        Task { await shuffle() }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "shuffle")
                                .font(.system(size: 12))
                            Text(shuffling ? "Shuffling..." : "Show me another")
                                .font(Theme.body(12, .medium))
                        }
                        .foregroundStyle(DesignPreview.on ? Theme.neonBlue : Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                    }
                    .disabled(shuffling)
                }
                .background(Theme.surface.opacity(DesignPreview.on ? 0.8 : 1))
                .clipShape(RoundedRectangle(cornerRadius: DesignPreview.on ? 18 : 12))
                .overlay(RoundedRectangle(cornerRadius: DesignPreview.on ? 18 : 12)
                    .stroke(DesignPreview.on ? Theme.foreground.opacity(0.10) : Theme.border, lineWidth: 1))
            } else {
                // Empty state: "No owned TBR books yet. Find books to add"
                HStack(spacing: 4) {
                    Text("No owned TBR books yet.")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                    Button { openSearch() } label: {
                        Text("Find books to add")
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(DesignPreview.on ? Theme.neonBlue : Theme.accent)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .background(Theme.surface.opacity(DesignPreview.on ? 0.8 : 1))
                .clipShape(RoundedRectangle(cornerRadius: DesignPreview.on ? 18 : 12))
                .overlay(RoundedRectangle(cornerRadius: DesignPreview.on ? 18 : 12)
                    .stroke(DesignPreview.on ? Theme.foreground.opacity(0.10) : Theme.border, lineWidth: 1))
            }
        }
    }

    // Designed, not just matched (Rebekah, 2026-11-16: "doesn't vibe with the
    // rest"): the pick sits on its own cover art like the Reading Now and Up
    // Next cards around it, inside the wordmark-colour hairline the hero cards
    // use, with the cover tipped as if just pulled off the shelf. The reason
    // is a glass badge and shuffling is a real button, not a strip along the
    // bottom. Mirrors tbr-suggestion-card.tsx.
    private func cardV2(_ book: TbrSuggestion) -> some View {
        let route = BookRoute(idOrSlug: book.slug ?? book.id)
        return HStack(alignment: .center, spacing: 16) {
            NavigationLink(value: route) {
                CoverThumb(url: book.coverImageUrl, width: 80, height: 120, radius: 8, title: book.title)
                    .shadow(color: .black.opacity(0.45), radius: 12, y: 8)
                    .rotationEffect(.degrees(-3))
            }
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 6) {
                    Circle().fill(Theme.accent).frame(width: 7, height: 7)
                    Text(book.reason ?? "From your TBR")
                        .font(Theme.body(11, .semibold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                }
                .padding(.horizontal, 10).padding(.vertical, 5)
                .glassEffect(.regular, in: Capsule())

                NavigationLink(value: route) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(book.title)
                            .font(Theme.heading(19, .bold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        if !book.authors.isEmpty {
                            Text(book.authors.joined(separator: ", "))
                                .font(Theme.body(14))
                                .foregroundStyle(Theme.foreground.opacity(0.70))
                                .lineLimit(1)
                        }
                    }
                }

                Button {
                    Task { await shuffle() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "shuffle")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.neonBlue)
                        Text(shuffling ? "Shuffling…" : "Show me another")
                            .font(Theme.body(12, .semibold))
                            .foregroundStyle(Theme.foreground)
                    }
                    .padding(.horizontal, 13).padding(.vertical, 7)
                    .glassEffect(.regular, in: Capsule())
                }
                .disabled(shuffling)
            }
        }
        .padding(16)
        // The cover and text sit as one group in the MIDDLE of the card, not
        // against its left edge (Rebekah, 2026-11-16).
        .frame(maxWidth: .infinity, alignment: .center)
        .background(
            ZStack {
                Theme.surfaceAlt
                if let cover = book.coverImageUrl, let url = URL(string: cover) {
                    CoverBlurImage(url: url)
                    Theme.scrim
                }
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(LinearGradient(
                    colors: [Theme.accent.opacity(0.55), Theme.neonBlue.opacity(0.35),
                             Theme.neonPurple.opacity(0.45)],
                    startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
        )
        .opacity(shuffling ? 0.6 : 1)
        .animation(.easeOut(duration: 0.15), value: shuffling)
    }

    private func shuffle() async {
        shuffling = true; defer { shuffling = false }
        if let next = try? await APIClient.shared.shuffleTbrSuggestion() {
            book = next
        }
    }
}

// ── Because You Liked <seed> — because-you-liked.tsx ──
struct BecauseYouLikedSection: View {
    let section: BylSection

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                (Text("Because You Liked ")
                    .font(Theme.heading(15, .semibold))
                    .foregroundStyle(Theme.foreground)
                 + Text(section.seed.title)
                    .font(Theme.heading(15, .semibold).italic())
                    .foregroundStyle(Theme.foreground.opacity(0.8)))
                    .lineLimit(1)
                InfoBubble(text: "Based on the genres of books you've rated highly. Recommendations respect your content preferences and series reading order.")
            }
            HorizontalBookRow(books: section.books)
        }
    }
}

// ── Friends Activity — friends-activity.tsx ──
// Two tiers (2026-11 redesign, mirrors the web):
//   • a written review is the content — a wide card with the quote
//   • everything else (TBR'd, started, progress, finished, rated) is a small
//     glass tile: who, the cover, one caption line
// Reading notes are private to their author and never appear here.

extension ActivityItem {
    var hasProgress: Bool { (percentComplete ?? 0) > 0 || (pageNumber ?? 0) > 0 }
    /// Only a review with text gets the wide card; a bare rating is a tile.
    var isWrittenReview: Bool { type == "review" && !(reviewPreview ?? "").isEmpty }
    /// A reading entry whose author marked its note shared ("Visible to friends").
    var isSharedNote: Bool { type != "review" && !(notePreview ?? "").isEmpty }
    /// Anything with words to read gets the wide card: a written review or a shared note.
    var hasQuote: Bool { isWrittenReview || isSharedNote }
    /// A server that predates the redesign still sends `reading_note` items.
    /// One carrying a page/percent is shown as progress; one without is a
    /// private note and is dropped.
    var isFeedVisible: Bool { type != "reading_note" || hasProgress }
    /// One reader + book appears once in the feed, so that pair is the identity.
    var feedKey: String { "\(user.id)|\(book.id)" }

    /// The one caption line: SF Symbol, its tint, the short text for a tile,
    /// and the phrase that sits between the reader's name and the book title
    /// (list rows and VoiceOver).
    var feedCaption: (icon: String, tint: Color, text: String, spoken: String) {
        let stars: String? = {
            guard let rating, rating > 0 else { return nil }
            return friendsRatingText(rating)
        }()
        switch type {
        case "tbr":
            return ("bookmark.fill", Theme.neonBlue, "TBR'd", "added to TBR")
        case "currently_reading", "reading_note":
            if let pct = percentComplete, pct > 0 {
                let p = Int(pct.rounded())
                return ("book", Theme.accentText, "\(p)% read", "is \(p)% through")
            }
            if let page = pageNumber, page > 0 {
                return ("book", Theme.accentText, "p. \(page)", "is on page \(page) of")
            }
            return ("book", Theme.accentText, "Reading", "started reading")
        case "completed":
            return ("checkmark", Theme.neonBlue, "Finished", "finished")
        case "rating":
            return ("star.fill", Theme.accentText, stars ?? "Rated", stars.map { "rated \($0) stars" } ?? "rated")
        default:
            // A review with no text is a rating in practice.
            if let stars { return ("star.fill", Theme.accentText, stars, "rated \(stars) stars") }
            return ("pencil", Theme.neonPurple, "Reviewed", "reviewed")
        }
    }
}

enum FriendsFeedMetrics {
    static let reviewWidth: CGFloat = 236
    static let tileWidth: CGFloat = 116
    static let seeMoreWidth: CGFloat = 92
    static let bannerHeight: CGFloat = 92
    /// Row height when a review card is present (banner + 3-line quote), and
    /// when the row is tiles only.
    static let reviewRowHeight: CGFloat = 186
    static let tileRowHeight: CGFloat = 154
    static let corner: CGFloat = 12
    /// Text over the blurred cover — white on dark, near-black on the light
    /// frosted treatment (web .book-header-text flips the same way).
    static let overlayText = Color(dark: "ffffff", light: "18181b")
}

struct FriendsActivityRow: View {
    let activity: [ActivityItem]
    /// Card tap → book page (written reviews → the review itself); wired by HomeView.
    var onOpen: (ActivityItem) -> Void = { _ in }
    /// The trailing "See more" tile → the full activity list. Hidden when nil.
    var onSeeMore: (() -> Void)? = nil

    var body: some View {
        let items = activity.filter(\.isFeedVisible)
        let rowHeight = items.contains(where: \.hasQuote)
            ? FriendsFeedMetrics.reviewRowHeight
            : FriendsFeedMetrics.tileRowHeight
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    if item.hasQuote {
                        FriendsReviewCard(item: item, onOpen: { onOpen(item) })
                    } else {
                        FriendsActivityTile(item: item, height: rowHeight, onOpen: { onOpen(item) })
                    }
                }
                if let onSeeMore {
                    FriendsSeeMoreTile(height: rowHeight, action: onSeeMore)
                }
            }
            .padding(.trailing, 48)
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

/// Last tile in the rail: opens the full, endless activity list.
private struct FriendsSeeMoreTile: View {
    let height: CGFloat
    let action: () -> Void

    var body: some View {
        // Plain Button — see FriendsReviewCard.
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: "arrow.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.foreground)
                    .frame(width: 40, height: 40)
                    .background(Theme.surfaceAlt, in: Circle())
                    .overlay(Circle().stroke(Theme.foreground.opacity(0.15), lineWidth: 1))
                Text("See more")
                    .font(Theme.body(11, .semibold))
                    .foregroundStyle(Theme.foreground.opacity(0.8))
            }
            .frame(width: FriendsFeedMetrics.seeMoreWidth, height: height)
            .background(Theme.surface.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
            .overlay(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner).stroke(Theme.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("See more friends activity")
    }
}

// ── Tier 1: a written review ──
/// Fixed-size card in the home rail; `fullWidth` stretches it for the
/// activity list, where the quote also gets more lines.
struct FriendsReviewCard: View {
    let item: ActivityItem
    var fullWidth = false
    var onOpen: () -> Void = {}

    private let overlayText = FriendsFeedMetrics.overlayText
    private let bannerHeight = FriendsFeedMetrics.bannerHeight

    var body: some View {
        // Plain Button — NavigationLink(value:) dies in sibling-card runs on
        // iOS 27 (bug #3/#7 family); same cure as Reading Now / Up Next.
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 0) {
                banner
                cardBody
                if !fullWidth { Spacer(minLength: 0) }
            }
            .frame(width: fullWidth ? nil : FriendsFeedMetrics.reviewWidth,
                   height: fullWidth ? nil : FriendsFeedMetrics.reviewRowHeight, alignment: .topLeading)
            .frame(maxWidth: fullWidth ? .infinity : nil, alignment: .topLeading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
            .overlay(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner).stroke(Theme.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
        }
        .buttonStyle(.plain)
    }

    // Banner: blurred cover backdrop (CoverBlurImage — frame-bounded per the
    // iOS 27 rule, correct light-mode recipe) with the PERSON up top (avatar +
    // name + time) and the book image + title below — user request 2026-07-11.
    private var banner: some View {
        ZStack(alignment: .bottomLeading) {
            if let cover = item.book.coverImageUrl, let url = URL(string: cover) {
                CoverBlurImage(url: url).frame(height: bannerHeight)
                Theme.scrim.frame(height: bannerHeight).allowsHitTesting(false)
            } else {
                Theme.surfaceAlt.frame(height: bannerHeight)
            }

            HStack(alignment: .bottom, spacing: 8) {
                CoverThumb(url: item.book.coverImageUrl, width: 34, height: 50, radius: 4, title: item.book.title)
                    .shadow(color: .black.opacity(0.35), radius: 4, y: 2)
                Text(item.book.title)
                    .font(Theme.body(12, .bold))
                    .foregroundStyle(overlayText)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .padding(.bottom, 2)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
        }
        .frame(height: bannerHeight)
        .clipped()
        .overlay(alignment: .topLeading) {
            HStack(spacing: 6) {
                FriendsAvatar(user: item.user)
                Text(item.user.feedName)
                    .font(Theme.body(11, .semibold))
                    .foregroundStyle(overlayText)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(friendsTimeAgo(item.timestamp))
                    .font(Theme.body(10))
                    .foregroundStyle(overlayText.opacity(0.7))
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
        }
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                // Lime pill for a shared reading note, purple for a review.
                let tint = item.isSharedNote ? Theme.accent : Theme.neonPurple
                Text(item.isSharedNote ? "READING NOTE" : "REVIEWED")
                    .font(Theme.body(9, .semibold))
                    .tracking(0.5)
                    .foregroundStyle(item.isSharedNote ? Theme.accentText : Theme.neonPurple)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(tint.opacity(0.15), in: Capsule())
                    .overlay(Capsule().stroke(tint.opacity(0.2), lineWidth: 1))
                if item.isSharedNote {
                    if item.hasProgress {
                        Text(item.feedCaption.text)
                            .font(Theme.body(11, .medium))
                            .foregroundStyle(Theme.muted)
                    }
                } else if let rating = item.rating, rating > 0 {
                    StarRow(rating: rating)
                }
            }
            Text("\u{201C}\((item.isSharedNote ? item.notePreview : item.reviewPreview) ?? "")\u{201D}")
                .font(Theme.body(fullWidth ? 13 : 11))
                .foregroundStyle(Theme.foreground.opacity(0.75))
                .lineSpacing(2)
                .lineLimit(fullWidth ? 5 : 3)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
    }
}

// ── Tier 2: everything else ──
private struct FriendsActivityTile: View {
    let item: ActivityItem
    let height: CGFloat
    var onOpen: () -> Void = {}

    private let overlayText = FriendsFeedMetrics.overlayText
    private let width = FriendsFeedMetrics.tileWidth

    var body: some View {
        let caption = item.feedCaption
        // Plain Button — see FriendsReviewCard.
        Button(action: onOpen) {
            ZStack {
                // Frame-bounded backdrop (iOS 27 rule — see CoverBlurImage).
                if let cover = item.book.coverImageUrl, let url = URL(string: cover) {
                    CoverBlurImage(url: url).frame(width: width, height: height)
                    Theme.scrim.frame(width: width, height: height).allowsHitTesting(false)
                } else {
                    Theme.surfaceAlt.frame(width: width, height: height)
                }

                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 6) {
                        FriendsAvatar(user: item.user)
                        Text(item.user.feedFirstName)
                            .font(Theme.body(11, .semibold))
                            .foregroundStyle(overlayText)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }

                    Spacer(minLength: 6)
                    CoverThumb(url: item.book.coverImageUrl, width: 60, height: 90, radius: 6, title: item.book.title)
                        .shadow(color: .black.opacity(0.35), radius: 5, y: 2)
                        .frame(maxWidth: .infinity)
                    Spacer(minLength: 6)

                    HStack(spacing: 4) {
                        Image(systemName: caption.icon)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(caption.tint)
                        Text(caption.text)
                            .font(Theme.body(11, .semibold))
                            .foregroundStyle(overlayText)
                            .lineLimit(1)
                            .layoutPriority(1)
                        Spacer(minLength: 4)
                        Text(friendsTimeAgo(item.timestamp))
                            .font(Theme.body(10))
                            .foregroundStyle(overlayText.opacity(0.7))
                            .lineLimit(1)
                    }
                }
                .padding(8)
                .frame(width: width, height: height)
            }
            .frame(width: width, height: height)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
            .overlay(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner).stroke(Theme.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.user.feedName) \(caption.spoken) \(item.book.title)")
        .accessibilityAddTraits(.isButton)
    }
}

extension ActivityUser {
    var feedName: String { displayName ?? username ?? "Reader" }
    var feedFirstName: String {
        feedName.split(separator: " ").first.map(String.init) ?? feedName
    }
}

/// Avatar (lime fallback initial, like the web).
struct FriendsAvatar: View {
    let user: ActivityUser
    var size: CGFloat = 20

    var body: some View {
        Group {
            if let avatarUrl = user.avatarUrl,
               let url = avatarUrl.hasPrefix("/")
                   ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
                   : URL(string: avatarUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.accent }
            } else {
                ZStack {
                    Theme.accent
                    Text(String(user.feedName.prefix(1)).uppercased())
                        .font(Theme.body(size * 0.45, .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

/// "4.5", or "3.75" for quarter-star ratings (web formatRating).
func friendsRatingText(_ rating: Double) -> String {
    let frac = rating.truncatingRemainder(dividingBy: 1)
    let quarter = abs(frac - 0.25) < 0.01 || abs(frac - 0.75) < 0.01
    return String(format: quarter ? "%.2f" : "%.1f", rating)
}

/// Short relative time for the feed ("now", "12m", "3h", "5d", "Nov 2").
func friendsTimeAgo(_ timestamp: String) -> String {
    let monthDay: (Date) -> String = { date in
        let out = DateFormatter(); out.dateFormat = "MMM d"
        return out.string(from: date)
    }
    // Finish dates are calendar days with no time — count whole days.
    if timestamp.count == 10 {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let then = f.date(from: timestamp) else { return "" }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: then),
                                      to: cal.startOfDay(for: Date())).day ?? 0
        if days <= 0 { return "today" }
        if days < 30 { return "\(days)d" }
        return monthDay(then)
    }
    // Shared parser — handles ISO and the naive-UTC SQL form.
    guard let then = DateFmt.parse(timestamp) else { return "" }
    let diff = Date().timeIntervalSince(then)
    let minutes = Int(diff / 60), hours = Int(diff / 3600), days = Int(diff / 86400)
    if minutes < 1 { return "now" }
    if minutes < 60 { return "\(minutes)m" }
    if hours < 24 { return "\(hours)h" }
    if days < 30 { return "\(days)d" }
    return monthDay(then)
}

extension ISO8601DateFormatter {
    // Swift 6: formatters aren't Sendable; nonisolated(unsafe) is fine here —
    // it's configured once and only read afterwards.
    nonisolated(unsafe) static let withFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// 5-star display: lime filled stars, muted empty outlines (friends-activity.tsx).
struct StarRow: View {
    let rating: Double
    var size: CGFloat = 10

    var body: some View {
        HStack(spacing: size * 0.2) {
            ForEach(0..<5, id: \.self) { i in
                let full = Double(i) < rating.rounded(.down)
                let half = !full && rating - rating.rounded(.down) >= 0.25 && i == Int(rating.rounded(.down))
                Image(systemName: full ? "star.fill" : (half ? "star.leadinghalf.filled" : "star"))
                    .font(.system(size: size))
                    // Web stars are yellow-400 (rounded-star.tsx), NOT lime
                    .foregroundStyle(full || half ? Color(hex: "facc15") : Theme.muted.opacity(0.3))
            }
        }
    }
}

// ── Goal edit sheet — reading-goal-card.tsx editing state ──
struct GoalEditSheet: View {
    let year: Int
    let current: Int?
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var target: String = ""
    @State private var busy = false
    @State private var errorText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(current != nil ? "\(String(year)) Reading Goal" : "Set a \(String(year)) reading goal")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)

            HStack(spacing: 10) {
                TextField("24", text: $target)
                    .keyboardType(.numberPad)
                    .font(Theme.body(20, .bold))
                    .multilineTextAlignment(.center)
                    .frame(width: 90)
                    .padding(.vertical, 10)
                    .background(Theme.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                Text("books")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }

            if let errorText {
                Text(errorText).font(Theme.body(12)).foregroundStyle(Theme.destructive)
            }

            Button {
                Task { await save() }
            } label: {
                if busy { ProgressView().tint(Theme.onAccent) } else { Text("Save") }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(busy || Int(target) == nil)
        }
        .padding(20)
        .background(Theme.surface)
        .onAppear { target = current.map(String.init) ?? "24" }
    }

    private func save() async {
        guard let value = Int(target) else { return }
        busy = true; defer { busy = false }
        do {
            try await APIClient.shared.setReadingGoal(targetBooks: value)
            await onSaved()
            dismiss()
        } catch {
            errorText = (error as? APIError)?.errorDescription ?? "Couldn't save the goal."
        }
    }
}

// ── Refreshed goal ring + pace pill (2026-11), shared by Home and Stats ──
/// The lime→blue goal ring from the refreshed Home tile, reused on Stats.
struct GoalSweepRing: View {
    let percent: Int
    var lineWidth: CGFloat = 8
    var labelSize: CGFloat = 15
    /// How far through the year today is (0…1): drawn as a tick across the
    /// ring, so the arc reads against it — past the tick is ahead of pace,
    /// short of it is behind (Rebekah, 2026-11-16: "a white line at the point
    /// in the year on the circle where we are"). nil draws no tick.
    var yearElapsed: Double? = nil
    @State private var shown = false

    var body: some View {
        ZStack {
            Circle().stroke(Theme.foreground.opacity(0.10), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: shown ? max(0.02, min(1, CGFloat(percent) / 100)) : 0)
                .stroke(AngularGradient(colors: [Theme.accent, Theme.neonBlue, Theme.accent], center: .center),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: Theme.accent.opacity(0.45), radius: 6)
            if let yearElapsed {
                GeometryReader { geo in
                    let side = min(geo.size.width, geo.size.height)
                    Capsule()
                        .fill(Theme.foreground)
                        .frame(width: 2.5, height: lineWidth + 7)
                        .shadow(color: .black.opacity(0.5), radius: 1.5)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2 - side / 2)
                        .rotationEffect(.degrees(360 * min(1, max(0, yearElapsed))))
                }
                .opacity(shown ? 1 : 0)
                .accessibilityHidden(true)
            }
            Text("\(percent)%")
                .font(Theme.heading(labelSize, .bold))
                .foregroundStyle(Theme.foreground)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.9).delay(0.15)) { shown = true }
        }
    }
}

/// The status pill that sits with the ring ("3 ahead of pace", "18 to go").
struct GoalPacePill: View {
    let pace: (text: String, good: Bool)
    var body: some View {
        Label(pace.text, systemImage: pace.good ? "bolt.fill" : "flag.checkered")
            .font(Theme.body(12, .semibold))
            .foregroundStyle(pace.good ? Theme.accentText : Theme.foreground.opacity(0.75))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background((pace.good ? Theme.accent : Theme.foreground).opacity(0.14), in: Capsule())
    }
}

// ── First-run starter card (2026-11) ──
// The first thing a brand-new reader sees on Home, in place of two "nothing
// here" lines. Three ways in, most valuable first: bring an existing library
// over, add one book, or let Discover suggest something.
struct HomeStarterCard: View {
    let onSearch: () -> Void
    let onDiscover: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Let's build your library")
                    .font(Theme.heading(22, .bold))
                    .foregroundStyle(Theme.foreground)
                Text("Add a few books and tbr*a starts working for you.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
            VStack(spacing: 8) {
                row(icon: "tray.and.arrow.down.fill", tint: Color(hex: "fb923c"),
                    title: "Bring your library over",
                    blurb: "Import from Goodreads or StoryGraph in about a minute",
                    external: true) {
                    if let url = URL(string: "https://thebasedreader.app/import") {
                        UIApplication.shared.open(url)
                    }
                }
                row(icon: "magnifyingglass", tint: Theme.neonBlue,
                    title: "Find a book",
                    blurb: "Search by title, author or series", action: onSearch)
                row(icon: "sparkles", tint: Theme.neonPurple,
                    title: "Find your next read",
                    blurb: "Pick a mood and we'll match books to it", action: onDiscover)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(LinearGradient(
                    colors: [Theme.accent.opacity(0.55), Theme.neonBlue.opacity(0.35),
                             Theme.neonPurple.opacity(0.45)],
                    startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
        )
    }

    private func row(icon: String, tint: Color, title: String, blurb: String,
                     external: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(Theme.body(15, .bold)).foregroundStyle(Theme.foreground)
                    Text(blurb).font(Theme.body(12)).foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: external ? "arrow.up.right" : "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.muted.opacity(0.7))
            }
            .padding(10)
            .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
            .contentShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}

// ── Streak pieces (2026-11), shared by the Home tile and the Stats card ──
enum StreakStyle {
    static let flame = Color(hex: "fb923c")   // orange-400
    static let ember = Color(hex: "f43f5e")   // rose-500
    static let pending = Color(dark: "fbbf24", light: "b45309")   // amber
    static let gradient = [flame, ember]
}

extension ReadingStreak {
    var isAlive: Bool { currentStreak > 0 }
    /// A live streak that has not been extended today: safe until midnight,
    /// but only if the reader logs something.
    var pendingToday: Bool { currentStreak > 0 && activeToday == false }

    /// The one line under the bar: what today needs, or how far the record is.
    var footerLine: String {
        if currentStreak == 0 { return "Log anything today to light it" }
        if pendingToday { return "Log anything today to keep it" }
        if currentStreak >= longestStreak { return "Your best streak yet" }
        let gap = longestStreak - currentStreak
        return "\(gap) \(gap == 1 ? "day" : "days") to beat your best"
    }
}

/// Icon and title 4pt apart — the default Label gap wastes room in a pill.
struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}

/// Today's status, stated outright (Rebekah 2026-11-16): a filled lime check
/// once today counts, an amber outline while the streak still waits on today.
struct StreakTodayPill: View {
    let doneToday: Bool
    var body: some View {
        Label(doneToday ? "Today" : "Not yet",
              systemImage: doneToday ? "checkmark.circle.fill" : "circle.dashed")
            .font(Theme.body(11, .bold))
            .labelStyle(TightLabelStyle())
            .lineLimit(1)
            .fixedSize()   // never truncate: "Not…" says nothing
            .foregroundStyle(doneToday ? Theme.accentText : StreakStyle.pending)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background((doneToday ? Theme.accent : StreakStyle.pending).opacity(doneToday ? 0.22 : 0.12),
                        in: Capsule())
            .overlay(Capsule().stroke(doneToday ? Color.clear : StreakStyle.pending.opacity(0.55),
                                      lineWidth: 1))
            .accessibilityLabel(doneToday ? "Streak logged today" : "Streak not logged yet today")
    }
}

/// The flame. It pulses for as long as the streak is alive — most of all while
/// today is still open, when it is the nudge (Rebekah, 2026-11-16: "bring back
/// the pulsing fire symbol for before I've done something to log today"). The
/// glow is what arrives once today counts; the pill says it in words.
struct StreakFlame: View {
    let streak: ReadingStreak
    var size: CGFloat = 46
    var body: some View {
        Image(systemName: "flame.fill")
            .font(.system(size: size, weight: .bold))
            .foregroundStyle(
                streak.isAlive
                ? AnyShapeStyle(LinearGradient(colors: StreakStyle.gradient, startPoint: .top, endPoint: .bottom))
                : AnyShapeStyle(Theme.foreground.opacity(0.18)))
            .shadow(color: streak.isAlive && !streak.pendingToday ? StreakStyle.flame.opacity(0.55) : .clear,
                    radius: 10)
            .symbolEffect(.breathe, isActive: streak.isAlive)
    }
}

/// The bar that races the reader's own record.
struct StreakRaceBar: View {
    let streak: ReadingStreak
    var height: CGFloat = 5
    var body: some View {
        let best = max(streak.longestStreak, streak.currentStreak, 1)
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.foreground.opacity(0.10))
                Capsule()
                    .fill(LinearGradient(colors: StreakStyle.gradient, startPoint: .leading, endPoint: .trailing))
                    .frame(width: streak.isAlive
                           ? max(8, geo.size.width * CGFloat(streak.currentStreak) / CGFloat(best))
                           : 0)
            }
        }
        .frame(height: height)
    }
}
