import SwiftUI

// Author page — recreates /author/[id]: back + name + Follow button,
// follower count, bio, then books grouped by series (series header rows
// linking to the series page) with standalones last.

struct AuthorRoute: Hashable { let idOrSlug: String }

struct AuthorBookRow: Codable, Hashable, Identifiable {
    struct SeriesRef: Codable, Hashable {
        let id: String
        let name: String
        let slug: String?
    }
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let publicationYear: Int?
    let isBoxSet: Bool?
    let isFiction: Bool?
    let seriesInfo: SeriesRef?
}

@MainActor
@Observable
final class AuthorModel {
    let idOrSlug: String
    var name = ""
    var bio: String?
    var followerCount = 0
    var isFollowing = false
    var authorId = ""
    var books: [AuthorBookRow] = []
    var error: String?
    var loading = false

    init(idOrSlug: String) { self.idOrSlug = idOrSlug }

    struct Res: Codable {
        struct A: Codable { let id: String; let name: String; let slug: String?; let bio: String? }
        let ok: Bool
        let author: A
        let isFollowing: Bool
        let followerCount: Int
        let books: [AuthorBookRow]
    }

    func load() async {
        loading = true; defer { loading = false }
        do {
            let res: Res = try await APIClient.shared.get("/api/v1/authors/\(idOrSlug)")
            name = res.author.name
            bio = res.author.bio
            authorId = res.author.id
            isFollowing = res.isFollowing
            followerCount = res.followerCount
            books = res.books
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load this author."
        }
    }

    func toggleFollow() async {
        let target = !isFollowing
        isFollowing = target
        followerCount += target ? 1 : -1
        struct Ok: Codable { let ok: Bool; let following: Bool }
        do {
            let _: Ok = try await APIClient.shared.post("/api/v1/authors/\(authorId)", body: ["follow": target])
        } catch {
            // revert on failure
            isFollowing = !target
            followerCount += target ? -1 : 1
        }
    }
}

struct AuthorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: AuthorModel

    init(idOrSlug: String) {
        _model = State(initialValue: AuthorModel(idOrSlug: idOrSlug))
    }

    private var grouped: [(series: AuthorBookRow.SeriesRef?, books: [AuthorBookRow])] {
        var seriesOrder: [String] = []
        var bySeries: [String: (AuthorBookRow.SeriesRef, [AuthorBookRow])] = [:]
        var standalone: [AuthorBookRow] = []
        for book in model.books {
            if let s = book.seriesInfo {
                if bySeries[s.id] == nil { bySeries[s.id] = (s, []); seriesOrder.append(s.id) }
                bySeries[s.id]!.1.append(book)
            } else {
                standalone.append(book)
            }
        }
        var out: [(AuthorBookRow.SeriesRef?, [AuthorBookRow])] = seriesOrder.compactMap { id in
            bySeries[id].map { ($0.0, $0.1) }
        }
        if !standalone.isEmpty { out.append((nil, standalone)) }
        return out
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Text(model.name)
                        .font(Theme.heading(24, .bold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                    Spacer()
                    Button {
                        Task { await model.toggleFollow() }
                    } label: {
                        Text(model.isFollowing ? "Following" : "Follow")
                            .font(Theme.body(14, .semibold))
                            .foregroundStyle(model.isFollowing ? Theme.accentText : .black)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(model.isFollowing ? Theme.accent.opacity(0.15) : Theme.accent, in: Capsule())
                            .overlay(Capsule().stroke(Theme.accent.opacity(model.isFollowing ? 0.5 : 1), lineWidth: 1))
                    }
                }
                .padding(.top, 14)

                if model.followerCount > 0 {
                    Text("\(model.followerCount) follower\(model.followerCount == 1 ? "" : "s")")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                }

                if let bio = model.bio, !bio.isEmpty {
                    Text(bio)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.foreground.opacity(0.85))
                        .lineSpacing(3)
                }

                ForEach(Array(grouped.enumerated()), id: \.offset) { _, group in
                    VStack(alignment: .leading, spacing: 12) {
                        if let series = group.series {
                            NavigationLink(value: SeriesRoute(slug: series.slug ?? series.id)) {
                                HStack(spacing: 4) {
                                    Text(series.name)
                                        .font(Theme.heading(18, .semibold))
                                        .foregroundStyle(Theme.foreground)
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(Theme.neonBlue)
                                }
                            }
                        } else {
                            Text("Standalone")
                                .font(Theme.heading(18, .semibold))
                                .foregroundStyle(Theme.foreground)
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(group.books) { book in
                                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                                        VStack(alignment: .leading, spacing: 5) {
                                            CoverThumb(url: book.coverImageUrl, width: 100, height: 150, radius: 8)
                                            Text(book.title)
                                                .font(Theme.body(12, .medium))
                                                .foregroundStyle(Theme.foreground.opacity(0.9))
                                                .lineLimit(2)
                                                .multilineTextAlignment(.leading)
                                                .frame(width: 100, alignment: .leading)
                                            if let year = book.publicationYear {
                                                Text(String(year))
                                                    .font(Theme.body(11))
                                                    .foregroundStyle(Theme.muted)
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.trailing, 32)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}
