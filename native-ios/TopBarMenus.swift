import StoreKit
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

/// Screens the menu opens. On the iPhone Duo the shell presents them in its
/// chromed cover (side column + back) instead of the menu's own bare covers.
enum MenuScreen: String, Identifiable {
    case settings, findReaders, buddyReads, browse
    var id: String { rawValue }
}

struct HamburgerMenuSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @AppStorage("themeOverride") private var themeOverride = "dark"
    let onProfile: () -> Void
    /// Set by the shell in rail mode: hand the screen to the shell and close.
    var onOpenScreen: ((MenuScreen) -> Void)? = nil

    private func open(_ screen: MenuScreen) {
        if let onOpenScreen {
            onOpenScreen(screen)
            dismiss()
            return
        }
        switch screen {
        case .settings: settingsOpen = true
        case .findReaders: findReadersOpen = true
        case .buddyReads: buddyReadsOpen = true
        case .browse: browseOpen = true
        }
    }

    @State private var settingsOpen = false
    @State private var findReadersOpen = false
    @State private var buddyReadsOpen = false
    @State private var browseOpen = false
    @State private var adminOpen = false
    @State private var manageUsersOpen = false
    @State private var basedReaderOpen = false

    private struct WebItem { let label: String; let icon: String; let path: String }
    private let items: [WebItem] = [
        WebItem(label: "Import Your Library", icon: "tray.and.arrow.down", path: "/import"),
    ]

    private var user: PublicUser? {
        if case .signedIn(let u) = auth.phase { return u }
        return nil
    }

    /// Same tier set as the premium feature gates (staff preview included).
    private var isPremiumUser: Bool {
        ["premium", "beta_tester", "admin", "super_admin"].contains(user?.accountType ?? "")
    }

    var body: some View {
        Group {
            if DesignPreview.on { menuV2 } else { menuV1 }
        }
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
        .fullScreenCover(isPresented: $buddyReadsOpen) {
            NavigationStack {
                BuddyReadsView()
                    .appDestinations()
            }
        }
        .fullScreenCover(isPresented: $browseOpen) {
            NavigationStack {
                BrowseView()
                    .appDestinations()
            }
        }
        .fullScreenCover(isPresented: $adminOpen) {
            AdminSheet()
        }
        .fullScreenCover(isPresented: $manageUsersOpen) {
            AdminUsersSheet()
                .environment(\.shellBarInsets, (top: 0, bottom: 0))
                .environment(\.showsShellChrome, false)
                .globalReportOverlay()
        }
        .fullScreenCover(isPresented: $basedReaderOpen) {
            NavigationStack {
                BasedReaderScreen()
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
            .globalReportOverlay()
        }
    }

    // ── Refreshed menu (2026-11) ────────────────────────────────────────
    // Same destinations as v1, regrouped into cards on the ambient
    // backdrop: who you are, the membership, the places, then housekeeping.
    private var isAdmin: Bool { ["admin", "super_admin"].contains(user?.accountType ?? "") }

    private var avatarURL: URL? {
        guard let a = user?.avatarUrl else { return nil }
        return a.hasPrefix("/") ? URL(string: a, relativeTo: APIClient.baseURL) : URL(string: a)
    }

    private var menuV2: some View {
        ScrollView {
            VStack(spacing: 14) {
                // Who you are → Profile
                Button {
                    dismiss()
                    onProfile()
                } label: {
                    HStack(spacing: 14) {
                        CachedCoverImage(url: avatarURL) {
                            ZStack {
                                Theme.surfaceAlt
                                Image(systemName: "person.fill").foregroundStyle(Theme.muted)
                            }
                        }
                        .frame(width: 52, height: 52)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Theme.accent.opacity(0.8), lineWidth: 2))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(user?.displayName ?? "Reader")
                                .font(Theme.heading(20, .bold))
                                .foregroundStyle(Theme.foreground)
                            Text(user?.username.map { "@\($0)" } ?? user?.email ?? "")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Text("View profile")
                            .font(Theme.body(12, .semibold))
                            .foregroundStyle(Theme.neonBlue)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
                }

                // Membership
                Button { basedReaderOpen = true } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(
                                LinearGradient(colors: [Theme.neonPurple, Theme.neonBlue],
                                               startPoint: .topLeading, endPoint: .bottomTrailing),
                                in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(isPremiumUser ? "Based Reader Premium" : "Upgrade to Premium")
                                .font(Theme.body(15, .bold))
                                .foregroundStyle(Theme.foreground)
                            Text(isPremiumUser ? "Your membership and what's included"
                                               : "Custom shelves, buddy reads and more")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
                    }
                    .padding(14)
                    .background(
                        LinearGradient(colors: [Theme.neonPurple.opacity(0.16), Theme.neonBlue.opacity(0.10)],
                                       startPoint: .leading, endPoint: .trailing),
                        in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18)
                        .stroke(Theme.neonPurple.opacity(0.35), lineWidth: 1))
                }

                // Places
                menuCard {
                    cardRow("gearshape", "Settings", Theme.muted) { open(.settings) }
                    cardDivider
                    cardRow("person.2", "Find Readers", Theme.neonBlue) { open(.findReaders) }
                    cardDivider
                    cardRow("book.pages", "Buddy Reads", Theme.neonPurple) { open(.buddyReads) }
                    cardDivider
                    cardRow("books.vertical", "Browse All Books", Theme.accentDark) { open(.browse) }
                    ForEach(items, id: \.path) { item in
                        cardDivider
                        cardRow(item.icon, item.label, Color(hex: "fb923c"), external: true) {
                            if let url = URL(string: "https://thebasedreader.app\(item.path)") {
                                UIApplication.shared.open(url)
                            }
                        }
                    }
                }

                if isAdmin {
                    menuCard {
                        cardRow("wrench.and.screwdriver", "Admin", Theme.neonPurple) { adminOpen = true }
                        if user?.accountType == "super_admin" {
                            cardDivider
                            cardRow("person.crop.circle.badge.checkmark", "Manage Users", Theme.neonPurple) {
                                manageUsersOpen = true
                            }
                        }
                    }
                }

                // Housekeeping
                menuCard {
                    HStack(spacing: 12) {
                        rowIcon("circle.lefthalf.filled", Theme.muted)
                        Text("Theme").font(Theme.body(15, .medium)).foregroundStyle(Theme.foreground)
                        Spacer()
                        Picker("", selection: $themeOverride) {
                            Text("Dark").tag("dark")
                            Text("Light").tag("light")
                            Text("Auto").tag("system")
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 170)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    cardDivider
                    cardRow("envelope", "Contact Us", Theme.muted, external: true) {
                        if let url = URL(string: "mailto:hello@thebasedreader.app") {
                            UIApplication.shared.open(url)
                        }
                    }
                }

                Button {
                    dismiss()
                    Task { await auth.logout() }
                } label: {
                    Text("Sign Out")
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.destructive)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.destructive.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 32)
        }
        .background(AmbientBackground())
    }

    private func menuCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(Theme.surface.opacity(0.75), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.border.opacity(0.7), lineWidth: 1))
    }

    private var cardDivider: some View {
        Rectangle().fill(Theme.border.opacity(0.6)).frame(height: 1).padding(.leading, 58)
    }

    private func rowIcon(_ icon: String, _ tint: Color) -> some View {
        Image(systemName: icon)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: 32, height: 32)
            .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))
    }

    private func cardRow(_ icon: String, _ label: String, _ tint: Color, external: Bool = false,
                         action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                rowIcon(icon, tint)
                Text(label).font(Theme.body(15, .medium)).foregroundStyle(Theme.foreground)
                Spacer()
                Image(systemName: external ? "arrow.up.right" : "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.muted.opacity(0.7))
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
    }

    private var menuV1: some View {
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
                basedReaderOpen = true
            } label: {
                // Plan-aware label (web hamburger mirrors this): free accounts
                // get an explicit upsell, members see their tier name.
                menuRow(icon: "star.circle.fill",
                        label: isPremiumUser ? "Based Reader Premium" : "Upgrade to Premium",
                        tint: Theme.neonPurple)
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

            Button {
                buddyReadsOpen = true
            } label: {
                menuRow(icon: "book.pages", label: "Buddy Reads")
            }

            Button {
                browseOpen = true
            } label: {
                menuRow(icon: "books.vertical", label: "Browse All Books")
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

            // Contact Us — straight into a pre-addressed email, no browser
            // (user request 2026-07-15).
            Button {
                if let url = URL(string: "mailto:hello@thebasedreader.app") {
                    UIApplication.shared.open(url)
                }
            } label: {
                menuRow(icon: "envelope", label: "Contact Us")
            }

            // Admin — only for admin accounts, like the web menu. Opens the
            // real /admin dashboards in an authenticated in-app browser.
            if let user, ["admin", "super_admin"].contains(user.accountType) {
                Button {
                    adminOpen = true
                } label: {
                    menuRow(icon: "wrench.and.screwdriver", label: "Admin", tint: Theme.neonPurple)
                }
                // Native user management (super-admin only, like /admin/users).
                if user.accountType == "super_admin" {
                    Button {
                        manageUsersOpen = true
                    } label: {
                        menuRow(icon: "person.crop.circle.badge.checkmark", label: "Manage Users", tint: Theme.neonPurple)
                    }
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

// ── Based Reader — membership screen ──
// Hero, plans, what's included, roadmap. Since 2026-11 the plans are Apple
// In-App Purchase subscriptions (see Store.swift): App Review rejects an
// external checkout, so the Stripe sheet that used to open here is gone.
// Apple also requires this screen to show each plan's price and period, a
// Restore Purchases button, and links to the Terms of Use and Privacy Policy.

struct BasedReaderScreen: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.colorScheme) private var colorScheme
    @State private var breathe = false
    @State private var store = StoreModel.shared
    /// The plan the lime button will buy. Yearly first: it is the better deal.
    @State private var selectedPlan = StoreModel.yearlyID
    @State private var manageOpen = false

    private var userId: String? {
        if case .signedIn(let u) = auth.phase { return u.id }
        return nil
    }

    private var accountType: String {
        if case .signedIn(let u) = auth.phase { return u.accountType }
        return "reader"
    }
    // Front-end parity rule (2026-07-22): beta testers are full members —
    // indistinguishable from paying Based Readers. Only admin/super_admin
    // count as staff (pricing preview + staff plan chip, i.e. Rebekah).
    private var isMember: Bool { ["premium", "beta_tester", "admin", "super_admin"].contains(accountType) }
    private var isAdminStaff: Bool { ["admin", "super_admin"].contains(accountType) }
    private var isSubscriber: Bool { accountType == "premium" }
    private var isBeta: Bool { accountType == "beta_tester" }

    private let liveFeatures: [(icon: String, tint: Color, title: String, blurb: String)] = [
        ("bolt.fill", Theme.accent, "Unlimited Find My Next Read", "Mood-based book discovery with no limits. Free accounts get 3 searches a month."),
        ("books.vertical.fill", Theme.neonPurple, "Custom Shelves", "Create your own book lists beyond TBR, Reading, and Finished. Everyone keeps Top Shelf Reads."),
        ("heart.fill", Theme.neonBlue, "Buddy Reads", "Read together with friends and track your progress side by side."),
        ("note.text", Theme.neonPurple, "Notes to Self", "Leave a private note on any TBR book so future-you remembers why it's there."),
        ("arrow.down.doc.fill", Theme.neonBlue, "Full Data Export", "Download your entire library — shelves, ratings, reviews — as JSON anytime. CSV stays free for everyone."),
        ("checkmark.seal.fill", Theme.accent, "Ad-Free Forever", "tbr*a stays clean and distraction-free for Based Readers, always."),
    ]
    private let roadmap: [(icon: String, title: String, blurb: String)] = [
        ("person.2.fill", "Family Accounts", "Reader profiles for your kids — track their TBRs without mixing recommendations."),
        ("chart.line.uptrend.xyaxis", "Advanced Stats", "Deeper reading analytics, trends, and insights."),
        ("paintbrush.fill", "Custom Themes", "Full looks for the app — fonts, colors, everything — not just a font swap."),
        ("app.gift.fill", "Custom App Icons", "Alternative app icon designs to make tbr*a yours."),
        ("trophy.fill", "Reading Challenges", "Structured challenges with perks and discounts from book-loving partners."),
        ("text.bubble.fill", "AI Book Discovery Chat", "Describe exactly what you want — \"cozy fantasy, no romance, under 300 pages\" — and get real matches."),
    ]

    var body: some View {
        let isLight = colorScheme == .light
        ScrollView {
            VStack(spacing: 0) {
                // ── Hero ──
                VStack(spacing: 12) {
                    HStack(spacing: 5) {
                        Image(systemName: "star.fill").font(.system(size: 9))
                        Text("PREMIUM").font(Theme.body(11, .bold)).kerning(1.6)
                    }
                    .foregroundStyle(Theme.neonPurple)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Theme.neonPurple.opacity(0.1), in: Capsule())
                    .overlay(Capsule().stroke(Theme.neonPurple.opacity(0.3), lineWidth: 1))

                    VStack(spacing: 2) {
                        Text(isMember ? "You're a" : "Become a")
                            .font(Theme.heading(34, .heavy))
                            .foregroundStyle(Theme.foreground)
                        Text("Based Reader")
                            .font(Theme.heading(34, .heavy))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: isLight
                                        ? [Color(hex: "7c3aed"), Color(hex: "2563eb"), Color(hex: "4d7c0f")]
                                        : [Color(hex: "c084fc"), Color(hex: "60a5fa"), Color(hex: "a3e635")],
                                    startPoint: .leading, endPoint: .trailing)
                            )
                    }
                    Text(isMember
                         ? "Every Based Reader benefit below is active on your account."
                         : "Every tool we build for readers who take their shelves seriously.")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 30)

                    HStack(spacing: 8) {
                        Text("Current plan").font(Theme.body(11)).foregroundStyle(Theme.muted)
                        Text(isAdminStaff ? accountType.replacingOccurrences(of: "_", with: " ") : isMember ? "Based Reader" : "Free Reader")
                            .font(Theme.body(11, .semibold))
                            .foregroundStyle(isMember ? Theme.neonPurple : Theme.muted)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background((isMember ? Theme.neonPurple.opacity(0.15) : Theme.surfaceAlt).opacity(1), in: Capsule())
                    }
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(Theme.surface.opacity(0.7), in: Capsule())
                    .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 64)
                .padding(.bottom, 28)
                .background {
                    // Aurora — purple-led, breathing (web .upgrade-aurora)
                    ZStack {
                        Ellipse().fill(RadialGradient(colors: [Theme.neonPurple.opacity(isLight ? 0.13 : 0.18), .clear], center: .center, startRadius: 0, endRadius: 240))
                            .frame(width: 480, height: 340).offset(x: -80, y: -60)
                        Ellipse().fill(RadialGradient(colors: [Theme.neonBlue.opacity(isLight ? 0.10 : 0.13), .clear], center: .center, startRadius: 0, endRadius: 190))
                            .frame(width: 380, height: 280).offset(x: 120, y: -20)
                        Ellipse().fill(RadialGradient(colors: [Theme.accent.opacity(0.07), .clear], center: .center, startRadius: 0, endRadius: 160))
                            .frame(width: 320, height: 240).offset(x: 30, y: 90)
                    }
                    .opacity(breathe ? 1.0 : 0.6)
                    .scaleEffect(breathe ? 1.05 : 1.0)
                    .allowsHitTesting(false)
                }

                // ── Plans ──
                if isSubscriber {
                    subscriberCard
                } else if isBeta {
                    // Member without a subscription: nothing to bill or
                    // manage — just confirm the membership.
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill").font(.system(size: 12))
                        Text("Based Reader — included with your account")
                            .font(Theme.body(14, .semibold))
                    }
                    .foregroundStyle(Theme.neonPurple)
                    .padding(.horizontal, 22).padding(.vertical, 12)
                    .background(Theme.neonPurple.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.neonPurple.opacity(0.4), lineWidth: 2))
                } else {
                    plansSection
                }

                // ── Features ──
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeading(isMember ? "Included in your membership" : "Everything you unlock")
                    ForEach(liveFeatures, id: \.title) { f in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: f.icon)
                                .font(.system(size: 15))
                                .foregroundStyle(f.tint)
                                .frame(width: 40, height: 40)
                                .background(f.tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.title).font(Theme.body(14, .semibold)).foregroundStyle(Theme.foreground)
                                Text(f.blurb).font(Theme.body(12)).foregroundStyle(Theme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(13)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface.opacity(0.7), in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
                    }
                }
                .padding(.horizontal, 20).padding(.top, 36)

                // ── Roadmap ──
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeading("On the roadmap")
                    ForEach(roadmap, id: \.title) { f in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: f.icon)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.muted.opacity(0.7))
                                .frame(width: 36, height: 36)
                                .background(Theme.surfaceAlt, in: RoundedRectangle(cornerRadius: 11))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.title).font(Theme.body(13, .semibold)).foregroundStyle(Theme.foreground.opacity(0.8))
                                Text(f.blurb).font(Theme.body(12)).foregroundStyle(Theme.muted.opacity(0.8))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer()
                            Text("Soon")
                                .font(Theme.body(10, .semibold)).foregroundStyle(Theme.muted)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Theme.surfaceAlt, in: Capsule())
                        }
                        .padding(13)
                        .background(Theme.surface.opacity(0.4), in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16)
                            .stroke(Theme.border.opacity(0.8), style: StrokeStyle(lineWidth: 1, dash: [5])))
                    }
                }
                .padding(.horizontal, 20).padding(.top, 30)

                // ── Fine print ──
                VStack(spacing: 8) {
                    Text("[Terms of Use](https://thebasedreader.app/terms)  ·  [Privacy Policy](https://thebasedreader.app/privacy)")
                        .font(Theme.body(12, .medium))
                        .tint(Theme.neonBlue)
                    if let mail = URL(string: "mailto:hello@thebasedreader.app") {
                        Link("Questions? hello@thebasedreader.app", destination: mail)
                            .font(Theme.body(11, .medium)).foregroundStyle(Theme.neonBlue)
                    }
                }
                .padding(.top, 28).padding(.bottom, 46)
            }
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            withAnimation(.easeInOut(duration: 7).repeatForever(autoreverses: true)) { breathe = true }
        }
        .task {
            if !store.loaded { await store.loadProducts() }
            await store.refreshEntitlement()
        }
        .manageSubscriptionsSheet(isPresented: $manageOpen)
        .onChange(of: manageOpen) { was, now in
            // The sheet may have cancelled or switched the plan.
            if was && !now { Task { await store.refreshEntitlement(); await auth.refreshUser() } }
        }
    }

    // ── Plans (free readers, and the staff preview) ──
    /// What a plan row shows. Built from the StoreKit `Product`, so prices
    /// and currency are always Apple's for the reader's storefront.
    private struct PlanDisplay: Identifiable {
        let id: String
        let title: String
        let price: String
        let period: String      // "year" | "month"
        let detail: String
        let badge: String?
    }

    private var plans: [PlanDisplay] {
        var out: [PlanDisplay] = []
        if let yearly = store.yearly {
            let perMonth = (yearly.price / 12).formatted(yearly.priceFormatStyle)
            out.append(PlanDisplay(id: yearly.id, title: "Yearly", price: yearly.displayPrice, period: "year",
                                   detail: "That's \(perMonth) a month",
                                   badge: store.yearlySavingsPercent.map { "Save \($0)%" }))
        }
        if let monthly = store.monthly {
            out.append(PlanDisplay(id: monthly.id, title: "Monthly", price: monthly.displayPrice, period: "month",
                                   detail: "Billed every month", badge: nil))
        }
        #if DEBUG && targetEnvironment(simulator)
        // Layout review only (SIMCTL_CHILD_TBRA_DEBUG_PLANS=1): the simulator
        // has no App Store products unless Xcode injects a StoreKit file, so
        // stand-in rows let the screen be checked and screenshotted. The
        // Subscribe button does nothing in this mode. Never in a device build.
        if out.isEmpty, ProcessInfo.processInfo.environment["TBRA_DEBUG_PLANS"] != nil {
            return [
                PlanDisplay(id: StoreModel.yearlyID, title: "Yearly", price: "$39.99", period: "year",
                            detail: "That's $3.33 a month", badge: "Save 33%"),
                PlanDisplay(id: StoreModel.monthlyID, title: "Monthly", price: "$4.99", period: "month",
                            detail: "Billed every month", badge: nil),
            ]
        }
        #endif
        return out
    }

    private var selectedPlanDisplay: PlanDisplay? {
        plans.first { $0.id == selectedPlan } ?? plans.first
    }

    private func product(for plan: PlanDisplay) -> Product? {
        plan.id == StoreModel.yearlyID ? store.yearly : store.monthly
    }

    private var plansSection: some View {
        VStack(spacing: 12) {
            if plans.isEmpty {
                if store.loaded {
                    VStack(spacing: 8) {
                        Text("Plans aren't available right now.")
                            .font(Theme.body(14, .semibold)).foregroundStyle(Theme.foreground)
                        Button("Try again") { Task { await store.loadProducts() } }
                            .font(Theme.body(14, .medium)).foregroundStyle(Theme.neonBlue)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
                } else {
                    ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.vertical, 30)
                }
            } else {
                VStack(spacing: 10) {
                    ForEach(plans) { plan in planRow(plan) }
                }

                if let plan = selectedPlanDisplay {
                    let priceLine = "\(plan.price) per \(plan.period)"
                    Button {
                        guard let userId, let product = product(for: plan) else { return }
                        Task {
                            if await store.purchase(product, userId: userId) { await auth.refreshUser() }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if store.working == plan.id { ProgressView().tint(Theme.onAccent) }
                            Text("Subscribe · \(priceLine)")
                                .font(Theme.body(16, .bold))
                        }
                        .foregroundStyle(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Theme.accent, in: Capsule())
                    }
                    .disabled(store.working != nil || isAdminStaff)
                    .opacity(isAdminStaff ? 0.5 : 1)
                    .padding(.top, 4)

                    // Apple 3.1.2: state the price, the period and that it renews.
                    Text(isAdminStaff
                         ? "Admin preview — this is what reader accounts see. Staff accounts can't subscribe."
                         : "\(priceLine), billed to your Apple Account. Renews automatically until you cancel, at least 24 hours before the period ends, in your Apple Account settings.")
                        .font(Theme.body(11)).foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { if await store.restore() { await auth.refreshUser() } }
                } label: {
                    Text(store.working == "restore" ? "Restoring…" : "Restore Purchases")
                        .font(Theme.body(14, .semibold))
                        .foregroundStyle(Theme.neonBlue)
                        .padding(.vertical, 6)
                }
                .disabled(store.working != nil)

                // Apple 3.1.2: the EULA and privacy policy must be reachable
                // from the purchase screen itself, not only further down.
                Text("[Terms of Use](https://thebasedreader.app/terms)  ·  [Privacy Policy](https://thebasedreader.app/privacy)")
                    .font(Theme.body(12, .medium))
                    .tint(Theme.neonBlue)
            }
            if let error = store.error {
                Text(error).font(Theme.body(12)).foregroundStyle(Theme.destructive)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 20)
    }

    /// One selectable plan: neutral glass, lime ring and check when chosen.
    private func planRow(_ plan: PlanDisplay) -> some View {
        let chosen = selectedPlanDisplay?.id == plan.id
        return Button { selectedPlan = plan.id } label: {
            HStack(spacing: 12) {
                Image(systemName: chosen ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(chosen ? Theme.accentText : Theme.muted.opacity(0.6))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(plan.title).font(Theme.body(16, .bold)).foregroundStyle(Theme.foreground)
                        if let badge = plan.badge {
                            Text(badge)
                                .font(Theme.body(10, .bold))
                                .foregroundStyle(Theme.onAccent)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Theme.accent, in: Capsule())
                        }
                    }
                    Text(plan.detail).font(Theme.body(12)).foregroundStyle(Theme.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text(plan.price)
                        .font(Theme.heading(20, .heavy)).foregroundStyle(Theme.foreground)
                    Text("per \(plan.period)")
                        .font(Theme.body(11)).foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 14)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18)
                .stroke(chosen ? Theme.accent : Theme.border.opacity(0.6), lineWidth: chosen ? 2 : 1))
            .contentShape(RoundedRectangle(cornerRadius: 18))
        }
        .accessibilityLabel("\(plan.title), \(plan.price) per \(plan.period)\(chosen ? ", selected" : "")")
    }

    // ── Paying member ──
    private var subscriberCard: some View {
        VStack(spacing: 10) {
            if store.activeProductID != nil {
                Button { manageOpen = true } label: {
                    Text("Manage subscription")
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.foreground)
                        .padding(.horizontal, 24).padding(.vertical, 12)
                        .glassEffect(.regular, in: Capsule())
                }
                Text("Switch plans or cancel anytime. Billed to your Apple Account.")
                    .font(Theme.body(11)).foregroundStyle(Theme.muted)
            } else {
                // Premium, but not through an Apple purchase on this Apple
                // Account: a website subscription, or bought on another one.
                Text("Your membership is active.")
                    .font(Theme.body(15, .semibold)).foregroundStyle(Theme.foreground)
                Text("It isn't billed through this Apple Account. If you subscribed on thebasedreader.app, manage it there.")
                    .font(Theme.body(12)).foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { if await store.restore() { await auth.refreshUser() } }
                } label: {
                    Text(store.working == "restore" ? "Restoring…" : "Restore Purchases")
                        .font(Theme.body(13, .semibold)).foregroundStyle(Theme.neonBlue)
                }
                .disabled(store.working != nil)
            }
        }
        .padding(.horizontal, 30)
    }
}
