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
    /// The verified author's account, if this page has one (badge).
    var verifiedAccount: VerifiedAccount?
    /// The viewer's own claim on this page: pending / approved / rejected / revoked.
    var viewerClaimStatus: String?

    struct VerifiedAccount: Codable, Hashable { let username: String?; let displayName: String? }

    init(idOrSlug: String) { self.idOrSlug = idOrSlug }

    struct Res: Codable {
        struct A: Codable { let id: String; let name: String; let slug: String?; let bio: String? }
        let ok: Bool
        let author: A
        let isFollowing: Bool
        let followerCount: Int
        let books: [AuthorBookRow]
        let verifiedAccount: VerifiedAccount?
        let viewerClaimStatus: String?
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
            verifiedAccount = res.verifiedAccount
            viewerClaimStatus = res.viewerClaimStatus
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load this author."
        }
    }

    /// Ask to be this page's verified author (staff review it). Returns an error message or nil.
    func submitClaim(links: String, email: String, message: String) async -> String? {
        do {
            struct Ok: Codable { let ok: Bool }
            let _: Ok = try await APIClient.shared.request(
                "/api/v1/authors/\(idOrSlug)", method: "POST",
                body: ["claim": ["evidenceLinks": links, "contactEmail": email, "message": message]])
            viewerClaimStatus = "pending"
            return nil
        } catch {
            return (error as? APIError)?.errorDescription ?? "Couldn't send your claim."
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
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.shellRailWidth) private var rail
    @Environment(\.dismiss) private var dismiss
    @State private var model: AuthorModel
    @State private var claimOpen = false

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

    private var heroCovers: [String] {
        Array(grouped.flatMap { $0.books }.compactMap { $0.coverImageUrl }.prefix(3))
    }

    private var heroStats: [HeroStat] {
        var out = [HeroStat(label: model.books.count == 1 ? "book" : "books", value: "\(model.books.count)", hue: .lime)]
        let seriesCount = grouped.filter { $0.series != nil }.count
        if seriesCount > 0 { out.append(HeroStat(label: "series", value: "\(seriesCount)", hue: .blue)) }
        if model.followerCount > 0 {
            out.append(HeroStat(label: model.followerCount == 1 ? "follower" : "followers", value: "\(model.followerCount)", hue: .purple))
        }
        return out
    }

    var body: some View {
        ScrollView {
            // iPhone Duo open: hero on the left, the book rows flow into
            // both columns (the right one level with the logo).
            DuoColumns(spacing: 16, rightLift: duoRightColumnLift(barTop: bars.top, rail: rail)) {
                // Design refresh (2026-11-25): cover-art hero like the
                // profile / buddy-read pages, Follow as the one lime pill.
                CoverArtHero(
                    eyebrow: "Author",
                    title: model.name,
                    covers: heroCovers,
                    stats: heroStats
                ) {
                    VStack(spacing: 10) {
                        if let account = model.verifiedAccount {
                            if let username = account.username {
                                NavigationLink(value: UserRoute(username: username)) {
                                    VerifiedAuthorBadge(label: "Verified author · @\(username)")
                                }
                                .buttonStyle(.plain)
                            } else {
                                VerifiedAuthorBadge()
                            }
                        }
                        FollowPill(isFollowing: model.isFollowing) {
                            Task { await model.toggleFollow() }
                        }
                        if model.verifiedAccount == nil {
                            if model.viewerClaimStatus == "pending" {
                                HStack(spacing: 6) {
                                    Circle().fill(Theme.neonBlue).frame(width: 6, height: 6)
                                    Text("Claim waiting for review")
                                        .font(Theme.body(12))
                                        .foregroundStyle(Theme.muted)
                                }
                            } else if !model.name.isEmpty {
                                Button { claimOpen = true } label: {
                                    Label("Are you \(model.name)? Claim this page", systemImage: "person.crop.circle.badge.checkmark")
                                        .font(Theme.body(12, .semibold))
                                        .foregroundStyle(Theme.foreground)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.85)
                                        .padding(.horizontal, 12).padding(.vertical, 7)
                                        .background(.ultraThinMaterial, in: Capsule())
                                        .overlay(Capsule().stroke(Theme.foreground.opacity(0.14), lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                } footer: {
                    if let bio = model.bio, !bio.isEmpty {
                        Text(bio)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.foreground.opacity(0.85))
                            .lineSpacing(3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 2)
                    }
                }
                // 52 clears the top-left back chevron; on the Duo the back
                // button lives in the side column.
                .padding(.top, rail > 0 ? 14 : 52)
                .duoColumn(.left)

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
                            Text(grouped.count > 1 ? "Standalone" : "Books")
                                .font(Theme.heading(18, .semibold))
                                .foregroundStyle(Theme.foreground)
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(group.books) { book in
                                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                                        VStack(alignment: .leading, spacing: 5) {
                                            CoverThumb(url: book.coverImageUrl, width: 100, height: 150, radius: 8, title: book.title)
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
        .reportsPage("/author/\(model.idOrSlug)")
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(isPresented: $claimOpen) {
            AuthorClaimSheet(authorName: model.name) { links, email, message in
                await model.submitClaim(links: links, email: email, message: message)
            }
            .presentationDetents([.large])
            .presentationBackground(Theme.bg)
        }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}


// "Claim this author page" (web components/author/claim-author-button.tsx).
// A person on the team reviews every claim in /admin/authors.
private struct AuthorClaimSheet: View {
    @Environment(\.dismiss) private var dismiss
    let authorName: String
    let submit: (String, String, String) async -> String?
    @State private var links = ""
    @State private var email = ""
    @State private var message = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("AUTHOR VERIFICATION")
                        .font(Theme.body(11, .semibold)).tracking(1.1)
                        .foregroundStyle(Theme.muted)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                    }
                }
                .padding(.top, 18)
                Text("Claim \(authorName)'s page")
                    .font(Theme.heading(20, .bold))
                    .foregroundStyle(Theme.foreground)
                Text("Once someone on our team confirms it's you, your profile gets a Verified Author badge and you can update your books' descriptions and confirm their content ratings.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                field("Your website or social profiles", text: $links, axis: .vertical, prompt: "https://… we check these link back to you")
                field("Contact email (ideally the one on your website)", text: $email, axis: .horizontal, prompt: "you@example.com")
                field("Anything else we should know (optional)", text: $message, axis: .vertical, prompt: "")
                if let error {
                    Text(error).font(Theme.body(12)).foregroundStyle(Theme.destructive)
                }
                Button {
                    sending = true
                    Task {
                        error = await submit(links, email, message)
                        sending = false
                        if error == nil { dismiss() }
                    }
                } label: {
                    Text(sending ? "Sending…" : "Send for review")
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(sending)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Theme.bg)
    }

    private func field(_ label: String, text: Binding<String>, axis: Axis, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(Theme.body(12, .semibold))
                .foregroundStyle(Theme.foreground)
            TextField(prompt, text: text, axis: axis)
                .lineLimit(axis == .vertical ? 2...4 : 1...1)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(axis == .horizontal)
                .font(Theme.body(14))
                .padding(12)
                .background(Theme.surfaceAlt.opacity(0.5), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
        }
    }
}
