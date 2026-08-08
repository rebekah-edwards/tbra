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
            if let book {
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
                                    .font(Theme.body(10, .medium))
                                    .tracking(1.0)
                                    .foregroundStyle(Color(dark: "a3e635", light: "0ea5e9"))
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
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                    }
                    .disabled(shuffling)
                }
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            } else {
                // Empty state: "No owned TBR books yet. Find books to add"
                HStack(spacing: 4) {
                    Text("No owned TBR books yet.")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                    Button { openSearch() } label: {
                        Text("Find books to add")
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(Theme.accent)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            }
        }
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
struct FriendsActivityRow: View {
    let activity: [ActivityItem]
    /// Card tap → book page (reviews → the review itself); wired by HomeView.
    var onOpen: (ActivityItem) -> Void = { _ in }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(Array(activity.enumerated()), id: \.offset) { _, item in
                    FriendsActivityCard(item: item, onOpen: { onOpen(item) })
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

private struct FriendsActivityCard: View {
    let item: ActivityItem
    var onOpen: () -> Void = {}

    /// (label, pill tint, label colour). The lime pills need `Theme.accentText`
    /// on the label — lime-on-lime-15% is unreadable in light mode, and the web
    /// gets the same treatment for free via the `text-accent` override.
    private var actionLabel: (String, Color, Color) {
        switch item.type {
        case "completed": return ("FINISHED", Theme.neonBlue, Theme.neonBlue)
        case "review": return ("REVIEWED", Theme.neonPurple, Theme.neonPurple)
        case "rating": return ("RATED", Theme.accent, Theme.accentText)
        case "currently_reading": return ("READING", Theme.accent, Theme.accentText)
        case "tbr": return ("TBR'D", Theme.neonBlue, Theme.neonBlue)
        default: return ("READING NOTE", .orange, .orange)
        }
    }

    private var userName: String {
        item.user.displayName ?? item.user.username ?? "Reader"
    }

    private var progressLabel: String? {
        if let pct = item.percentComplete, pct > 0 { return "\(Int(pct.rounded()))% complete" }
        if let page = item.pageNumber, page > 0 { return "On page \(page)" }
        return nil
    }

    /// Text over the banner scrim — white on dark, near-black on the light
    /// frosted treatment (web .book-header-text flips the same way).
    private let bannerText = Color(dark: "ffffff", light: "18181b")

    var body: some View {
        // Plain Button — NavigationLink(value:) dies in sibling-card runs on
        // iOS 27 (bug #3/#7 family); same cure as Reading Now / Up Next.
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 0) {
                banner
                cardBody
            }
            .frame(width: 200, alignment: .leading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // Banner: blurred cover backdrop (CoverBlurImage — frame-bounded per the
    // iOS 27 rule, correct light-mode recipe) with the PERSON up top (avatar +
    // name + time) and the book image + title below — user request 2026-07-11.
    private var banner: some View {
        ZStack(alignment: .bottomLeading) {
            if let cover = item.book.coverImageUrl, let url = URL(string: cover) {
                CoverBlurImage(url: url).frame(height: 92)
                Theme.scrim.frame(height: 92).allowsHitTesting(false)
            } else {
                Theme.surfaceAlt.frame(height: 92)
            }

            HStack(alignment: .bottom, spacing: 8) {
                CoverThumb(url: item.book.coverImageUrl, width: 34, height: 50, radius: 4, title: item.book.title)
                    .shadow(color: .black.opacity(0.35), radius: 4, y: 2)
                Text(item.book.title)
                    .font(Theme.body(12, .bold))
                    .foregroundStyle(bannerText)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .padding(.bottom, 2)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
        }
        .frame(height: 92)
        .clipped()
        .overlay(alignment: .topLeading) {
            HStack(spacing: 6) {
                avatar
                Text(userName)
                    .font(Theme.body(11, .semibold))
                    .foregroundStyle(bannerText)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(timeAgo(item.timestamp))
                    .font(Theme.body(10))
                    .foregroundStyle(bannerText.opacity(0.7))
            }
            .padding(.horizontal, 8)
            .padding(.top, 7)
        }
    }

    private var avatar: some View {
        // Avatar (lime fallback initial, like the web)
        Group {
            if let avatarUrl = item.user.avatarUrl,
               let url = avatarUrl.hasPrefix("/")
                   ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
                   : URL(string: avatarUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.accent }
            } else {
                ZStack {
                    Theme.accent
                    Text(String(userName.prefix(1)).uppercased())
                        .font(Theme.body(9, .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .frame(width: 20, height: 20)
        .clipShape(Circle())
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            let (label, color, labelColor) = actionLabel
            HStack(spacing: 6) {
                Text(label)
                    .font(Theme.body(9, .semibold))
                    .tracking(0.5)
                    .foregroundStyle(labelColor)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(color.opacity(0.15), in: Capsule())
                    .overlay(Capsule().stroke(color.opacity(0.2), lineWidth: 1))
                if let rating = item.rating, rating > 0 {
                    StarRow(rating: rating)
                }
            }

            if item.type == "reading_note" {
                // Progress only — the note body is private and never even
                // reaches the client (see activity-feed.ts).
                Text(progressLabel ?? "Logged a private note")
                    .font(Theme.body(10))
                    .foregroundStyle(Theme.muted)
            }
            if let preview = item.reviewPreview, !preview.isEmpty, item.type != "reading_note" {
                Text(preview)
                    .font(Theme.body(10))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
    }

    private func timeAgo(_ timestamp: String) -> String {
        let fmt = ISO8601DateFormatter()
        let then = fmt.date(from: timestamp)
            ?? ISO8601DateFormatter.withFractional.date(from: timestamp)
            ?? dateOnly(timestamp)
        guard let then else { return "" }
        let diff = Date().timeIntervalSince(then)
        let minutes = Int(diff / 60), hours = Int(diff / 3600), days = Int(diff / 86400)
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        if hours < 24 { return "\(hours)h" }
        if days < 30 { return "\(days)d" }
        let out = DateFormatter(); out.dateFormat = "MMM d"
        return out.string(from: then)
    }

    private func dateOnly(_ s: String) -> Date? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        return f.date(from: String(s.prefix(10)))
    }
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
