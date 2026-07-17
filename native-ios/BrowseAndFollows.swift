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
                    Color.clear.frame(width: 40, height: 40)
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
                    .disabled(person.username == nil)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
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
    var fiction = ""
    var length = ""
    var audience = ""
    var owned = ""
    var social = ""
    var query = ""
    var loading = false

    var activeFilterCount: Int {
        [genre, fiction, length, audience, owned, social].filter { !$0.isEmpty }.count
    }

    func clearFilters() {
        genre = ""; fiction = ""; length = ""; audience = ""; owned = ""; social = ""
    }

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
    struct Body: Codable, Sendable {
        let sort: String; let genre: String?; let fiction: String?
        let length: String?; let audience: String?; let owned: String?
        let social: String?; let query: String?
        let offset: Int; let limit: Int
    }

    func load(reset: Bool) async {
        loading = true; defer { loading = false }
        let offset = reset ? 0 : books.count
        func opt(_ v: String) -> String? { v.isEmpty ? nil : v }
        let body = Body(sort: sort, genre: opt(genre), fiction: opt(fiction),
                        length: opt(length), audience: opt(audience), owned: opt(owned),
                        social: opt(social), query: opt(query.trimmingCharacters(in: .whitespaces)),
                        offset: offset, limit: 24)
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

    // Web browse-client SORT_OPTIONS
    private let sorts: [(String, String)] = [
        ("popular", "Most Popular"), ("highest_rated", "Highest Rated"),
        ("newest", "Newest"), ("recently_added", "Recently Added"),
        ("title", "Title A-Z"), ("pages", "Shortest First"),
    ]
    private let genres = ["Fantasy", "Sci-Fi", "Romance", "Thriller", "Mystery", "Horror",
        "Historical Fiction", "Literary Fiction", "Contemporary Romance", "Dark Fantasy",
        "Epic Fantasy", "Romantasy", "Grimdark", "LitRPG", "Dystopian", "Adventure",
        "Crime", "Biography", "Self-Help", "Humor", "Coming of Age", "Anthology"]
    @State private var filtersOpen = false
    private let columns = [
        GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
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

                // Search + Sort + Filters toggle (web browse-client mobile row)
                TextField("Search title or author…", text: Bindable(model).query)
                    .font(Theme.body(14))
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { Task { await model.load(reset: true) } }
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Theme.surfaceAlt.opacity(0.8))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))

                HStack(spacing: 8) {
                    Menu {
                        ForEach(sorts, id: \.0) { value, label in
                            Button(label) {
                                model.sort = value
                                Task { await model.load(reset: true) }
                            }
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Text(sorts.first { $0.0 == model.sort }?.1 ?? "Sort")
                                .font(Theme.body(13, .medium))
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                        }
                        .foregroundStyle(Theme.foreground)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Theme.surfaceAlt.opacity(0.8), in: Capsule())
                        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                    }

                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { filtersOpen.toggle() }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "line.3.horizontal.decrease")
                                .font(.system(size: 11, weight: .semibold))
                            Text(model.activeFilterCount > 0 ? "Filters (\(model.activeFilterCount))" : "Filters")
                                .font(Theme.body(13, .medium))
                        }
                        .foregroundStyle(model.activeFilterCount > 0 ? Theme.accentText : Theme.foreground)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(model.activeFilterCount > 0 ? Theme.accent.opacity(0.12) : Theme.surfaceAlt.opacity(0.8), in: Capsule())
                        .overlay(Capsule().stroke(model.activeFilterCount > 0 ? Theme.accent.opacity(0.4) : Theme.border, lineWidth: 1))
                    }

                    if model.activeFilterCount > 0 {
                        Button("Clear all") {
                            model.clearFilters()
                            Task { await model.load(reset: true) }
                        }
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.neonBlue)
                    }
                    Spacer()
                }

                if filtersOpen { filterPanel }

                LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                    ForEach(model.books) { book in
                        // Web card: COVER ONLY, rating badge bottom-right
                        // (black/60, white text) — no title/author, no green.
                        NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                            CoverThumb(url: book.coverImageUrl, width: 104, height: 156, radius: 8, title: book.title)
                                .overlay(alignment: .bottomTrailing) {
                                    if let rating = book.aggregateRating, rating > 0 {
                                        Text("\(String(format: "%.1f", rating)) ★")
                                            .font(Theme.body(10, .medium))
                                            .foregroundStyle(.white.opacity(0.8))
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(.black.opacity(0.6), in: Capsule())
                                            .padding(6)
                                    }
                                }
                        }
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
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .task { if model.books.isEmpty { await model.load(reset: true) } }
    }

    // Collapsible filter panel — web browse-client.tsx rows.
    private var filterPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            filterMenu("GENRE", value: Bindable(model).genre,
                       options: [("", "All Genres")] + genres.map { ($0, $0) })
            filterPills("TYPE", value: Bindable(model).fiction,
                        options: [("", "All"), ("fiction", "Fiction"), ("nonfiction", "Non-Fiction")])
            filterMenu("LENGTH", value: Bindable(model).length,
                       options: [("", "Any Length"), ("short", "Under 250p"), ("medium", "250-400p"), ("long", "400+ pages")])
            filterMenu("AUDIENCE", value: Bindable(model).audience,
                       options: [("", "All Ages"), ("adult", "Adult"), ("ya", "Young Adult"), ("mg", "Middle Grade")])
            filterPills("OWNED", value: Bindable(model).owned,
                        options: [("", "All"), ("owned", "Owned"), ("unowned", "Unowned")])
            filterPills("SOCIAL", value: Bindable(model).social,
                        options: [("", "All"), ("friends_read", "Friends Read"), ("friends_tbr", "Friends' TBR")])
        }
        .padding(12)
        .background(Theme.surfaceAlt.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
    }

    private func filterMenu(_ label: String, value: Binding<String>, options: [(String, String)]) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .font(Theme.body(10, .semibold)).tracking(1)
                .foregroundStyle(Theme.muted)
                .frame(width: 70, alignment: .leading)
            Menu {
                ForEach(options, id: \.0) { v, l in
                    Button(l) {
                        value.wrappedValue = v
                        Task { await model.load(reset: true) }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Text(options.first { $0.0 == value.wrappedValue }?.1 ?? options[0].1)
                        .font(Theme.body(13, .medium))
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(value.wrappedValue.isEmpty ? Theme.foreground : Theme.accentText)
                .padding(.horizontal, 11).padding(.vertical, 7)
                .background(value.wrappedValue.isEmpty ? Theme.surface.opacity(0.8) : Theme.accent.opacity(0.15), in: Capsule())
                .overlay(Capsule().stroke(value.wrappedValue.isEmpty ? Theme.border : Theme.accent.opacity(0.4), lineWidth: 1))
            }
            Spacer()
        }
    }

    private func filterPills(_ label: String, value: Binding<String>, options: [(String, String)]) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .font(Theme.body(10, .semibold)).tracking(1)
                .foregroundStyle(Theme.muted)
                .frame(width: 70, alignment: .leading)
            HStack(spacing: 6) {
                ForEach(options, id: \.0) { v, l in
                    let active = value.wrappedValue == v
                    Button(l) {
                        value.wrappedValue = v
                        Task { await model.load(reset: true) }
                    }
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(active ? Theme.accentText : Theme.muted)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(active ? Theme.accent.opacity(0.2) : Theme.surface.opacity(0.8), in: Capsule())
                    .overlay(Capsule().stroke(active ? Theme.accent.opacity(0.4) : Theme.border, lineWidth: 1))
                }
            }
            Spacer()
        }
    }
}
