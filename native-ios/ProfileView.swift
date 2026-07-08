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
            ProfileView()
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
                .navigationDestination(for: String.self) { shelfId in
                    ShelfDetailView(shelfId: shelfId)
                }
        }
    }
}

struct ProfileView: View {
    @Environment(AuthStore.self) private var auth
    @State private var model = ProfileModel()
    @State private var copiedReferral = false

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
        .refreshable { await model.load() }
        .task { await model.load() }
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

                // Edit/public-profile flows open the live site until they go native
                HStack(spacing: 8) {
                    Button {
                        if let url = URL(string: "https://thebasedreader.app/profile/edit") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("Edit Profile").font(Theme.body(14, .medium)).foregroundStyle(Theme.accent)
                    }
                    Text("·").foregroundStyle(Theme.muted)
                    Button {
                        if let username = data.user.username,
                           let url = URL(string: "https://thebasedreader.app/u/\(username)") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("View public profile").font(Theme.body(14, .medium)).foregroundStyle(Theme.accent)
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
        case "based_reader": return "Based Reader"
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

    // ── Stat pills ──
    private func statPills(_ data: ProfileData) -> some View {
        HStack(spacing: 12) {
            statPill("\(data.stats.completed)", "Read", tint: Theme.neonPurple)
            statPill("\(data.stats.currentlyReading)", "Reading", tint: Theme.neonBlue)
            statPill("\(data.stats.tbr)", "TBR", tint: Theme.accent)
        }
    }

    private func statPill(_ value: String, _ label: String, tint: Color) -> some View {
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

    // ── Invite Friends ──
    private func referralCard(_ data: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Invite Friends", systemImage: "person.badge.plus")
                .font(Theme.body(17, .bold))
                .foregroundStyle(Theme.foreground)
            Text("Share your link and we'll track who joins through you.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
            HStack(spacing: 10) {
                Text("https://thebasedreader.app/signup?ref=\(data.referralCode)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Theme.surfaceAlt.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
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
            if data.referralCount > 0 {
                Text("\(data.referralCount) reader\(data.referralCount == 1 ? "" : "s") joined through you 🎉")
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(Theme.accent)
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
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(data.favorites.sorted { $0.position < $1.position }) { fav in
                            NavigationLink(value: BookRoute(idOrSlug: fav.slug ?? fav.id)) {
                                CoverThumb(url: fav.coverImageUrl, width: 88, height: 132, radius: 8)
                            }
                            .buttonStyle(TapScaleButtonStyle())
                        }
                    }
                    .padding(.trailing, 32)
                }
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
                    .foregroundStyle(Theme.accent)
            }
            ForEach(data.shelves) { shelf in
                let tint: Color = {
                    if let hex = shelf.color, hex.hasPrefix("#"), hex.count == 7 {
                        return Color(hex: String(hex.dropFirst()))
                    }
                    return Theme.accent
                }()
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Circle().fill(tint).frame(width: 10, height: 10)
                        Text(shelf.name)
                            .font(Theme.body(17, .semibold))
                            .foregroundStyle(Theme.foreground)
                        Text("\(shelf.bookCount)")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                        Spacer()
                        NavigationLink(value: shelf.id) {
                            Text("View →")
                                .font(Theme.body(14, .medium))
                                .foregroundStyle(Theme.accent)
                        }
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(Array(shelf.coverUrls.prefix(8).enumerated()), id: \.offset) { _, url in
                                CoverThumb(url: url, width: 62, height: 93, radius: 6)
                            }
                        }
                        .padding(10)
                    }
                    .background(
                        LinearGradient(colors: [tint.opacity(0.07), tint.opacity(0.13)],
                                       startPoint: .top, endPoint: .bottom)
                            .background(Theme.surface.opacity(0.5))
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                }
            }
        }
    }

    private func reviewsSection(_ data: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent Reviews")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
            Text("No reviews yet.")
                .font(Theme.body(16))
                .foregroundStyle(Theme.muted)
        }
    }

    // ── Reading Journal ──
    private func journalSection(_ data: ProfileData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Reading Journal (\(data.journalNotes.count))")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)

            let grouped = Dictionary(grouping: data.journalNotes, by: \.bookId)
            ForEach(Array(grouped.keys.sorted()), id: \.self) { bookId in
                if let notes = grouped[bookId], let first = notes.first {
                    VStack(alignment: .leading, spacing: 10) {
                        NavigationLink(value: BookRoute(idOrSlug: first.bookSlug ?? bookId)) {
                            HStack(spacing: 10) {
                                CoverThumb(url: first.bookCoverUrl, width: 34, height: 50, radius: 4)
                                Text(first.bookTitle)
                                    .font(Theme.body(17, .semibold))
                                    .foregroundStyle(Theme.foreground)
                                Spacer()
                                Text("\(notes.count) note\(notes.count == 1 ? "" : "s")")
                                    .font(Theme.body(13))
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                        ForEach(notes) { note in
                            noteCard(note)
                        }
                    }
                }
            }
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
