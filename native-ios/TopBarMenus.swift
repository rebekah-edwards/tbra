import SwiftUI

// The top bar's two remaining controls, recreated from the web nav:
// the notifications bell (notification-bell.tsx: latest 20, unread dot,
// tap-to-mark-read + linkUrl routing, Mark all read) and the hamburger
// menu (hamburger-menu.tsx: Profile, Settings, Find Readers, Buddy
// Reads, Browse All Books, Import Your Library, Contact Us, Theme,
// Sign Out). Pages that aren't native yet open the live site.

struct AppNotification: Codable, Hashable, Identifiable {
    let id: String
    let type: String
    let title: String
    let message: String
    let linkUrl: String?
    let read: Bool
    let createdAt: String
}

// ── Notifications ──

@MainActor
@Observable
final class NotificationsModel {
    var items: [AppNotification] = []
    var loaded = false

    var unreadCount: Int { items.filter { !$0.read }.count }

    func load() async {
        struct Res: Codable { let ok: Bool; let notifications: [AppNotification] }
        if let res: Res = try? await APIClient.shared.get("/api/v1/notifications") {
            items = res.notifications
            loaded = true
        }
    }

    func markRead(_ id: String) async {
        struct Body: Codable, Sendable { let id: String }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request("/api/v1/notifications", method: "PATCH", json: Body(id: id))
        if let i = items.firstIndex(where: { $0.id == id }) {
            items[i] = AppNotification(id: items[i].id, type: items[i].type, title: items[i].title,
                                       message: items[i].message, linkUrl: items[i].linkUrl,
                                       read: true, createdAt: items[i].createdAt)
        }
    }

    func markAllRead() async {
        struct Body: Codable, Sendable { let markAllRead: Bool }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request("/api/v1/notifications", method: "PATCH", json: Body(markAllRead: true))
        await load()
    }
}

struct NotificationsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let model: NotificationsModel
    /// Routes a tapped notification's in-app link (e.g. /book/<slug>).
    let onOpenBook: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Notifications")
                    .font(Theme.heading(20, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                if model.unreadCount > 0 {
                    Button("Mark all read") {
                        Task { await model.markAllRead() }
                    }
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(Theme.neonBlue)
                }
            }
            .padding(20)

            if model.items.isEmpty {
                Spacer()
                Text(model.loaded ? "You're all caught up." : "Loading…")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(model.items) { item in
                            Button {
                                Task { await model.markRead(item.id) }
                                if let link = item.linkUrl {
                                    if link.hasPrefix("/book/") {
                                        dismiss()
                                        onOpenBook(String(link.dropFirst("/book/".count)))
                                    } else if let url = URL(string: "https://thebasedreader.app\(link)") {
                                        UIApplication.shared.open(url)
                                    }
                                }
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Circle()
                                        .fill(item.read ? Color.clear : Theme.accent)
                                        .frame(width: 8, height: 8)
                                        .padding(.top, 6)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(item.title)
                                            .font(Theme.body(15, item.read ? .regular : .semibold))
                                            .foregroundStyle(Theme.foreground)
                                            .multilineTextAlignment(.leading)
                                        Text(item.message)
                                            .font(Theme.body(13))
                                            .foregroundStyle(Theme.muted)
                                            .multilineTextAlignment(.leading)
                                            .lineLimit(3)
                                        Text(DateFmt.display(item.createdAt, precision: nil))
                                            .font(Theme.body(11))
                                            .foregroundStyle(Theme.muted.opacity(0.7))
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal, 20).padding(.vertical, 12)
                            }
                            Divider().background(Theme.border.opacity(0.4))
                        }
                    }
                }
            }
        }
        .background(Theme.bg)
        .task { await model.load() }
    }
}

// ── Hamburger menu ──

struct HamburgerMenuSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @AppStorage("themeOverride") private var themeOverride = "dark"
    let onProfile: () -> Void

    @State private var settingsOpen = false
    @State private var findReadersOpen = false

    private struct WebItem { let label: String; let icon: String; let path: String }
    private let items: [WebItem] = [
        WebItem(label: "Buddy Reads", icon: "book.pages", path: "/buddy-reads"),
        WebItem(label: "Browse All Books", icon: "books.vertical", path: "/browse"),
        WebItem(label: "Import Your Library", icon: "tray.and.arrow.down", path: "/import"),
        WebItem(label: "Contact Us", icon: "envelope", path: "/contact"),
    ]

    private var user: PublicUser? {
        if case .signedIn(let u) = auth.phase { return u }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // User card
            VStack(alignment: .leading, spacing: 2) {
                Text(user?.displayName ?? "Reader")
                    .font(Theme.body(16, .semibold))
                    .foregroundStyle(Theme.foreground)
                if let email = user?.email {
                    Text(email)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(20)
            Divider().background(Theme.border.opacity(0.6))

            Button {
                dismiss()
                onProfile()
            } label: {
                menuRow(icon: "person.crop.circle", label: "Profile")
            }

            Button {
                settingsOpen = true
            } label: {
                menuRow(icon: "gearshape", label: "Settings")
            }

            Button {
                findReadersOpen = true
            } label: {
                menuRow(icon: "person.2", label: "Find Readers")
            }

            ForEach(items, id: \.path) { item in
                Button {
                    if let url = URL(string: "https://thebasedreader.app\(item.path)") {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    menuRow(icon: item.icon, label: item.label)
                }
            }

            Divider().background(Theme.border.opacity(0.6)).padding(.vertical, 4)

            // Theme row — native equivalent of the web ThemeToggle
            HStack {
                Image(systemName: "circle.lefthalf.filled")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 26)
                Text("Theme")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Picker("", selection: $themeOverride) {
                    Text("Dark").tag("dark")
                    Text("Light").tag("light")
                    Text("Auto").tag("system")
                }
                .pickerStyle(.segmented)
                .frame(width: 180)
            }
            .padding(.horizontal, 20).padding(.vertical, 10)

            Button {
                dismiss()
                Task { await auth.logout() }
            } label: {
                menuRow(icon: "rectangle.portrait.and.arrow.right", label: "Sign Out", tint: Theme.destructive)
            }

            Spacer()
        }
        .background(Theme.bg)
        .fullScreenCover(isPresented: $settingsOpen) {
            NavigationStack {
                SettingsView()
                    .appDestinations()
            }
        }
        .fullScreenCover(isPresented: $findReadersOpen) {
            NavigationStack {
                FindReadersView()
                    .appDestinations()
            }
        }
    }

    private func menuRow(icon: String, label: String, tint: Color = Theme.foreground) -> some View {
        HStack(spacing: 0) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(tint == Theme.foreground ? Theme.muted : tint)
                .frame(width: 26)
            Text(label)
                .font(Theme.body(15))
                .foregroundStyle(tint)
            Spacer()
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }
}
