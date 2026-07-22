import SwiftUI

// ── Admin › Manage Users — native twin of /admin/users (2026-07-22) ──
// Lists every account (newest first) with the TRUE account tier (admin
// surfaces keep the beta/premium delineation the public badge deliberately
// hides), changes account types via a native menu, and follows people
// straight from the list. Talks to PRODUCTION via APIClient.adminBaseURL —
// account upgrades must land on the live DB, not the Mac's dev copy.

struct AdminUserRow: Codable, Identifiable {
    let id: String
    let email: String
    let displayName: String?
    let username: String?
    let avatarUrl: String?
    var accountType: String
    let createdAt: String
    var isFollowing: Bool
}

private let ACCOUNT_TYPE_OPTIONS: [(value: String, label: String)] = [
    ("reader", "Reader"),
    ("premium", "Based Reader (Premium)"),
    ("beta_tester", "Beta Tester"),
    ("admin", "Admin"),
    ("super_admin", "Super Admin"),
]

@MainActor
@Observable
final class AdminUsersModel {
    var rows: [AdminUserRow] = []
    var loaded = false
    var loadError: String?
    var search = ""
    var pendingId: String?
    var feedback: (id: String, text: String, ok: Bool)?

    struct ListRes: Codable { let ok: Bool; let users: [AdminUserRow] }
    struct TypeRes: Codable { let ok: Bool; let accountType: String }
    struct FollowRes: Codable { let ok: Bool; let following: Bool }

    var filtered: [AdminUserRow] {
        guard !search.isEmpty else { return rows }
        let q = search.lowercased()
        return rows.filter {
            $0.email.lowercased().contains(q)
                || ($0.displayName?.lowercased().contains(q) ?? false)
                || ($0.username?.lowercased().contains(q) ?? false)
        }
    }

    func load() async {
        do {
            let res: ListRes = try await APIClient.shared.adminGet("/api/v1/admin/users")
            rows = res.users
            loadError = nil
        } catch {
            loadError = "Couldn't load users — check your connection."
        }
        loaded = true
    }

    func setType(_ row: AdminUserRow, _ newType: String) async {
        guard newType != row.accountType else { return }
        pendingId = row.id
        defer { pendingId = nil }
        do {
            let _: TypeRes = try await APIClient.shared.adminRequest(
                "/api/v1/admin/users/\(row.id)", method: "PATCH",
                body: ["accountType": newType])
            if let i = rows.firstIndex(where: { $0.id == row.id }) {
                rows[i].accountType = newType
            }
            flash(row.id, "Updated", ok: true)
        } catch {
            flash(row.id, (error as? APIError).flatMap(Self.message) ?? "Failed", ok: false)
        }
    }

    func toggleFollow(_ row: AdminUserRow) async {
        guard let i = rows.firstIndex(where: { $0.id == row.id }) else { return }
        let target = !rows[i].isFollowing
        rows[i].isFollowing = target // optimistic
        do {
            let _: FollowRes = try await APIClient.shared.adminRequest(
                "/api/v1/admin/users/\(row.id)", method: "PATCH",
                body: ["follow": target])
        } catch {
            if let j = rows.firstIndex(where: { $0.id == row.id }) {
                rows[j].isFollowing = !target
            }
            flash(row.id, "Follow failed", ok: false)
        }
    }

    private func flash(_ id: String, _ text: String, ok: Bool) {
        feedback = (id, text, ok)
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            if self?.feedback?.id == id { self?.feedback = nil }
        }
    }

    private static func message(_ e: APIError) -> String? {
        if case .server(_, let m) = e { return m }
        return nil
    }
}

