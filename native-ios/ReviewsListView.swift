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
                        Text(bookTitle)
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
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
                Text(text)
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.foreground.opacity(0.9))
                    .lineSpacing(2)
            }

            // Descriptor tag chips (flattened, like review-card)
            let allTags = review.dimensionTags.values.flatMap { $0 }.filter { !$0.hasPrefix("pacing:") && !$0.hasPrefix("custom:") }
            if !allTags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(allTags.prefix(10), id: \.self) { tag in
                        Text(tag)
                            .font(Theme.body(11, .medium))
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .background(Theme.surfaceAlt.opacity(0.6), in: Capsule())
                    }
                }
            }

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
                .foregroundStyle(review.currentUserVoted ? Theme.accent : Theme.muted)
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
}
