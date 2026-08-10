import SwiftUI

// Profile — recreates /profile: avatar (lime glow), name + account badge,
// @username, member-since, follower counts, lime Edit/View-public links,
// the Read/Reading/TBR stat pills, Invite Friends referral card,
// Top-Shelf Reads, the Shelves rails, Recent Reviews, Reading Journal,
// and the Import card. Sign out lives here for the native app.

@MainActor
@Observable
final class ProfileModel {
    var data: ProfileData?
    var error: String?
    var loading = false

    func load() async {
        loading = true; defer { loading = false }
        do { data = try await APIClient.shared.profile() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load your profile." }
    }
}

struct ProfileRootView: View {
    @Binding var path: NavigationPath
    var body: some View {
        NavigationStack(path: $path) {
            ProfileView(path: $path)
                .pushedScreenChrome()
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
        }
    }
}

struct ProfileView: View {
    @Binding var path: NavigationPath
    @Environment(AuthStore.self) private var auth
    @Environment(ChromeState.self) private var chrome: ChromeState?
    @State private var model = ProfileModel()
    @State private var editProfileOpen = false
    @State private var copiedReferral = false
    @State private var referralsOpen = false
    @State private var showAllReviews = false
    @State private var showAllJournal = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let data = model.data {
                    header(data)
                    statPills(data)
                    referralCard(data)
                    topShelf(data)
                    shelvesSection(data)
                    reviewsSection(data)
                    journalSection(data)
                    importCard
                    signOutButton
                } else if model.loading {
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 100)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .tracksScrollAtTop()
        .reportsPage("/profile")
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(isPresented: $editProfileOpen) {
            if let user = model.data?.user {
                EditProfileSheet(user: user, onSaved: { await model.load() })
                    .presentationBackground(Theme.bg)
            }
        }
        .sheet(isPresented: $referralsOpen) {
            ReferralsSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.bg)
        }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    // ── Header ──
    private func header(_ data: ProfileData) -> some View {
        HStack(alignment: .top, spacing: 16) {
            avatar(data.user)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(data.user.displayName ?? data.user.username ?? "Reader")
                        .font(Theme.heading(22, .bold))
                        .foregroundStyle(Theme.foreground)
                    if let type = data.user.accountType, type != "user" {
                        Text(badgeLabel(type))
                            .font(Theme.body(11, .medium))
                            .foregroundStyle(Theme.neonPurple)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .overlay(Capsule().stroke(Theme.neonPurple.opacity(0.5), lineWidth: 1))
                    }
                }
                if let username = data.user.username {
                    Text("@\(username)")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                }
                // Bio was editable but rendered nowhere on iOS — readers who
                // wrote one on the web couldn't see it in the app at all.
                if let bio = data.user.bio?.trimmingCharacters(in: .whitespacesAndNewlines), !bio.isEmpty {
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
                Text("Member since \(memberSince(data.user.createdAt))")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                HStack(spacing: 6) {
                    (Text("\(data.followerCount) ").fontWeight(.bold) + Text("followers"))
                    Text("·")
                    (Text("\(data.followingCount) ").fontWeight(.bold) + Text("following"))
                }
                .font(Theme.body(14))
                .foregroundStyle(Theme.foreground.opacity(0.85))

                HStack(spacing: 8) {
                    Button {
                        // Native Edit Profile sheet (2026-07-23) — used to
                        // bounce out to the web app.
                        editProfileOpen = true
                    } label: {
                        // Lime in dark mode, branded blue in light — lime on
                        // the light background was illegible.
                        Text("Edit Profile").font(Theme.body(14, .medium))
                            .foregroundStyle(Color(dark: "a3e635", light: "0ea5e9"))
                    }
                    Text("·").foregroundStyle(Theme.muted)
                    Button {
                        // Native public profile, not the browser
                        // (user request 2026-07-15).
                        if let username = data.user.username {
                            path.append(UserRoute(username: username))
                        }
                    } label: {
                        Text("View public profile").font(Theme.body(14, .medium))
                            .foregroundStyle(Color(dark: "a3e635", light: "0ea5e9"))
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    private func badgeLabel(_ type: String) -> String {
        switch type {
        case "super_admin": return "Super Admin"
        case "admin": return "Admin"
        // Beta testers see themselves as Based Readers (rule 2026-07-22) —
        // the delineation lives only on admin surfaces.
        case "based_reader", "premium", "beta_tester": return "Based Reader"
        default: return type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func avatar(_ user: ProfileUser) -> some View {
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
                    Text(String((user.displayName ?? "?").prefix(1)).uppercased())
                        .font(Theme.heading(30, .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .frame(width: 80, height: 80)
        .clipShape(Circle())
        .shadow(color: Theme.accent.opacity(0.3), radius: 12)
    }

    private func memberSince(_ createdAt: String) -> String {
        var date = ISO8601DateFormatter().date(from: createdAt)
            ?? ISO8601DateFormatter.withFractional.date(from: createdAt)
        if date == nil {
            // SQLite "YYYY-MM-DD HH:MM:SS" format
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
            date = f.date(from: createdAt)
        }
        guard let date else { return String(createdAt.prefix(7)) }
        let out = DateFormatter(); out.dateFormat = "MMMM yyyy"
        return out.string(from: date)
    }

    // ── Stat pills — tappable, deep-link into My Library (2026-07-23) ──
    private func statPills(_ data: ProfileData) -> some View {
        HStack(spacing: 12) {
            statPill("\(data.stats.completed)", "Read", tint: Theme.neonPurple,
                     dest: (group: "activity", filter: "completed"))
            statPill("\(data.stats.currentlyReading)", "Reading", tint: Theme.neonBlue,
                     dest: (group: "activity", filter: "currently_reading"))
            statPill("\(data.stats.tbr)", "TBR", tint: Theme.accent,
                     dest: (group: "tbr", filter: "all"))
        }
    }

    private func statPill(_ value: String, _ label: String, tint: Color,
                          dest: (group: String, filter: String)) -> some View {
        Button {
            chrome?.pendingLibrarySelection = dest
            chrome?.selectTab(.library)
        } label: {
            VStack(spacing: 2) {
                Text(value)
                    .font(Theme.heading(26, .bold))
                    .foregroundStyle(Theme.foreground)
                Text(label)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(tint.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // ── Invite Friends ──
    private func referralCard(_ data: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                // Web: the person+ icon is neon blue (text-neon-blue).
                Image(systemName: "person.badge.plus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.neonBlue)
                Text("Invite Friends")
                    .font(Theme.body(17, .bold))
                    .foregroundStyle(Theme.foreground)
            }
            Text("Share your link and we'll track who joins through you.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
            HStack(spacing: 10) {
                // Web: solid surface box w/ border. verbatim: stops SwiftUI's
                // markdown pass from auto-linking the URL and painting it
                // with the lime tint — it must render as plain grey text.
                Text(verbatim: "https://thebasedreader.app/signup?ref=\(data.referralCode)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                Button {
                    UIPasteboard.general.string = "https://thebasedreader.app/signup?ref=\(data.referralCode)"
                    copiedReferral = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copiedReferral = false }
                } label: {
                    Text(copiedReferral ? "Copied!" : "Copy")
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            // Always shown, and tappable — it used to appear only once
            // someone had joined, so the "has anyone signed up yet?" state
            // showed nothing at all (punch list #4).
            Button { referralsOpen = true } label: {
                HStack(spacing: 4) {
                    Text(data.referralCount == 0
                         ? "No one has joined yet — see details"
                         : "\(data.referralCount) reader\(data.referralCount == 1 ? "" : "s") joined through you 🎉")
                        .font(Theme.body(12, .medium))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(Theme.neonBlue)
            }
        }
        .padding(16)
        .background(Theme.accent.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.accent.opacity(0.25), lineWidth: 1))
    }

    // ── Top-Shelf Reads ──
    private func topShelf(_ data: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Top-Shelf Reads")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
            if data.favorites.isEmpty {
                VStack(spacing: 4) {
                    Text("Pin your all-time favorites here")
                        .font(Theme.body(16))
                        .foregroundStyle(Theme.muted)
                    Text("Tap Top Shelf on any book page to add it")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted.opacity(0.7))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
                        .foregroundStyle(Theme.border)
                )
            } else {
                TopShelfCase(favorites: data.favorites, avatarUrl: data.user.avatarUrl)
            }
        }
    }

    // ── Shelves rails ──
    private func shelvesSection(_ data: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Shelves")
                    .font(Theme.heading(20, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Text("View all →")
                    .font(Theme.body(15, .medium))
                    .foregroundStyle(Theme.readMoreLink)
            }
            ForEach(data.shelves) { shelf in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Circle().fill(shelf.tint).frame(width: 10, height: 10)
                        Text(shelf.name)
                            .font(Theme.body(17, .semibold))
                            .foregroundStyle(Theme.foreground)
                        Text("\(shelf.bookCount)")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                        Spacer()
                        NavigationLink(value: ShelfRoute(shelfId: shelf.id)) {
                            Text("View →")
                                .font(Theme.body(14, .medium))
                                .foregroundStyle(Theme.readMoreLink)
                        }
                    }
                    ShelfRailCase(coverUrls: shelf.coverUrls, coverSlugs: shelf.coverSlugs, tint: shelf.tint)
                }
            }
        }
    }

    // Recent Reviews — mirrors review-history.tsx: a 3-up cover grid capped
    // at the 6 most recent, star pill and/or red DNF tag bottom-right, the
    // owner's avatar bottom-left when a written review exists, and a
    // "View all reviews" link underneath.
    private func reviewsSection(_ data: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Reviews")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
            if data.reviews.isEmpty {
                Text("No reviews yet.")
                    .font(Theme.body(16))
                    .foregroundStyle(Theme.muted)
            } else {
                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12),
                ], spacing: 12) {
                    ForEach(data.reviews.prefix(6)) { review in
                        // Button + path.append, not NavigationLink — value
                        // links misfire in sibling-card grids on iOS 27.
                        Button {
                            path.append(ReviewsRoute(
                                bookIdOrSlug: review.bookSlug ?? review.bookId,
                                bookTitle: review.title,
                                scrollToReviewId: review.reviewId))
                        } label: {
                            reviewGridCell(review, avatarUrl: data.user.avatarUrl)
                        }
                        .buttonStyle(.plain)
                    }
                }

                Button {
                    showAllReviews = true
                } label: {
                    Text("View all reviews →")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.neonBlue)
                        .frame(maxWidth: .infinity)
                }
                .padding(.top, 2)
            }
        }
        .fullScreenCover(isPresented: $showAllReviews) {
            NavigationStack {
                AllReviewsView()
                    .appDestinations()
            }
            // Covers have no shell bars — without these overrides the back
            // chevron inherits the presenting screen's bar insets + scrolled
            // chrome state and slides up out of reach (user bug 2026-07-12).
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
    }

    private func reviewGridCell(_ review: UserReviewRow, avatarUrl: String?) -> some View {
        GeometryReader { geo in
            CoverThumb(url: review.coverImageUrl,
                       width: geo.size.width,
                       height: geo.size.width * 1.5,
                       radius: 10, title: review.title)
                .overlay(alignment: .bottomTrailing) {
                    // Avatar rides INSIDE the pill, Top Shelf style (user
                    // request 2026-07-12) — attached to the rating bubble,
                    // or to the DNF bubble when there's no rating.
                    HStack(spacing: 4) {
                        if let rating = review.rating, rating > 0 {
                            HStack(spacing: 3) {
                                profileAvatarBubble(avatarUrl)
                                Text(ratingLabel(rating))
                                    .font(Theme.body(11, .semibold))
                                    .foregroundStyle(.white)
                                Text("★")
                                    .font(Theme.body(11))
                                    .foregroundStyle(.yellow)
                            }
                            .padding(.leading, 3).padding(.trailing, 8).padding(.vertical, 3)
                            .background(.black.opacity(0.75), in: Capsule())
                        }
                        if review.didNotFinish {
                            HStack(spacing: 3) {
                                if (review.rating ?? 0) <= 0 {
                                    profileAvatarBubble(avatarUrl)
                                }
                                Text("DNF")
                                    .font(Theme.body(9, .bold))
                                    .foregroundStyle(.white)
                            }
                            .padding(.leading, (review.rating ?? 0) > 0 ? 7 : 3)
                            .padding(.trailing, 7).padding(.vertical, 3)
                            .background(Theme.destructive.opacity(0.9), in: Capsule())
                        }
                    }
                    .padding(6)
                }
        }
        .aspectRatio(2 / 3, contentMode: .fit)
        .contentShape(RoundedRectangle(cornerRadius: 10))
    }

    /// 18pt avatar circle inside the rating/DNF pill (mirrors the Top Shelf
    /// FavoriteShelfCover avatar bubble, incl. the accent-star fallback).
    private func profileAvatarBubble(_ avatarUrl: String?) -> some View {
        Group {
            if let avatarUrl,
               let url = avatarUrl.hasPrefix("/")
                   ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
                   : URL(string: avatarUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.surfaceAlt }
            } else {
                ZStack {
                    Theme.accent.opacity(0.6)
                    Text("★").font(.system(size: 8, weight: .bold)).foregroundStyle(.black)
                }
            }
        }
        .frame(width: 18, height: 18)
        .clipShape(Circle())
    }

    private func ratingLabel(_ rating: Double) -> String {
        rating.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(rating))
            : String(format: "%.2f", rating).replacingOccurrences(of: "0$", with: "", options: .regularExpression)
    }
}

// ── Shared shelf furniture — used by BOTH the private profile and
// /u/[username]; keep the two pages visually identical. Recreates the
// web's favorites-shelf.tsx / profile-shelves-section.tsx: a padded
// "bookcase" card, a darker shelf-edge plank across the bottom, and a
// soft floor shadow underneath.

extension ShelfSummary {
    /// The shelf's accent color (falls back to the web's amber default).
    var tint: Color {
        if let hex = color, hex.hasPrefix("#"), hex.count == 7 {
            return Color(hex: String(hex.dropFirst()))
        }
        return Color(hex: "d97706")
    }
}

extension Theme {
    /// The web's .read-more-link: lime in dark mode, neon purple in light.
    static let readMoreLink = Color(dark: "a3e635", light: "a855f7")
}

extension View {
    /// The web's .mask-fade-right: the row fades out over its last 15%
    /// to hint that it scrolls sideways.
    func maskFadeRight() -> some View {
        mask(
            LinearGradient(
                stops: [
                    .init(color: .black, location: 0),
                    .init(color: .black, location: 0.85),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading, endPoint: .trailing
            )
        )
    }
}

/// Tailwind amber tokens the web Top-Shelf case is built from.
// Shared with the shelves list (TopShelfListCard) — the wood palette.
enum ShelfWood {
    static let amber700 = Color(hex: "b45309")
    static let amber800 = Color(hex: "92400e")
    static let amber900 = Color(hex: "78350f")
}

/// The wooden Top-Shelf Reads bookcase (web: favorites-shelf.tsx).
struct TopShelfCase: View {
    let favorites: [FavoriteBookRow]
    let avatarUrl: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let isLight = colorScheme == .light
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(favorites.sorted { $0.position < $1.position }) { fav in
                            NavigationLink(value: BookRoute(idOrSlug: fav.slug ?? fav.id)) {
                                FavoriteShelfCover(fav: fav, avatarUrl: avatarUrl)
                            }
                        }
                    }
                    .padding(.leading, 16)
                    .padding(.trailing, 48)   // web pr-10: last cover clears the fade
                    .padding(.top, 22)
                    .padding(.bottom, 18)
                }
                .maskFadeRight()
                // Shelf-edge plank, full bleed across the case — lifted off
                // the card bottom (web pb-2) so it floats inside the case.
                LinearGradient(
                    colors: isLight
                        ? [ShelfWood.amber800.opacity(0.30), ShelfWood.amber900.opacity(0.40)]
                        : [ShelfWood.amber700.opacity(0.30), ShelfWood.amber800.opacity(0.40)],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 6)
                Color.clear.frame(height: 8)
            }
            .background(
                LinearGradient(
                    colors: isLight
                        ? [ShelfWood.amber900.opacity(0.10), ShelfWood.amber800.opacity(0.20)]
                        : [ShelfWood.amber900.opacity(0.20), ShelfWood.amber800.opacity(0.30)],
                    startPoint: .top, endPoint: .bottom
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke((isLight ? ShelfWood.amber800 : ShelfWood.amber700).opacity(0.20), lineWidth: 1)
            )

            // Floor shadow under the case.
            LinearGradient(colors: [.black.opacity(0.10), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 8)
                .padding(.horizontal, 8)
        }
    }
}

/// One favorite on the top shelf: 72×108 cover with a spine shadow and
/// the avatar + rating pill overlapping the bottom-right corner.
struct FavoriteShelfCover: View {
    let fav: FavoriteBookRow
    let avatarUrl: String?