struct AdminUsersSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var model = AdminUsersModel()

    private var selfId: String? {
        if case .signedIn(let u) = auth.phase { return u.id }
        return nil
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Text("Manage Users")
                        .font(Theme.heading(17, .bold))
                        .foregroundStyle(Theme.foreground)
                    Spacer()
                    Button { dismiss() } label: {
                        Text("Done")
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(Theme.neonBlue)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Theme.bg)

                Divider().background(Theme.border.opacity(0.6))

                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        TextField("Search users…", text: Bindable(model).search)
                            .font(Theme.body(15))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))

                        if let err = model.loadError {
                            VStack(spacing: 10) {
                                Text(err).font(Theme.body(14)).foregroundStyle(Theme.muted)
                                Button("Retry") { Task { await model.load() } }
                                    .font(Theme.body(14, .semibold))
                                    .foregroundStyle(Theme.accentText)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 60)
                        } else if !model.loaded {
                            ProgressView().tint(Theme.accent)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 80)
                        } else {
                            Text("\(model.filtered.count) user\(model.filtered.count == 1 ? "" : "s")")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted)

                            LazyVStack(spacing: 10) {
                                ForEach(model.filtered) { row in
                                    userCard(row)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 14)
                    .padding(.bottom, 40)
                }
            }
            .background(Theme.bg)
            .appDestinations()
        }
        .task { await model.load() }
    }

    // MARK: Row

    @ViewBuilder
    private func userCard(_ row: AdminUserRow) -> some View {
        let isSelf = row.id == selfId
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                avatar(row)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        if let username = row.username {
                            NavigationLink(value: UserRoute(username: username)) {
                                Text(row.displayName ?? row.email.components(separatedBy: "@").first ?? "Reader")
                                    .font(Theme.body(15, .semibold))
                                    .foregroundStyle(Theme.foreground)
                                    .lineLimit(1)
                            }
                        } else {
                            Text(row.displayName ?? row.email.components(separatedBy: "@").first ?? "Reader")
                                .font(Theme.body(15, .semibold))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                        }
                        if isSelf {
                            Text("(you)").font(Theme.body(11)).foregroundStyle(Theme.muted)
                        }
                    }
                    Text(row.email)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        if let username = row.username {
                            Text("@\(username)")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted.opacity(0.75))
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Text("Joined \(joined(row.createdAt))")
                            .font(Theme.body(11))
                            .foregroundStyle(Theme.muted.opacity(0.6))
                            .fixedSize()
                    }
                }
                Spacer(minLength: 0)
                // TRUE tier — this screen is the delineation the public
                // badge hides (beta testers read as Based Readers there).
                trueBadge(row.accountType)
            }

            HStack(spacing: 10) {
                if !isSelf {
                    Button {
                        Task { await model.toggleFollow(row) }
                    } label: {
                        Text(row.isFollowing ? "Following" : "Follow")
                            .font(Theme.body(13, .semibold))
                            .foregroundStyle(row.isFollowing ? Theme.accentText : .black)
                            .padding(.horizontal, 16).padding(.vertical, 7)
                            .background(row.isFollowing ? Theme.accent.opacity(0.15) : Theme.accent, in: Capsule())
                            .overlay(Capsule().stroke(Theme.accent.opacity(row.isFollowing ? 0.5 : 1), lineWidth: 1))
                    }

                    Menu {
                        ForEach(ACCOUNT_TYPE_OPTIONS, id: \.value) { opt in
                            Button {
                                Task { await model.setType(row, opt.value) }
                            } label: {
                                if opt.value == row.accountType {
                                    Label(opt.label, systemImage: "checkmark")
                                } else {
                                    Text(opt.label)
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Text(typeLabel(row.accountType))
                                .font(Theme.body(13, .medium))
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 9, weight: .semibold))
                        }
                        .foregroundStyle(Theme.foreground)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.surfaceAlt.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
                    }
                    .disabled(model.pendingId == row.id)
                }
                Spacer()
                if let fb = model.feedback, fb.id == row.id {
                    Text(fb.text)
                        .font(Theme.body(11, .semibold))
                        .foregroundStyle(fb.ok ? Theme.accentText : Theme.destructive)
                }
                if model.pendingId == row.id {
                    ProgressView().controlSize(.small).tint(Theme.accent)
                }
            }
        }
        .padding(12)
        .background(Theme.surface.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
    }

    private func avatar(_ row: AdminUserRow) -> some View {
        Group {
            if let avatarUrl = row.avatarUrl,
               let url = avatarUrl.hasPrefix("/")
                   ? URL(string: avatarUrl, relativeTo: APIClient.adminBaseURL)
                   : URL(string: avatarUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.accent }
            } else {
                ZStack {
                    Theme.accent
                    Text(String((row.displayName ?? row.email).prefix(1)).uppercased())
                        .font(Theme.heading(16, .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .frame(width: 42, height: 42)
        .clipShape(Circle())
    }

    private func trueBadge(_ type: String) -> some View {
        let label = typeLabel(type)
        let isPurple = ["super_admin", "admin", "premium"].contains(type)
        let tint = isPurple ? Theme.neonPurple : Theme.accent
        return Text(label)
            .font(Theme.body(10, .semibold))
            .foregroundStyle(isPurple ? Theme.neonPurple : Theme.accentText)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().stroke(tint.opacity(0.5), lineWidth: 1))
    }

    private func typeLabel(_ type: String) -> String {
        switch type {
        case "reader": return "Reader"
        case "premium": return "Based Reader"
        case "beta_tester": return "Beta Tester"
        case "admin": return "Admin"
        case "super_admin": return "Super Admin"
        default: return type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func joined(_ createdAt: String) -> String {
        // "2026-07-21 21:20:59" → "Jul 2026"
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        f.timeZone = TimeZone(identifier: "UTC")
        guard let date = f.date(from: createdAt) else { return String(createdAt.prefix(7)) }
        let out = DateFormatter()
        out.dateFormat = "MMM yyyy"
        return out.string(from: date)
    }
}
