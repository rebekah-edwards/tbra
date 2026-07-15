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
    @State private var buddyReadsOpen = false
    @State private var browseOpen = false
    @State private var adminOpen = false
    @State private var basedReaderOpen = false

    private struct WebItem { let label: String; let icon: String; let path: String }
    private let items: [WebItem] = [
        WebItem(label: "Import Your Library", icon: "tray.and.arrow.down", path: "/import"),
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
                basedReaderOpen = true
            } label: {
                menuRow(icon: "star.circle.fill", label: "Based Reader", tint: Theme.neonPurple)
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
        .fullScreenCover(isPresented: $basedReaderOpen) {
            NavigationStack {
                BasedReaderScreen()
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
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

// ── Based Reader — native pricing screen (2026-07-15) ──
// Mirrors the web /upgrade page: aurora backdrop, gradient wordmark, pricing
// cards ($4.99/mo · $39.99/yr), feature grid, roadmap. Checkout/portal URLs
// come from POST /api/v1/stripe and open in an IN-APP Safari sheet (user
// request: never kick out to the browser).

import SafariServices

struct SafariSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Theme.neonPurple)
        return vc
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

struct BasedReaderScreen: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.colorScheme) private var colorScheme
    @State private var breathe = false
    @State private var busy = false
    @State private var error: String?
    @State private var checkoutURL: URL?

    private var accountType: String {
        if case .signedIn(let u) = auth.phase { return u.accountType }
        return "reader"
    }
    private var isStaff: Bool { !["reader", "premium"].contains(accountType) }
    private var isSubscriber: Bool { accountType == "premium" }

    private let liveFeatures: [(icon: String, tint: Color, title: String, blurb: String)] = [
        ("bolt.fill", Theme.accent, "Unlimited Find My Next Read", "Mood-based book discovery with no limits. Free accounts get 3 searches a month."),
        ("books.vertical.fill", Theme.neonPurple, "Custom Shelves", "Create your own book lists beyond TBR, Reading, and Finished. Everyone keeps Top Shelf Reads."),
        ("heart.fill", Theme.neonBlue, "Buddy Reads", "Read together with friends and track your progress side by side."),
        ("note.text", Theme.neonPurple, "Notes to Self", "Leave a private note on any TBR book so future-you remembers why it's there."),
        ("checkmark.seal.fill", Theme.accent, "Ad-Free Forever", "tbr*a stays clean and distraction-free for Based Readers, always."),
    ]
    private let roadmap: [(icon: String, title: String, blurb: String)] = [
        ("person.2.fill", "Family Accounts", "Reader profiles for your kids — track their TBRs without mixing recommendations."),
        ("chart.line.uptrend.xyaxis", "Advanced Stats", "Deeper reading analytics, trends, and insights."),
        ("app.gift.fill", "Custom App Icons", "Alternative app icon designs to make tbr*a yours."),
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
                        Text("Become a")
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
                    Text(isSubscriber || isStaff
                         ? "You have access to everything below."
                         : "Every tool we build for readers who take their shelves seriously.")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 30)

                    HStack(spacing: 8) {
                        Text("Current plan").font(Theme.body(11)).foregroundStyle(Theme.muted)
                        Text(isSubscriber ? "Based Reader" : isStaff ? accountType.replacingOccurrences(of: "_", with: " ") : "Free Reader")
                            .font(Theme.body(11, .semibold))
                            .foregroundStyle(isSubscriber || isStaff ? Theme.neonPurple : Theme.muted)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background((isSubscriber || isStaff ? Theme.neonPurple.opacity(0.15) : Theme.surfaceAlt).opacity(1), in: Capsule())
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

                // ── Pricing ──
                if isSubscriber {
                    Button {
                        openBilling(action: "portal")
                    } label: {
                        Text(busy ? "Opening…" : "Manage subscription")
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(Theme.neonPurple)
                            .padding(.horizontal, 24).padding(.vertical, 12)
                            .background(Theme.neonPurple.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.neonPurple.opacity(0.4), lineWidth: 2))
                    }
                    .disabled(busy)
                    Text("Update payment, switch plans, or cancel anytime.")
                        .font(Theme.body(11)).foregroundStyle(Theme.muted).padding(.top, 8)
                } else {
                    HStack(spacing: 12) {
                        priceCard(price: "$4.99", per: "per month", cta: "Go monthly",
                                  note: "Billed monthly", plan: "monthly", highlight: false, badge: nil)
                        priceCard(price: "$39.99", per: "per year", cta: "Get the year",
                                  note: "That's $3.33 a month", plan: "annual", highlight: true, badge: "4 months free")
                    }
                    .padding(.horizontal, 20)
                    Text(isStaff
                         ? "Admin preview — this is what reader accounts see. Staff accounts can't subscribe."
                         : "Cancel anytime. Secure checkout by Stripe.")
                        .font(Theme.body(11)).foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .padding(.top, 10).padding(.horizontal, 30)
                }
                if let error {
                    Text(error).font(Theme.body(12)).foregroundStyle(Theme.destructive).padding(.top, 6)
                }

                // ── Features ──
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeading("Everything you unlock")
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

                // ── Trust ──
                VStack(spacing: 4) {
                    HStack(spacing: 5) {
                        Image(systemName: "lock.fill").font(.system(size: 10))
                        Text("Secure checkout by Stripe · Cancel anytime")
                    }
                    .font(Theme.body(11)).foregroundStyle(Theme.muted)
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
        .sheet(isPresented: Binding(
            get: { checkoutURL != nil },
            set: { if !$0 { checkoutURL = nil } }
        )) {
            if let checkoutURL {
                SafariSheet(url: checkoutURL).ignoresSafeArea()
            }
        }
    }

    private func priceCard(price: String, per: String, cta: String, note: String,
                           plan: String, highlight: Bool, badge: String?) -> some View {
        Button {
            openBilling(action: "checkout", plan: plan)
        } label: {
            VStack(spacing: 3) {
                Text(price).font(Theme.heading(30, .heavy)).foregroundStyle(Theme.foreground)
                Text(per).font(Theme.body(11)).foregroundStyle(Theme.muted)
                Text(busy ? "…" : cta)
                    .font(Theme.body(12, .bold))
                    .foregroundStyle(highlight ? .white : Theme.foreground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(highlight ? AnyShapeStyle(Theme.neonPurple) : AnyShapeStyle(Theme.surfaceAlt),
                                in: RoundedRectangle(cornerRadius: 10))
                    .padding(.top, 8)
                Text(note).font(Theme.body(9)).foregroundStyle(Theme.muted).padding(.top, 3)
            }
            .padding(.horizontal, 12).padding(.vertical, 16)
            .frame(maxWidth: .infinity)
            .background(highlight ? Theme.neonPurple.opacity(0.1) : Theme.surface.opacity(0.7),
                        in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18)
                .stroke(highlight ? Theme.neonPurple.opacity(0.6) : Theme.border, lineWidth: 2))
            .overlay(alignment: .top) {
                if let badge {
                    Text(badge)
                        .font(Theme.body(10, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 3)
                        .background(Theme.neonPurple, in: Capsule())
                        .offset(y: -10)
                }
            }
            .shadow(color: highlight ? Theme.neonPurple.opacity(0.25) : .clear, radius: 14)
        }
        .disabled(busy || isStaff)
    }

    private func openBilling(action: String, plan: String? = nil) {
        busy = true; error = nil
        Task {
            defer { busy = false }
            struct Res: Codable { let ok: Bool; let url: String? }
            var body: [String: Any] = ["action": action]
            if let plan { body["plan"] = plan }
            do {
                let res: Res = try await APIClient.shared.request("/api/v1/stripe", method: "POST", body: body)
                if let s = res.url, let url = URL(string: s) {
                    checkoutURL = url
                } else {
                    error = "Couldn't start checkout."
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Couldn't start checkout."
            }
        }
    }
}