    var body: some View {
        CoverThumb(url: fav.coverImageUrl, width: 72, height: 108, radius: 3, title: fav.title)
            .overlay(alignment: .leading) {
                LinearGradient(colors: [.black.opacity(0.20), .clear],
                               startPoint: .leading, endPoint: .trailing)
                    .frame(width: 3)
            }
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .shadow(color: .black.opacity(0.3), radius: 4, x: 2, y: 2)
            .overlay(alignment: .bottomTrailing) {
                if let rating = fav.userRating, rating > 0 {
                    HStack(spacing: 3) {
                        avatarBubble
                        Text("\(ratingText(rating)) ★")
                            .font(Theme.body(9, .medium))
                            .foregroundStyle(.white)
                    }
                    .padding(.leading, 2)
                    .padding(.trailing, 6)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.75), in: Capsule())
                    .padding(4)
                }
            }
    }

    @ViewBuilder private var avatarBubble: some View {
        // Avatar paths come back relative (/uploads/...) — resolve against the API host.
        if let avatarUrl,
           let url = avatarUrl.hasPrefix("/")
               ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
               : URL(string: avatarUrl) {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: { Theme.surfaceAlt }
            .frame(width: 14, height: 14)
            .clipShape(Circle())
        } else {
            Circle().fill(Theme.accent.opacity(0.6))
                .frame(width: 14, height: 14)
                .overlay(
                    Text("★").font(.system(size: 7, weight: .bold)).foregroundStyle(.black)
                )
        }
    }

    private func ratingText(_ r: Double) -> String {
        r.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(r)) : String(format: "%.2f", r)
    }
}

