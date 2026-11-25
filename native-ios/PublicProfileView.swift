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
    /// The viewer blocked this reader: show the blocked screen with Unblock.
    /// (A reader who blocked the VIEWER just looks private — never announced.)
    var blockedByViewer = false
    var user: ProfileUser?
    var isOwner = false
    var isFollowing = false
    var stats: ProfileStats?
    var favorites: [FavoriteBookRow] = []
    var publicShelves: [ShelfSummary] = []
    var reviews: [UserReviewRow] = []
    /// Notes they marked shared — the server sends them to followers only.
    var sharedNotes: [SharedNote] = []
    /// Author pages this reader is the verified author of (badge).
    var verifiedAuthors: [VerifiedAuthorRef] = []
    var followerCount = 0
    var followingCount = 0
    var loaded = false

    init(username: String) { self.username = username }

    struct Res: Codable {
        let ok: Bool
        let `private`: Bool
        let blockedByViewer: Bool?
        let user: ProfileUser?
        let isOwner: Bool?
        let isFollowing: Bool?
        let stats: ProfileStats?
        let favorites: [FavoriteBookRow]?
        let reviews: [UserReviewRow]?
        let followerCount: Int?
        let followingCount: Int?
        let publicShelves: [ShelfSummary]?
        let sharedNotes: [SharedNote]?
        let verifiedAuthors: [VerifiedAuthorRef]?
    }

    func load() async {
        defer { loaded = true }
        guard let res: Res = try? await APIClient.shared.get("/api/v1/users/\(username)") else { return }
        isPrivate = res.private
        blockedByViewer = res.blockedByViewer ?? false
        user = res.user
        isOwner = res.isOwner ?? false
        isFollowing = res.isFollowing ?? false
        stats = res.stats
        favorites = res.favorites ?? []
        publicShelves = res.publicShelves ?? []
        reviews = res.reviews ?? []
        sharedNotes = res.sharedNotes ?? []
        verifiedAuthors = res.verifiedAuthors ?? []
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
    @Environment(\.shellRailWidth) private var rail
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.dismiss) private var dismiss
    @State private var model: PublicProfileModel
    @State private var reviewSearch = ""
    @State private var reviewFilter = "all"   // all | dnf | written
    @State private var showAllReviews = false
    @State private var shelvesExpanded = false
    @State private var allShelvesOpen = false

    init(username: String) {
        _model = State(initialValue: PublicProfileModel(username: username))
    }

    private var heroShown: Bool {
        DesignPreview.on && model.user != nil && !model.isPrivate && !model.blockedByViewer
    }

    var body: some View {
        ScrollView {
            // iPhone Duo open: the reader on the left, their books on the
            // right (starting level with the logo).
            DuoColumns(spacing: 22, rightLift: duoRightColumnLift(barTop: bars.top, rail: rail)) {
                if model.blockedByViewer {
                    blockedGate.duoColumn(.full)
                } else if model.isPrivate {
                    privateGate.duoColumn(.full)
                } else if let user = model.user, DesignPreview.on {
                    // Refreshed (2026-11): one hero card on the wordmark
                    // hairline holds who they are, the follow action and the
                    // three counts; sections below are neutral glass.
                    heroV2(user).duoColumn(.left)
                    if !model.favorites.isEmpty { topShelf.duoColumn(.right) }
                    if !model.publicShelves.isEmpty { shelvesSection.duoColumn(.right) }
                    if !model.sharedNotes.isEmpty { notesSection }
                    if !model.reviews.isEmpty { reviewsSection }
                } else if let user = model.user {
                    header(user)
                    socialRow(user)
                    if let stats = model.stats { statPills(stats) }
                    if !model.favorites.isEmpty { topShelf }
                    if !model.publicShelves.isEmpty { shelvesSection }
                    if !model.sharedNotes.isEmpty { notesSection }
                    if !model.reviews.isEmpty { reviewsSection }
                } else if model.loaded {
                    Text("Couldn't load this profile.")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                        .duoColumn(.full)
                } else {
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                        .duoColumn(.full)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .tracksScrollAtTop()
        // The refreshed hero carries its own back + share inside the card
        // (Rebekah 2026-11-19); the floating button stays for the loading,
        // private and blocked states, which have no card.
        .modifier(FloatingBackUnlessHero(heroShown: heroShown))
        .reportsPage("/u/\(model.username)")
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
    }

    @State private var unblocking = false

    private var blockedGate: some View {
        VStack(spacing: 10) {
            Image(systemName: "nosign")
                .font(.system(size: 26))
                .foregroundStyle(Theme.muted)
                .frame(width: 64, height: 64)
                .gateIconChrome()
            Text("You blocked @\(model.username)")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)
            Text("You won't see each other's reviews or profiles.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            Button {
                Task {
                    unblocking = true; defer { unblocking = false }
                    if (try? await SafetyAPI.unblock(model.username)) != nil { await model.load() }
                }
            } label: {
                if DesignPreview.on {
                    ShelfPill(kind: .neutral) { Text(unblocking ? "Unblocking…" : "Unblock") }
                } else {
                    Text(unblocking ? "Unblocking…" : "Unblock")
                        .font(Theme.body(14, .semibold))
                        .foregroundStyle(Theme.foreground)
                        .padding(.horizontal, 22).padding(.vertical, 9)
                        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                }
            }
            .disabled(unblocking)
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private var privateGate: some View {
        VStack(spacing: 10) {
            Image(systemName: "lock")
                .font(.system(size: 26))
                .foregroundStyle(Theme.muted)
                .frame(width: 64, height: 64)
                .gateIconChrome()
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
        // The 40pt clear slot keeps the avatar clear of the floating back
        // chevron (leading 20 / top 14 overlay), so the whole header sits on
        // the chevron's row instead of a line below it (user request
        // 2026-07-18).
        HStack(alignment: .top, spacing: 12) {
            Color.clear.frame(width: 40, height: 40)
            Group {
                if let avatarUrl = user.avatarUrl, let url = URL(string: avatarUrl) {
                    CachedCoverImage(url: url) { Theme.accent }
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
                    // Keep the name clear of the floating share circle; the
                    // lower rows can use the full column width.
                    .padding(.trailing, 44)
                accountBadge(user.accountType)
                if let username = user.username {
                    Text("@\(username)")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                }
                // Web shows the bio on public profiles; iOS dropped it, so a
                // shared profile read as blank next to its web counterpart.
                if let bio = user.bio?.trimmingCharacters(in: .whitespacesAndNewlines), !bio.isEmpty {
                    Text(bio)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.foreground.opacity(0.9))
                        // Leading, matching the rest of this column — a
                        // centred bio floated oddly against the left-aligned
                        // username and member-since rows.
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
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
                    HStack(spacing: 4) {
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
                    // Report / Block (App Review 1.2).
                    SafetyMenuButton(
                        target: SafetyTarget(kind: .profile, username: model.username),
                        onBlocked: { Task { await model.load() } })
                    }
                    .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // Share the web profile URL — a universal link, so recipients with
        // the app installed open it natively and everyone else lands on the
        // website. Overlaid (not in the HStack flow) so the follower-count
        // row keeps the full column width and doesn't wrap.
        .overlay(alignment: .topTrailing) {
            if let username = user.username,
               let url = URL(string: "https://thebasedreader.app/u/\(username)") {
                ShareLink(item: url) {
                    // chromeCircle to match the back chevron, same pairing
                    // as the book page.
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.foreground.opacity(0.9))
                        .chromeCircle()
                }
            }
        }
    }

    // ── Refreshed header (2026-11) ──
    // Designed, not just matched: the reader is a hero card on the wordmark
    // hairline — ringed avatar, name, glass tier badge, the follow action and
    // their three counts as eyebrow tiles — centred as one group. Follow is the
    // screen's one solid-lime pill; everything else is glass.

    /// The back chevron's row: the share circle sits opposite it.
    private func heroV2(_ user: ProfileUser) -> some View {
        let name = user.displayName ?? user.username ?? "Reader"
        // iPhone Duo (side rail showing): a compact header — the screen is
        // ~200pt shorter than an iPhone's, and the full card filled it
        // (Rebekah, 2026-11-25). Avatar beside the name; the stat cards keep
        // their cover fans (she wants that visual kept).
        let compact = rail > 0
        return VStack(spacing: compact ? 10 : 14) {
            if compact {
                HStack(alignment: .center, spacing: 20) {
                    ProfileHeroAvatar(avatarUrl: user.avatarUrl, name: name, size: 74)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(name)
                            .font(Theme.heading(19, .bold))
                            .foregroundStyle(Theme.foreground)
                            .multilineTextAlignment(.leading)
                        VStack(alignment: .leading, spacing: 6) {
                            if let username = user.username {
                                Text("@\(username)")
                                    .font(Theme.body(14))
                                    .foregroundStyle(Theme.muted)
                            }
                            ProfileTierBadge(type: user.accountType)
                        }
                        ForEach(model.verifiedAuthors, id: \.authorId) { a in
                            NavigationLink(value: AuthorRoute(idOrSlug: a.slug ?? a.authorId)) {
                                VerifiedAuthorBadge(label: model.verifiedAuthors.count > 1 ? "Verified author · \(a.name)" : "Verified author")
                            }
                            .buttonStyle(.plain)
                        }
                    HStack(spacing: 6) {
                        NavigationLink(value: FollowListRoute(username: model.username, type: "followers")) {
                            (Text("\(model.followerCount) ").fontWeight(.bold).foregroundColor(Theme.foreground)
                             + Text(model.followerCount == 1 ? "follower" : "followers").foregroundColor(Theme.muted))
                        }
                        Text("·").foregroundStyle(Theme.muted)
                        NavigationLink(value: FollowListRoute(username: model.username, type: "following")) {
                            (Text("\(model.followingCount) ").fontWeight(.bold).foregroundColor(Theme.foreground)
                             + Text("following").foregroundColor(Theme.muted))
                        }
                    }
                    .font(Theme.body(13))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ProfileHeroAvatar(avatarUrl: user.avatarUrl, name: name)

                VStack(spacing: 6) {
                    Text(name)
                        .font(Theme.heading(23, .bold))
                        .foregroundStyle(Theme.foreground)
                        .multilineTextAlignment(.center)
                    HStack(spacing: 8) {
                        if let username = user.username {
                            Text("@\(username)")
                                .font(Theme.body(14))
                                .foregroundStyle(Theme.muted)
                        }
                        ProfileTierBadge(type: user.accountType)
                    }
                    ForEach(model.verifiedAuthors, id: \.authorId) { a in
                        NavigationLink(value: AuthorRoute(idOrSlug: a.slug ?? a.authorId)) {
                            VerifiedAuthorBadge(label: model.verifiedAuthors.count > 1 ? "Verified author · \(a.name)" : "Verified author")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if let bio = user.bio?.trimmingCharacters(in: .whitespacesAndNewlines), !bio.isEmpty {
                Text(bio)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.foreground.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(compact ? 2 : nil)
            }

            if !compact {
                HStack(spacing: 6) {
                    NavigationLink(value: FollowListRoute(username: model.username, type: "followers")) {
                        (Text("\(model.followerCount) ").fontWeight(.bold).foregroundColor(Theme.foreground)
                         + Text(model.followerCount == 1 ? "follower" : "followers").foregroundColor(Theme.muted))
                    }
                    Text("·").foregroundStyle(Theme.muted)
                    NavigationLink(value: FollowListRoute(username: model.username, type: "following")) {
                        (Text("\(model.followingCount) ").fontWeight(.bold).foregroundColor(Theme.foreground)
                         + Text("following").foregroundColor(Theme.muted))
                    }
                }
                .font(Theme.body(13))
            }

            if !model.isOwner {
                HStack(spacing: 10) {
                    Button {
                        Task { await model.toggleFollow() }
                    } label: {
                        if model.isFollowing {
                            ShelfPill(kind: .active) {
                                Label("Following", systemImage: "checkmark")
                            }
                        } else {
                            ShelfPill(kind: .primary) {
                                Label("Follow", systemImage: "person.badge.plus")
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    // Report / Block (App Review 1.2), in a glass circle.
                    SafetyMenuButton(
                        target: SafetyTarget(kind: .profile, username: model.username),
                        onBlocked: { Task { await model.load() } })
                        .frame(width: 38, height: 38)
                        .background(
                            Circle().fill(Theme.surface.opacity(0.6))
                                .overlay(Circle().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
                        )
                }
            }

            socialRowV2(user)

            if let stats = model.stats {
                HStack(spacing: 10) {
                    ProfileStatCard(value: stats.completed, label: "Read", tint: Theme.neonPurple,
                                    covers: stats.covers?.completed ?? [])
                    ProfileStatCard(value: stats.currentlyReading, label: "Reading", tint: Theme.neonBlue,
                                    covers: stats.covers?.currentlyReading ?? [])
                    ProfileStatCard(value: stats.tbr, label: "TBR", tint: Theme.accent,
                                    covers: stats.covers?.tbr ?? [])
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 22)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity)
        .background(
            ZStack {
                Theme.surface.opacity(0.92)
                RadialGradient(colors: [Theme.neonPurple.opacity(0.16), .clear],
                               center: .topLeading, startRadius: 0, endRadius: 220)
                RadialGradient(colors: [Theme.accent.opacity(0.08), .clear],
                               center: .bottomTrailing, startRadius: 0, endRadius: 200)
            }
        )
        .heroHairline()
        .overlay(alignment: .top) {
            HStack {
                if rail == 0 {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 36, height: 36)
                            .glassEffect(.regular, in: Circle())
                    }
                    .accessibilityLabel("Back")
                }
                Spacer()
                if let username = user.username,
                   let url = URL(string: "https://thebasedreader.app/u/\(username)") {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 36, height: 36)
                            .glassEffect(.regular, in: Circle())
                    }
                    .accessibilityLabel("Share profile")
                }
            }
            .padding(12)
        }
    }

    /// The same links as `socialRow`, each in a 40pt glass circle.
    @ViewBuilder
    private func socialRowV2(_ user: ProfileUser) -> some View {
        let links = Self.socialLinks(user)
        if !links.isEmpty {
            HStack(spacing: 10) {
                ForEach(links) { link in
                    Link(destination: link.url) {
                        Image(link.id)
                            .renderingMode(link.template ? .template : .original)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 19, height: 19)
                            .foregroundStyle(Theme.foreground)
                            .frame(width: 40, height: 40)
                            .glassEffect(.regular, in: Circle())
                    }
                    .accessibilityLabel("@\(link.handle) on \(link.label)")
                }
            }
        }
    }

    // ── Social links — web <SocialIcons> parity (2026-07-28) ──
    // Same four platforms, same URL prefixes, same centered row the web /u
    // page shows on mobile. Handles are stored without "@" (a stray leading
    // one is trimmed so the link still resolves). The monochrome glyphs are
    // template images, so they tint with the theme instead of needing the
    // web's separate -black/-white asset pairs; Instagram keeps its gradient.
    private struct SocialLink: Identifiable {
        let id: String        // asset name
        let label: String
        let handle: String
        let url: URL
        let template: Bool
    }

    private static func socialLinks(_ user: ProfileUser) -> [SocialLink] {
        let specs: [(String, String, String, String?, Bool)] = [
            ("SocialInstagram", "Instagram", "https://instagram.com/", user.instagram, false),
            ("SocialTikTok", "TikTok", "https://tiktok.com/@", user.tiktok, true),
            ("SocialThreads", "Threads", "https://threads.net/@", user.threads, true),
            ("SocialX", "X", "https://x.com/", user.twitter, true),
        ]
        return specs.compactMap { asset, label, prefix, raw, template in
            var handle = (raw ?? "").trimmingCharacters(in: .whitespaces)
            if handle.hasPrefix("@") { handle.removeFirst() }
            guard !handle.isEmpty,
                  let encoded = handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
                  let url = URL(string: prefix + encoded)
            else { return nil }
            return SocialLink(id: asset, label: label, handle: handle, url: url, template: template)
        }
    }

    @ViewBuilder
    private func socialRow(_ user: ProfileUser) -> some View {
        let links = Self.socialLinks(user)
        if !links.isEmpty {
            HStack(spacing: 16) {
                ForEach(links) { link in
                    Link(destination: link.url) {
                        Image(link.id)
                            .renderingMode(link.template ? .template : .original)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 28, height: 28)
                            .foregroundStyle(Theme.foreground)
                    }
                    .accessibilityLabel("@\(link.handle) on \(link.label)")
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    /// Web AccountBadge parity: purple for admin/premium tiers, accent for
    /// reader/beta. Sits below the display name (user request 2026-07-18 —
    /// keeps the shifted-right header narrow).
    @ViewBuilder
    private func accountBadge(_ type: String?) -> some View {
        if let type, type != "user" {
            // Public rule (2026-07-22): beta testers read as Based Readers —
            // only admin surfaces show the real tier.
            let display = type == "beta_tester" ? "premium" : type
            let label: String = {
                switch display {
                case "super_admin": return "Super Admin"
                case "admin": return "Admin"
                case "premium": return "Based Reader"
                case "reader": return "Reader"
                default: return display.replacingOccurrences(of: "_", with: " ").capitalized
                }
            }()
            let isPurple = ["super_admin", "admin", "premium"].contains(display)
            Text(label)
                .font(Theme.body(11, .medium))
                .foregroundStyle(isPurple ? Theme.neonPurple : Theme.accentText)
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background((isPurple ? Theme.neonPurple : Theme.accent).opacity(0.12), in: Capsule())
                .overlay(Capsule().stroke((isPurple ? Theme.neonPurple : Theme.accent).opacity(0.5), lineWidth: 1))
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

    // Reading notes this reader marked shared (web: shared-notes.tsx). Each
    // opens its book.
    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Reading Notes")
            ForEach(model.sharedNotes) { note in
                NavigationLink(value: BookRoute(idOrSlug: note.bookSlug ?? note.bookId)) {
                    HStack(alignment: .top, spacing: 12) {
                        CoverThumb(url: note.bookCoverUrl, width: 40, height: 60, radius: 5, title: note.bookTitle)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(note.bookTitle)
                                .font(Theme.body(14, .semibold))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                            Text(sharedNoteMeta(note))
                                .font(Theme.body(11))
                                .foregroundStyle(Theme.muted)
                            Text("\u{201C}\(note.noteText)\u{201D}")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.foreground.opacity(0.8))
                                .lineSpacing(2)
                                .lineLimit(4)
                                .multilineTextAlignment(.leading)
                                .padding(.top, 3)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .profileRowChrome()
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// "42% read · Nov 16, 2026" (progress first when the entry has one).
    private func sharedNoteMeta(_ note: SharedNote) -> String {
        let when = DateFmt.display(note.createdAt, precision: nil)
        if let pct = note.percentComplete, pct > 0 { return "\(pct)% read · \(when)" }
        if let page = note.pageNumber, page > 0 { return "p. \(page) · \(when)" }
        return when
    }

    /// 3 → expand to 8 → a full screen beyond that (punch list #5.1). The rail
    /// used to run to the full shelf count, burying everything under it.
    private static let shelvesCollapsed = 3
    private static let shelvesExpanded = 8

    private var shelvesSection: some View {
        let all = model.publicShelves
        let visible = Array(all.prefix(shelvesExpanded ? Self.shelvesExpanded : Self.shelvesCollapsed))

        return VStack(alignment: .leading, spacing: 14) {
            SectionHeading("Shelves")
            ForEach(visible) { shelf in
                shelfRail(shelf)
            }

            if !shelvesExpanded && all.count > Self.shelvesCollapsed {
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { shelvesExpanded = true }
                } label: {
                    Text("View \(min(all.count, Self.shelvesExpanded) - Self.shelvesCollapsed) more \(min(all.count, Self.shelvesExpanded) - Self.shelvesCollapsed == 1 ? "shelf" : "shelves")")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.neonBlue)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            } else if shelvesExpanded {
                HStack(spacing: 18) {
                    Button {
                        withAnimation(.easeOut(duration: 0.18)) { shelvesExpanded = false }
                    } label: {
                        Text("Show fewer").font(Theme.body(13, .medium)).foregroundStyle(Theme.muted)
                    }
                    if all.count > Self.shelvesExpanded {
                        Button { allShelvesOpen = true } label: {
                            Text("View all \(all.count) shelves →")
                                .font(Theme.body(13, .medium))
                                .foregroundStyle(Theme.neonBlue)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
        }
        .sheet(isPresented: $allShelvesOpen) {
            AllShelvesSheet(shelves: all, ownerLabel: ownerLabel)
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
        }
    }

    private var ownerLabel: String {
        model.user?.displayName ?? model.user?.username ?? model.username
    }

    @ViewBuilder
    private func shelfRail(_ shelf: ShelfSummary) -> some View {
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
            // A shared shelf was previously a dead end here: no way to open it
            // and no way to follow it (punch list #5.2).
            HStack(spacing: 10) {
                NavigationLink(value: ShelfRoute(shelfId: shelf.id, ownerName: ownerLabel)) {
                    ViewShelfLabel()
                }
                .buttonStyle(.plain)
                ShelfFollowButton(shelfId: shelf.id)
                Spacer()
            }
        }
    }

    // Web PublicReviewHistory parity (2026-07-28): the search field and
    // All/Written/DNF chips live on the profile itself (shown once there are
    // more than 3 reviews), not behind a "View all" push. The list previews 5
    // and expands in place via "Show all N reviews", exactly like the web.
    private var reviewsSection: some View {
        let filtered = filteredReviews
        let visible = showAllReviews ? filtered : Array(filtered.prefix(5))
        let hasWritten = model.reviews.contains { !($0.reviewText ?? "").isEmpty }
        let hasDnf = model.reviews.contains { $0.didNotFinish }

        return VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Reviews (\(model.reviews.count))")

            if model.reviews.count > 3 {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                    TextField("Search reviews...", text: $reviewSearch)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.foreground)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onChange(of: reviewSearch) { showAllReviews = true }
                }
                .modifier(ReviewSearchChrome())

                HStack(spacing: 8) {
                    reviewChip("all", "All")
                    if hasWritten { reviewChip("written", "Written reviews") }
                    if hasDnf { reviewChip("dnf", "DNF") }
                    Spacer()
                }
            }

            if visible.isEmpty {
                Text(reviewSearch.trimmingCharacters(in: .whitespaces).isEmpty
                     ? "No reviews in this category."
                     : "No reviews match \"\(reviewSearch)\"")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
            } else {
                ForEach(visible) { review in
                    PublicReviewRow(review: review)
                }
            }

            if !showAllReviews && filtered.count > 5 {
                Button {
                    showAllReviews = true
                } label: {
                    if DesignPreview.on {
                        Text("Show all \(filtered.count) reviews")
                            .font(Theme.body(14, .semibold))
                            .foregroundStyle(Theme.neonBlue)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .glassEffect(.regular, in: Capsule())
                    } else {
                        Text("Show all \(filtered.count) reviews")
                            .font(Theme.body(14, .semibold))
                            .foregroundStyle(Theme.neonBlue)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(Theme.surface.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                    }
                }
            }
        }
    }

    /// Same match rules as the web: tag filter first, then a case-insensitive
    /// search over title, authors, and review body.
    private var filteredReviews: [UserReviewRow] {
        var result = model.reviews
        if reviewFilter == "dnf" { result = result.filter { $0.didNotFinish } }
        if reviewFilter == "written" { result = result.filter { !($0.reviewText ?? "").isEmpty } }
        let q = reviewSearch.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return result }
        return result.filter {
            $0.title.lowercased().contains(q)
            || $0.authors.contains { $0.lowercased().contains(q) }
            || ($0.reviewText ?? "").lowercased().contains(q)
        }
    }

    private func reviewChip(_ key: String, _ label: String) -> some View {
        Button {
            // Web behavior: re-tapping an active tag clears it back to All.
            reviewFilter = (reviewFilter == key) ? "all" : key
            showAllReviews = reviewFilter != "all"
        } label: {
            if DesignPreview.on {
                // Glass chips; the selected one takes the thin lime ring.
                ShelfPill(kind: reviewFilter == key ? .active : .neutral) {
                    Text(label).font(Theme.body(13, .semibold))
                }
            } else {
                Text(label)
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(reviewFilter == key ? Theme.accentText : Theme.muted)
                    .padding(.horizontal, 13).padding(.vertical, 6)
                    .background(reviewFilter == key ? Theme.accent.opacity(0.15) : Theme.surfaceAlt.opacity(0.5), in: Capsule())
                    .overlay(Capsule().stroke(reviewFilter == key ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1))
            }
        }
        .buttonStyle(.plain)
    }
}

// One public-review card — shared by the profile's 5-row preview and the
// View-all list. Review text renders through ReviewHTMLText so formatting
// tags never show as raw code (user report 2026-07-23).
struct PublicReviewRow: View {
    let review: UserReviewRow

    var body: some View {
        NavigationLink(value: BookRoute(idOrSlug: review.bookSlug ?? review.bookId)) {
            HStack(alignment: .top, spacing: 12) {
                CoverThumb(url: review.coverImageUrl, width: 44, height: 66, radius: 5, title: review.title)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(review.title)
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(Theme.foreground)
                            .multilineTextAlignment(.leading)
                        if review.didNotFinish {
                            if DesignPreview.on {
                                DotBadge(text: "DNF", dot: Theme.destructive)
                            } else {
                                Text("DNF")
                                    .font(Theme.body(10, .semibold))
                                    .foregroundStyle(Theme.destructive)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .overlay(Capsule().stroke(Theme.destructive.opacity(0.5), lineWidth: 1))
                            }
                        }
                    }
                    if let rating = review.rating {
                        StarRow(rating: rating)
                    }
                    if let text = review.reviewText, !text.isEmpty {
                        ReviewHTMLText(html: text, baseSize: 13)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer()
            }
            .padding(12)
            .profileRowChrome()
        }
    }
}

// ── Refresh pieces shared by the public profile and buddy reads (2026-11) ──

/// The 1px wordmark-colour hairline the hero cards use (web .card-hairline).
struct HeroHairline: ViewModifier {
    var cornerRadius: CGFloat = 22
    func body(content: Content) -> some View {
        content
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(LinearGradient(
                        colors: [Theme.accent.opacity(0.55), Theme.neonBlue.opacity(0.35),
                                 Theme.neonPurple.opacity(0.45)],
                        startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
            )
    }
}

/// A list row's card: neutral glass at the refreshed 18pt radius, the old
/// 12pt bordered surface in v1.
struct ProfileRowChrome: ViewModifier {
    func body(content: Content) -> some View {
        if DesignPreview.on {
            content
                .background(Theme.surface.opacity(0.8))
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.foreground.opacity(0.10), lineWidth: 1))
        } else {
            content
                .background(Theme.surface.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
        }
    }
}

extension View {
    func heroHairline(_ cornerRadius: CGFloat = 22) -> some View {
        modifier(HeroHairline(cornerRadius: cornerRadius))
    }
    func profileRowChrome() -> some View { modifier(ProfileRowChrome()) }
}

/// A glass badge carrying its hue in a dot ("badges are glass with a colour dot").
struct DotBadge: View {
    let text: String
    let dot: Color
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(dot).frame(width: 7, height: 7)
            Text(text)
                .font(Theme.body(11, .semibold))
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .glassEffect(.regular, in: Capsule())
    }
}

/// The review search field: a glass capsule like .brandedField() in the
/// refreshed look, the bordered rounded rect in v1.
private struct ReviewSearchChrome: ViewModifier {
    func body(content: Content) -> some View {
        if DesignPreview.on {
            content
                .padding(.horizontal, 16)
                .frame(minHeight: 46)
                .glassEffect(.regular, in: Capsule())
        } else {
            content
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Theme.surface.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
        }
    }
}

/// "View shelf" on a profile's shelf rail: a glass pill in link blue.
private struct ViewShelfLabel: View {
    var body: some View {
        if DesignPreview.on {
            ShelfPill(kind: .neutral) {
                Text("View shelf")
                    .font(Theme.body(13, .semibold))
                    .foregroundStyle(Theme.neonBlue)
            }
        } else {
            Text("View shelf")
                .font(Theme.body(12, .semibold))
                .foregroundStyle(Theme.neonBlue)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .overlay(Capsule().stroke(Theme.neonBlue.opacity(0.5), lineWidth: 1))
        }
    }
}

/// The private / blocked screens' icon circle.
private struct GateIconChrome: ViewModifier {
    func body(content: Content) -> some View {
        if DesignPreview.on {
            content.glassEffect(.regular, in: Circle())
        } else {
            content
                .background(Theme.surface, in: Circle())
                .overlay(Circle().stroke(Theme.border, lineWidth: 1))
        }
    }
}

extension View {
    fileprivate func gateIconChrome() -> some View { modifier(GateIconChrome()) }
}

// ── Follow / unfollow a shelf from a public profile (punch list #5.2) ──
// Backed by the new /api/v1/shelves/<id>/follow endpoint; before this, the
// follow logic existed only as a web server action so native couldn't reach it.
struct ShelfFollowButton: View {
    let shelfId: String

    @State private var following = false
    @State private var busy = false
    @State private var loaded = false

    private struct Res: Codable { let ok: Bool; let following: Bool }

    var body: some View {
        Button {
            guard !busy else { return }
            busy = true
            let next = !following
            Task {
                defer { busy = false }
                let res: Res? = try? await APIClient.shared.request(
                    "/api/v1/shelves/\(shelfId)/follow",
                    method: next ? "POST" : "DELETE"
                )
                if let res { following = res.following }
            }
        } label: {
            if DesignPreview.on {
                // Glass, not lime: the reader's own Follow is the screen's
                // one solid pill; following a shelf takes the thin ring.
                ShelfPill(kind: following ? .active : .neutral) {
                    Label(following ? "Following" : "Follow",
                          systemImage: following ? "checkmark" : "plus")
                        .font(Theme.body(13, .semibold))
                }
            } else {
                Text(following ? "Following" : "Follow")
                    .font(Theme.body(12, .semibold))
                    .foregroundStyle(following ? Theme.muted : Theme.onAccent)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(following ? AnyShapeStyle(Theme.surfaceAlt) : AnyShapeStyle(Theme.accent),
                                in: Capsule())
                    .overlay(Capsule().stroke(following ? Theme.border : .clear, lineWidth: 1))
            }
        }
        .buttonStyle(.plain)
        .opacity(busy || !loaded ? 0.6 : 1)
        .disabled(busy)
        .task {
            let res: Res? = try? await APIClient.shared.get("/api/v1/shelves/\(shelfId)/follow")
            following = res?.following ?? false
            loaded = true
        }
    }
}

// ── Every shelf, when a profile has more than the inline list holds ──
struct AllShelvesSheet: View {
    let shelves: [ShelfSummary]
    let ownerLabel: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(shelves) { shelf in
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
                            ShelfRailCase(coverUrls: shelf.coverUrls,
                                          coverSlugs: shelf.coverSlugs,
                                          tint: shelf.tint)
                            HStack(spacing: 10) {
                                NavigationLink(value: ShelfRoute(shelfId: shelf.id, ownerName: ownerLabel)) {
                                    ViewShelfLabel()
                                }
                                .buttonStyle(.plain)
                                ShelfFollowButton(shelfId: shelf.id)
                                Spacer()
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(AmbientBackground())
            .navigationTitle("\(ownerLabel)'s shelves")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Theme.neonBlue)
                }
            }
            .appDestinations()
        }
    }
}


// ── Profile hero pieces shared by the reader's own profile and /u/ (2026-11-19) ──
// One implementation for both screens so they can't drift apart again
// (Rebekah: "my private profile is now outdated based on the newly designed
// public page").

/// Avatar inside a 2pt ring in the wordmark's three colours. The placeholder
/// is a soft tint, not solid lime.
struct ProfileHeroAvatar: View {
    let avatarUrl: String?
    let name: String
    var size: CGFloat = 84

    var body: some View {
        Group {
            if let avatarUrl,
               let url = avatarUrl.hasPrefix("/")
                   ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
                   : URL(string: avatarUrl) {
                CachedCoverImage(url: url) { Theme.surfaceAlt }
            } else {
                ZStack {
                    LinearGradient(colors: [Theme.accent.opacity(0.28), Theme.neonPurple.opacity(0.28)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                    Text(String(name.prefix(1)).uppercased())
                        .font(Theme.heading(size * 0.38, .bold))
                        .foregroundStyle(Theme.foreground)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .padding(3)
        .overlay(
            Circle().stroke(LinearGradient(colors: [Theme.accent, Theme.neonBlue, Theme.neonPurple],
                                           startPoint: .topLeading, endPoint: .bottomTrailing),
                            lineWidth: 2)
        )
        .shadow(color: Theme.neonPurple.opacity(0.25), radius: 14, y: 4)
    }
}

/// Glass tier badge with a colour dot (purple for Based Reader / staff).
struct ProfileTierBadge: View {
    let type: String?

    var body: some View {
        if let type, type != "user" {
            let display = (type == "beta_tester" || type == "based_reader") ? "premium" : type
            let label: String = {
                switch display {
                case "super_admin": return "Super Admin"
                case "admin": return "Admin"
                case "premium": return "Based Reader"
                case "reader": return "Reader"
                default: return display.replacingOccurrences(of: "_", with: " ").capitalized
                }
            }()
            DotBadge(text: label,
                     dot: ["super_admin", "admin", "premium"].contains(display) ? Theme.neonPurple : Theme.accent)
        }
    }
}

/// One of the Read / Reading / TBR cards, built like Pick From Your Shelf
/// (Rebekah 2026-11-19): it sits on its pile's blurred cover art, the newest
/// covers fan out tipped as if just pulled off the shelf, and the 1pt
/// hairline carries the pile's colour. Mirrors StatTile in profile-hero.tsx.
struct ProfileStatCard: View {
    let value: Int
    let label: String
    let tint: Color
    let covers: [String]

    private struct Pose { let x: CGFloat; let y: CGFloat; let angle: Double; let z: Double }

    private var poses: [Pose] {
        switch min(covers.count, 3) {
        case 1: return [Pose(x: 0, y: 0, angle: -4, z: 3)]
        case 2: return [Pose(x: 9, y: 0, angle: 5, z: 3), Pose(x: -11, y: 0, angle: -8, z: 2)]
        case 3: return [Pose(x: 0, y: -3, angle: -2, z: 3), Pose(x: -19, y: 0, angle: -11, z: 2),
                        Pose(x: 19, y: 0, angle: 9, z: 1)]
        default: return []
        }
    }

    var body: some View {
        let fan = Array(covers.prefix(3))
        VStack(spacing: 0) {
            // No covers in this pile: no placeholder art — the card collapses
            // to the count and label (Rebekah 2026-11-19: the generic book
            // icons took up too much height).
            if !fan.isEmpty {
                ZStack(alignment: .bottom) {
                    ForEach(Array(fan.enumerated()), id: \.offset) { i, url in
                        let p = poses[i]
                        CoverThumb(url: url, width: 39, height: 58, radius: 5)
                            .shadow(color: .black.opacity(0.45), radius: 7, y: 5)
                            .rotationEffect(.degrees(p.angle), anchor: .bottom)
                            .offset(x: p.x, y: p.y)
                            .zIndex(p.z)
                    }
                }
                .frame(height: 66)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 10)
            }

            Text(value.formatted())
                .font(Theme.heading(26, .bold))
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            HStack(spacing: 5) {
                Circle().fill(tint).frame(width: 6, height: 6)
                Text(label.uppercased())
                    .font(Theme.body(10, .bold)).tracking(0.8)
                    .foregroundStyle(Theme.foreground.opacity(0.72))
            }
            .padding(.top, 6)
        }
        .padding(.top, 14)
        .padding(.bottom, 12)
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity)
        .background(
            ZStack {
                Theme.surfaceAlt
                if let first = fan.first, let url = URL(string: first) {
                    CoverBlurImage(url: url)
                    Theme.scrim
                }
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(LinearGradient(colors: [tint.opacity(0.75), tint.opacity(0.18), tint.opacity(0.45)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                        lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label)")
    }
}


/// `.floatingBack()` only when the screen has no refreshed hero to hold its
/// own back button.
private struct FloatingBackUnlessHero: ViewModifier {
    let heroShown: Bool
    @Environment(\.shellRailWidth) private var rail
    func body(content: Content) -> some View {
        // On the Duo the back button lives in the side column, hero or not.
        if heroShown && rail == 0 { content } else { content.floatingBack() }
    }
}
