import SwiftUI

// Browse All Books — recreates /browse (browse-client.tsx): sort pills,
// genre filter, paginated catalog grid (58k+ books). Plus the
// followers/following lists from /u/[username]/followers|following.

struct FollowListRoute: Hashable { let username: String; let type: String }

// ── Follow lists ──

struct FollowListView: View {
    @Environment(\.dismiss) private var dismiss
    let username: String
    let type: String   // followers | following
    @State private var users: [PersonRowLite] = []
    @State private var loaded = false

    struct PersonRowLite: Codable, Hashable, Identifiable {
        var id: String { userId }
        let userId: String
        let displayName: String?
        let username: String?
        let avatarUrl: String?
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.35), in: Circle())
                            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                    }
                    Text(type == "following" ? "Following" : "Followers")
                        .font(Theme.heading(24, .bold))
                        .foregroundStyle(Theme.foreground)
                }
                .padding(.top, 14)

                if users.isEmpty && loaded {
                    Text(type == "following" ? "Not following anyone yet." : "No followers yet.")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }

                ForEach(users) { person in
                    NavigationLink(value: UserRoute(username: person.username ?? "")) {
                        HStack(spacing: 12) {
                            Group {
                                if let avatarUrl = person.avatarUrl, let url = URL(string: avatarUrl) {
                                    AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                                        placeholder: { Theme.surfaceAlt }
                                } else {
                                    ZStack {
                                        Theme.neonPurple.opacity(0.3)
                                        Text(String((person.displayName ?? person.username ?? "?").prefix(1)).uppercased())
                                            .font(Theme.body(15, .bold))
                                            .foregroundStyle(Theme.foreground)
                                    }
                                }
                            }
                            .frame(width: 42, height: 42)
                            .clipShape(Circle())
                            VStack(alignment: .leading, spacing: 1) {
                                Text(person.displayName ?? person.username ?? "Reader")
                                    .font(Theme.body(15, .semibold))
                                    .foregroundStyle(Theme.foreground)
                                if let username = person.username {
                                    Text("@\(username)")
                                        .font(Theme.body(13))
                                        .foregroundStyle(Theme.muted)
                                }
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.muted)
                        }
                        .padding(12)
                        .background(Theme.surface.opacity(0.55))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
                    }
                    .buttonStyle(TapScaleButtonStyle())
                    .disabled(person.username == nil)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            struct Res: Codable { let ok: Bool; let users: [PersonRowLite] }
            if let res: Res = try? await APIClient.shared.get(
                "/api/v1/users/\(username)/follows",
                query: [URLQueryItem(name: "type", value: type)]) {
                users = res.users
                loaded = true
            }
        }
    }
}

// ── Browse ──

@MainActor
@Observable
final class BrowseModel {
    var books: [BrowseBook] = []
    var total = 0
    var hasMore = false
    var sort = "popular"
    var genre = ""
    var loading = false

    struct BrowseBook: Codable, Hashable, Identifiable {
        let id: String
        let slug: String?
        let title: String
        let coverImageUrl: String?
        let authors: [String]
        let aggregateRating: Double?
        let ratingCount: Int?
    }

    struct Res: Codable { let ok: Bool; let books: [BrowseBook]; let total: Int; let hasMore: Bool }
    struct Body: Codable, Sendable { let sort: String; let genre: String?; let offset: Int; let limit: Int }

    func load(reset: Bool) async {
        loading = true; defer { loading = false }
        let offset = reset ? 0 : books.count
        let body = Body(sort: sort, genre: genre.isEmpty ? nil : genre, offset: offset, limit: 24)
        if let res: Res = try? await APIClient.shared.request("/api/v1/browse", method: "POST", json: body) {
            if reset { books = res.books } else { books.append(contentsOf: res.books) }
            total = res.total
            hasMore = res.hasMore
        }
    }
}

struct BrowseView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = BrowseModel()

    private let sorts: [(String, String)] = [
        ("popular", "Popular"), ("rating", "Top Rated"), ("recent", "Recently Added"), ("title", "A–Z"),
    ]
    private let columns = [
        GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.35), in: Circle())
                            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Browse All Books")
                            .font(Theme.heading(24, .bold))
                            .foregroundStyle(Theme.foreground)
                        if model.total > 0 {
                            Text("\(model.total.formatted()) books")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                }
                .padding(.top, 14)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(sorts, id: \.0) { value, label in
                            let active = model.sort == value
                            Button {
                                model.sort = value
                                Task { await model.load(reset: true) }
                            } label: {
                                Text(label)
                                    .font(Theme.body(14, .medium))
                                    .foregroundStyle(active ? .black : Theme.muted)
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .background(active ? Theme.accent : Theme.surfaceAlt.opacity(0.5), in: Capsule())
                            }
                        }
                    }
                }

                LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                    ForEach(model.books) { book in
                        NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                            VStack(alignment: .leading, spacing: 5) {
                                CoverThumb(url: book.coverImageUrl, width: 104, height: 156, radius: 8)
                                Text(book.title)
                                    .font(Theme.body(12, .medium))
                                    .foregroundStyle(Theme.foreground.opacity(0.9))
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                if let rating = book.aggregateRating {
                                    HStack(spacing: 3) {
                                        Image(systemName: "star.fill").font(.system(size: 9))
                                        Text(String(format: "%.1f", rating)).font(Theme.body(11, .medium))
                                    }
                                    .foregroundStyle(Theme.accent)
                                }
                            }
                        }
                        .buttonStyle(TapScaleButtonStyle())
                    }
                }

                if model.hasMore {
                    Button {
                        Task { await model.load(reset: false) }
                    } label: {
                        if model.loading { ProgressView().tint(Theme.accent) }
                        else {
                            Text("Load more")
                                .font(Theme.body(14, .medium))
                                .foregroundStyle(Theme.neonBlue)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .toolbar(.hidden, for: .navigationBar)
        .task { if model.books.isEmpty { await model.load(reset: true) } }
    }
}