/// A custom shelf's mini bookcase (web: MiniShelfRow) — tinted case,
/// padded 46×69 covers, tinted shelf-edge plank, floor shadow.
struct ShelfRailCase: View {
    let coverUrls: [String]
    let coverSlugs: [String]
    let tint: Color

    var body: some View {
        if coverUrls.isEmpty {
            Text("Empty shelf")
                .font(Theme.body(11))
                .foregroundStyle(Theme.muted.opacity(0.6))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                        .foregroundStyle(tint.opacity(0.15))
                )
        } else {
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(coverUrls.prefix(8).enumerated()), id: \.offset) { i, url in
                                let slug = i < coverSlugs.count ? coverSlugs[i] : ""
                                if slug.isEmpty {
                                    railCover(url)
                                } else {
                                    NavigationLink(value: BookRoute(idOrSlug: slug)) {
                                        railCover(url)
                                    }
                                }
                            }
                        }
                        .padding(.leading, 12)
                        .padding(.trailing, 40)   // web pr-8: last cover clears the fade
                        .padding(.top, 12)
                        .padding(.bottom, 10)
                    }
                    .maskFadeRight()
                    // Tinted shelf-edge plank (web: accent30 → accent45 hex
                    // alpha), lifted off the card bottom (web pb-1.5) so it
                    // floats inside the case.
                    LinearGradient(colors: [tint.opacity(0.188), tint.opacity(0.271)],
                                   startPoint: .top, endPoint: .bottom)
                        .frame(height: 5)
                    Color.clear.frame(height: 6)
                }
                .background(
                    // Web: accent08 → accent15 (hex alpha ≈ 3% → 8%).
                    LinearGradient(colors: [tint.opacity(0.031), tint.opacity(0.082)],
                                   startPoint: .top, endPoint: .bottom)
                )
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(tint.opacity(0.125), lineWidth: 1))

                LinearGradient(colors: [.black.opacity(0.08), .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: 6)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func railCover(_ url: String) -> some View {
        CoverThumb(url: url, width: 46, height: 69, radius: 2)
            .shadow(color: .black.opacity(0.3), radius: 3, x: 2, y: 2)
    }
}

