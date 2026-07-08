import SwiftUI

// Public profile — recreates /u/[username]: header (avatar, name, badge,
// member-since, follower counts, Follow button), private-profile gate,
// stat pills, Top-Shelf rail, public shelves, recent public reviews.

struct UserRoute: Hashable { let username: String }

// (Reviews decode as UserReviewRow — the shared getUserReviewsWithBooks
// wire shape in Models.swift. The old PublicProfileReview struct had field
// names the API never sent, so the whole payload failed to decode and the
// public profile rendered without reviews.)

@MainActor
@Observable
final class PublicProfileModel {
    let username: String
    var isPrivate = false
    var user: ProfileUser?
    var isOwner = false
    var isFollowing = false
    var stats: ProfileStats?
    var favorites: [FavoriteBookRow] = []
    var publicShelves: [ShelfSummary] = []
    var reviews: [UserReviewRow] = []
    var followerCount = 0
    var followingCount = 0
    var loaded = false

    init(username: String) { self.username = username }

    struct Res: Codable {
        let ok: Bool
        let `private`: Bool
        let user: ProfileUser?
        let isOwner: Bool?
        let isFollowing: Bool?
        let stats: ProfileStats?
        let favorites: [FavoriteBookRow]?
        let reviews: [UserReviewRow]?
        let followerCount: Int?
        let followingCount: Int?
        let publicShelves: [ShelfSummary]?
    }

    func load() async {
        defer { loaded = true }
        guard let res: Res = try? await APIClient.shared.get("/api/v1/users/\(username)") else { return }
        isPrivate = res.private
        user = res.user
        isOwner = res.isOwner ?? false
        isFollowing = res.isFollowing ?? false
        stats = res.stats
        favorites = res.favorites ?? []
        publicShelves = res.publicShelves ?? []
        reviews = res.reviews ?? []
        followerCount = res.followerCount ?? 0
        followingCount = res.followingCount ?? 0
    }

    func toggleFollow() async {
        let target = !isFollowing
        isFollowing = target
        followerCount += target ? 1 : -1
        struct Body: Codable, Sendable { let follow: Bool }
        struct Ok: Codable { let ok: Bool }
        do {
            let _: Ok = try await APIClient.shared.request("/api/v1/users/\(username)", method: "POST", json: Body(follow: target))
        } catch {
            isFollowing = !target
            followerCount += target ? -1 : 1
        }
    }
}

struct PublicProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: PublicProfileModel

    init(username: String) {
        _model = State(initialValue: PublicProfileModel(username: username))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Spacer()
                }
                .padding(.top, 14)

                if model.isPrivate {
                    privateGate
                } else if let user = model.user {
                    header(user)
                    if let stats = model.stats { statPills(stats) }
                    if !model.favorites.isEmpty { topShelf }
                    if !model.publicShelves.isEmpty { shelvesSection }
                    if !model.reviews.isEmpty { reviewsSection }
                } else if model.loaded {
                    Text("Couldn't load this profile.")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else {
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
    }

    private var privateGate: some View {
        VStack(spacing: 10) {
            Image(systemName: "lock")
                .font(.system(size: 26))
                .foregroundStyle(Theme.muted)
                .frame(width: 64, height: 64)
                .background(Theme.surface, in: Circle())
                .overlay(Circle().stroke(Theme.border, lineWidth: 1))
            Text("This profile is private")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)
            Text("@\(model.username) has chosen to keep their reading life private.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private func header(_ user: ProfileUser) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Group {
                if let avatarUrl = user.avatarUrl, let url = URL(string: avatarUrl) {
                    AsyncImage(url: url) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: { Theme.accent }
                } else {
                    ZStack {
                        Theme.accent
                        Text(String((user.displayName ?? "?").prefix(1)).uppercased())
                            .font(Theme.heading(28, .bold))
                            .foregroundStyle(.black)
                    }
                }
            }
            .frame(width: 74, height: 74)
            .clipShape(Circle())
            .shadow(color: Theme.accent.opacity(0.3), radius: 10)

            VStack(alignment: .leading, spacing: 4) {
                Text(user.displayName ?? user.username ?? "Reader")
                    .font(Theme.heading(21, .bold))
                    .foregroundStyle(Theme.foreground)
                if let username = user.username {
                    Text("@\(username)")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                }
                HStack(spacing: 6) {
                    NavigationLink(value: FollowListRoute(username: model.username, type: "followers")) {
                        (Text("\(model.followerCount) ").fontWeight(.bold) + Text("followers"))
                    }
                    Text("·")
                    NavigationLink(value: FollowListRoute(username: model.username, type: "following")) {
                        (Text("\(model.followingCount) ").fontWeight(.bold) + Text("following"))
                    }
                }
                .font(Theme.body(13))
                .foregroundStyle(Theme.foreground.opacity(0.85))

                if !model.isOwner {
                    Button {
                        Task { await model.toggleFollow() }
                    } label: {
                        Text(model.isFollowing ? "Following" : "Follow")
                            .font(Theme.body(14, .semibold))
                            .foregroundStyle(model.isFollowing ? Theme.accentText : .black)
                            .padding(.horizontal, 18).padding(.vertical, 8)
                            .background(model.isFollowing ? Theme.accent.opacity(0.15) : Theme.accent, in: Capsule())
                            .overlay(Capsule().stroke(Theme.accent.opacity(model.isFollowing ? 0.5 : 1), lineWidth: 1))
                    }
                    .padding(.top, 4)
                }
            }
        }
    }

    private func statPills(_ stats: ProfileStats) -> some View {
        HStack(spacing: 12) {
            pill("\(stats.completed)", "Read", Theme.neonPurple)
            pill("\(stats.currentlyReading)", "Reading", Theme.neonBlue)
            pill("\(stats.tbr)", "TBR", Theme.accent)
        }
    }

    private func pill(_ value: String, _ label: String, _ tint: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(Theme.heading(24, .bold)).foregroundStyle(Theme.foreground)
            Text(label).font(Theme.body(13)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(tint.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(0.35), lineWidth: 1))
    }

    private var topShelf: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Top-Shelf Reads")
            // Same shelf furniture as the private profile (TopShelfCase).
            TopShelfCase(favorites: model.favorites, avatarUrl: model.user?.avatarUrl)
        }
    }

    private var shelvesSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading("Shelves")
            ForEach(model.publicShelves) { shelf in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Circle().fill(shelf.tint).frame(width: 10, height: 10)
                        Text(shelf.name)
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(Theme.foreground)
                        Text("\(shelf.bookCount)")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                        Spacer()
                    }
                    ShelfRailCase(coverUrls: shelf.coverUrls, coverSlugs: shelf.coverSlugs, tint: shelf.tint)
                }
            }
        }
    }

    private var reviewsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Recent Reviews")
            ForEach(model.reviews) { review in
                NavigationLink(value: BookRoute(idOrSlug: review.bookSlug ?? review.bookId)) {
                    HStack(alignment: .top, spacing: 12) {
                        CoverThumb(url: review.coverImageUrl, width: 44, height: 66, radius: 5)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(review.title)
                                .font(Theme.body(15, .semibold))
                                .foregroundStyle(Theme.foreground)
                                .multilineTextAlignment(.leading)
                            if let rating = review.rating {
                                StarRow(rating: rating)
                            }
                            if let text = review.reviewText, !text.isEmpty {
                                Text(text)
                                    .font(Theme.body(13))
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(3)
                                    .multilineTextAlignment(.leading)
                            }
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(Theme.surface.opacity(0.55))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                }
            }
        }
    }
}