extension ProfileView {
    // ── Reading Journal — mirrors reading-journal.tsx: the 3 most recently
    // noted books, each showing only its LATEST note with "stacked card"
    // peek edges when more exist, a per-book "View all N notes" link, and
    // "View all N entries" for the full journal. (Previously every note of
    // every book was listed out endlessly.)
    private func journalSection(_ data: ProfileData) -> some View {
        // Group by book PRESERVING recency order (notes arrive newest-first).
        var order: [String] = []
        var groups: [String: [JournalNote]] = [:]
        for note in data.journalNotes {
            if groups[note.bookId] == nil { order.append(note.bookId) }
            groups[note.bookId, default: []].append(note)
        }
        let displayed = order.prefix(3)

        return VStack(alignment: .leading, spacing: 18) {
            Text("Reading Journal (\(data.journalNotes.count))")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)

            ForEach(Array(displayed), id: \.self) { bookId in
                if let notes = groups[bookId], let top = notes.first {
                    VStack(alignment: .leading, spacing: 10) {
                        NavigationLink(value: BookRoute(idOrSlug: top.bookSlug ?? bookId)) {
                            HStack(spacing: 10) {
                                CoverThumb(url: top.bookCoverUrl, width: 24, height: 36, radius: 4)
                                Text(top.bookTitle)
                                    .font(Theme.body(15, .semibold))
                                    .foregroundStyle(Theme.foreground)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(notes.count) note\(notes.count == 1 ? "" : "s")")
                                    .font(Theme.body(12))
                                    .foregroundStyle(Theme.muted)
                            }
                        }

                        // Latest note with peeking stacked edges when more exist
                        noteCard(top)
                            .background(alignment: .bottom) {
                                if notes.count >= 2 {
                                    RoundedRectangle(cornerRadius: 14)
                                        .fill(Theme.surface.opacity(0.7))
                                        .overlay(RoundedRectangle(cornerRadius: 14)
                                            .stroke(Theme.border.opacity(0.4), lineWidth: 1))
                                        .frame(height: 24)
                                        .padding(.horizontal, 6)
                                        .offset(y: 6)
                                }
                            }
                            .background(alignment: .bottom) {
                                if notes.count >= 3 {
                                    RoundedRectangle(cornerRadius: 14)
                                        .fill(Theme.surface.opacity(0.45))
                                        .overlay(RoundedRectangle(cornerRadius: 14)
                                            .stroke(Theme.border.opacity(0.3), lineWidth: 1))
                                        .frame(height: 24)
                                        .padding(.horizontal, 12)
                                        .offset(y: 12)
                                }
                            }
                            .padding(.bottom, notes.count >= 3 ? 12 : (notes.count >= 2 ? 6 : 0))

                        if notes.count > 1 {
                            NavigationLink(value: BookRoute(idOrSlug: top.bookSlug ?? bookId)) {
                                HStack(spacing: 3) {
                                    Text("View all \(notes.count) notes")
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 9, weight: .semibold))
                                }
                                .font(Theme.body(12, .medium))
                                .foregroundStyle(Theme.readMoreLink)
                                .frame(maxWidth: .infinity)
                            }
                            .padding(.top, 2)
                        }
                    }
                }
            }

            if order.count > 3 || data.journalNotes.count > 5 {
                Button {
                    showAllJournal = true
                } label: {
                    Text("View all \(data.journalNotes.count) entries →")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.readMoreLink)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .fullScreenCover(isPresented: $showAllJournal) {
            NavigationStack {
                AllJournalView()
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
    }

    private func noteCard(_ note: JournalNote) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let pct = note.percentComplete {
                    Text("\(pct)%")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
                } else if let page = note.pageNumber {
                    Text("p. \(page)")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
                }
                if let mood = note.mood { Text(moodEmoji(mood)) }
                Spacer()
                Text(shortDate(note.createdAt))
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
            }
            Text(note.noteText)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground.opacity(0.9))
        }
        .padding(14)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
    }

    private func moodEmoji(_ mood: String) -> String {
        ["excited": "🤩", "tense": "😰", "emotional": "🥺", "bored": "😴",
         "relaxed": "😌", "curious": "🤔", "confused": "😵‍💫", "nostalgic": "🥹"][mood] ?? ""
    }

    private func shortDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        let date = f.date(from: iso) ?? ISO8601DateFormatter.withFractional.date(from: iso)
        guard let date else { return "" }
        let out = DateFormatter(); out.dateFormat = "MMM d"
        return out.string(from: date)
    }

    private var importCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "tray.and.arrow.down.fill")
                .font(.system(size: 24))
                .foregroundStyle(Theme.neonBlue)
            VStack(alignment: .leading, spacing: 3) {
                Text("Import your library")
                    .font(Theme.body(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Text("Bring books, ratings, and reading history from StoryGraph or Goodreads")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }

    private var signOutButton: some View {
        Button {
            Task { await auth.logout() }
        } label: {
            Text("Sign Out")
                .font(Theme.body(15, .medium))
                .foregroundStyle(Theme.destructive)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.destructive.opacity(0.3), lineWidth: 1))
        }
    }
}

// ── View-all screens (presented as covers from the profile) ─────────────

/// Full review history — rows in the pre-grid style; taps open the book's
/// reviews page scrolled to the review. Data: GET /api/v1/profile/reviews.
struct AllReviewsView: View {
    @State private var reviews: [UserReviewRow] = []
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Text("All Reviews\(loaded ? " (\(reviews.count))" : "")")
                        .font(Theme.heading(24, .bold))
                        .foregroundStyle(Theme.foreground)
                }
                .padding(.top, 14)

                if !loaded {
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else if reviews.isEmpty {
                    Text("No reviews yet.")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else {
                    ForEach(reviews) { review in
                        NavigationLink(value: ReviewsRoute(
                            bookIdOrSlug: review.bookSlug ?? review.bookId,
                            bookTitle: review.title,
                            scrollToReviewId: review.reviewId)) {
                            HStack(alignment: .top, spacing: 12) {
                                CoverThumb(url: review.coverImageUrl, width: 44, height: 66, radius: 5, title: review.title)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(review.title)
                                        .font(Theme.body(15, .semibold))
                                        .foregroundStyle(Theme.foreground)
                                        .multilineTextAlignment(.leading)
                                    HStack(spacing: 8) {
                                        if let rating = review.rating {
                                            StarRow(rating: rating)
                                        }
                                        if review.didNotFinish {
                                            Text("DNF")
                                                .font(Theme.body(10, .bold))
                                                .foregroundStyle(Theme.destructive)
                                                .padding(.horizontal, 6).padding(.vertical, 2)
                                                .background(Theme.destructive.opacity(0.12), in: Capsule())
                                        }
                                    }
                                    if let text = review.reviewText, !text.isEmpty {
                                        Text(text)
                                            .font(Theme.body(13))
                                            .foregroundStyle(Theme.muted)
                                            .lineLimit(3)
                                            .multilineTextAlignment(.leading)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(Theme.surface.opacity(0.55))
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
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
        .task {
            struct Res: Codable { let ok: Bool; let reviews: [UserReviewRow] }
            if let res: Res = try? await APIClient.shared.get("/api/v1/profile/reviews") {
                reviews = res.reviews
            }
            loaded = true
        }
    }
}

/// Full reading journal — every note, grouped by book, newest first.
/// Data: GET /api/v1/profile/journal.
struct AllJournalView: View {
    @State private var notes: [JournalNote] = []
    @State private var loaded = false

    private var grouped: [(bookId: String, notes: [JournalNote])] {
        var order: [String] = []
        var groups: [String: [JournalNote]] = [:]
        for note in notes {
            if groups[note.bookId] == nil { order.append(note.bookId) }
            groups[note.bookId, default: []].append(note)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Text("Reading Journal\(loaded ? " (\(notes.count))" : "")")
                        .font(Theme.heading(24, .bold))
                        .foregroundStyle(Theme.foreground)
                }
                .padding(.top, 14)

                if !loaded {
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else {
                    ForEach(grouped, id: \.bookId) { group in
                        if let top = group.notes.first {
                            VStack(alignment: .leading, spacing: 10) {
                                NavigationLink(value: BookRoute(idOrSlug: top.bookSlug ?? group.bookId)) {
                                    HStack(spacing: 10) {
                                        CoverThumb(url: top.bookCoverUrl, width: 24, height: 36, radius: 4)
                                        Text(top.bookTitle)
                                            .font(Theme.body(15, .semibold))
                                            .foregroundStyle(Theme.foreground)
                                            .lineLimit(1)
                                        Spacer()
                                        Text("\(group.notes.count) note\(group.notes.count == 1 ? "" : "s")")
                                            .font(Theme.body(12))
                                            .foregroundStyle(Theme.muted)
                                    }
                                }
                                ForEach(group.notes) { note in
                                    journalNoteCard(note)
                                }
                            }
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
        .task {
            struct Res: Codable { let ok: Bool; let notes: [JournalNote] }
            if let res: Res = try? await APIClient.shared.get("/api/v1/profile/journal") {
                notes = res.notes
            }
            loaded = true
        }
    }

    private func journalNoteCard(_ note: JournalNote) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let pct = note.percentComplete {
                    Text("\(pct)%")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
                } else if let page = note.pageNumber {
                    Text("p. \(page)")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
                }
                if let mood = note.mood, let emoji = ["excited": "🔥", "tense": "😰", "emotional": "😢", "bored": "😴", "relaxed": "😌", "curious": "🤔", "confused": "😵", "nostalgic": "🥹"][mood] {
                    Text(emoji)
                }
                Spacer()
                Text(String(note.createdAt.prefix(10)))
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
            }
            Text(note.noteText)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground.opacity(0.9))
        }
        .padding(14)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
    }
}

// ── Referrals list — the web's /profile/referrals page (punch list #4) ──
struct ReferralsSheet: View {
    @Environment(\.dismiss) private var dismiss

    struct Referral: Codable, Identifiable, Hashable {
        let id: String
        let username: String?
        let displayName: String?
        let avatarUrl: String?
        let joinedAt: String?
    }
    private struct Res: Codable { let ok: Bool; let referrals: [Referral] }

    @State private var referrals: [Referral] = []
    @State private var loading = true

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Your referrals")
                    .font(Theme.heading(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            Text(referrals.isEmpty
                 ? "No one has joined through your link yet."
                 : "\(referrals.count) \(referrals.count == 1 ? "person has" : "people have") joined through your link.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)

            if loading {
                ProgressView().tint(Theme.accent)
                    .frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(referrals) { r in
                            HStack(spacing: 12) {
                                avatar(r)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.displayName ?? r.username ?? "Reader")
                                        .font(Theme.body(15, .semibold))
                                        .foregroundStyle(Theme.foreground)
                                    if let joined = r.joinedAt.flatMap(DateFmt.parse) {
                                        Text("Joined \(joined.formatted(.dateTime.month(.abbreviated).day().year()))")
                                            .font(Theme.body(12))
                                            .foregroundStyle(Theme.muted)
                                    }
                                }
                                Spacer()
                            }
                            .padding(12)
                            .background(Theme.surface.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .task {
            let res: Res? = try? await APIClient.shared.get("/api/v1/profile/referrals")
            referrals = res?.referrals ?? []
            loading = false
        }
    }

    private func avatar(_ r: Referral) -> some View {
        Group {
            if let raw = r.avatarUrl,
               let url = raw.hasPrefix("/")
                   ? URL(string: raw, relativeTo: APIClient.baseURL)
                   : URL(string: raw) {
                AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                    placeholder: { Theme.surfaceAlt }
            } else {
                ZStack {
                    Theme.accent
                    Text(String((r.displayName ?? r.username ?? "?").prefix(1)).uppercased())
                        .font(Theme.body(14, .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .frame(width: 36, height: 36)
        .clipShape(Circle())
    }
}
