import SwiftUI

// "What's New" — a one-time note after updating to a build that has one.
//
// TestFlight's "What to Test" text reaches testers only, and only if they
// open the TestFlight app. This puts the same note in front of every reader
// (App Store installs included) the first time they open an updated build.
//
// The WORDING LIVES ON THE SERVER (src/lib/whats-new.ts, served by
// GET /api/v1/whats-new?build=<n>) so it can be corrected, or added for a
// build that already shipped, without another App Store round trip.
//
// RULES
//  • Once per note: the device remembers the newest note build it has shown
//    (`whatsNewSeenBuild`). A note shows when its build is newer than that.
//  • Never on a fresh install. Someone who has just downloaded the app has
//    nothing to compare against, so first launch records the current build
//    silently (see `prepareOnLaunch`).
//  • Never over the update gate (AppShell is not on screen then) and never
//    before the first-run tour has run.
//  • Fails silently, always. No network, no note, unreadable answer — the
//    app opens as normal and tries again next launch.

struct WhatsNewNote: Codable, Equatable, Identifiable {
    struct Item: Codable, Equatable, Hashable {
        let icon: String?
        let heading: String
        let body: String
    }

    /// The first build this note applies to.
    let build: Int
    let title: String
    let items: [Item]
    let footer: String?

    var id: Int { build }
}

@MainActor
enum WhatsNew {
    static let seenKey = "whatsNewSeenBuild"

    /// Call once at process start, before any view exists.
    ///
    /// Decides whether this launch is a brand-new install. It has to run this
    /// early because the signals it reads change within the first minute:
    /// onboarding flips `hasSeenOnboarding`, signing in writes the keychain.
    ///
    /// An install that already has a session, has been through onboarding or
    /// has finished the home tour is an EXISTING reader arriving from a build
    /// that predates this screen — they have no seen-build yet and should get
    /// the note. Anyone else is new: record the current build so they are only
    /// told about builds that come after the one they installed.
    static func prepareOnLaunch() {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: seenKey) == nil else { return }
        let existingReader = defaults.bool(forKey: "hasSeenOnboarding")
            || defaults.bool(forKey: "tour-home-r2")
            || Keychain.accessToken != nil
        if !existingReader {
            defaults.set(UpdateGateModel.currentBuild, forKey: seenKey)
        }
    }

    /// The newest note the server has for this build, or nil.
    static func latest() async -> WhatsNewNote? {
        struct Res: Codable { let note: WhatsNewNote? }
        let build = UpdateGateModel.currentBuild
        guard build > 0 else { return nil }
        // Query items, never "?build=" in the path: appending(path:) would
        // percent-encode the "?" and the server would 404.
        let res: Res? = try? await APIClient.shared.get(
            "/api/v1/whats-new",
            query: [URLQueryItem(name: "build", value: String(build))],
            authed: false)
        guard let note = res?.note, !note.items.isEmpty else { return nil }
        return note
    }

    /// The note to show unprompted on this launch, or nil.
    static func pending() async -> WhatsNewNote? {
        #if DEBUG && targetEnvironment(simulator)
        let env = ProcessInfo.processInfo.environment
        // Headless verification: always show. Store screenshots: never show.
        if env["TBRA_DEBUG_WHATS_NEW"] != nil { return await latest() }
        if env["TBRA_DEBUG_NO_TOURS"] != nil { return nil }
        #endif
        let defaults = UserDefaults.standard
        // The first-run tour comes first; the note waits for the next launch.
        guard defaults.bool(forKey: "tour-home-r2") else { return nil }
        guard let note = await latest() else { return nil }
        return note.build > defaults.integer(forKey: seenKey) ? note : nil
    }

    static func markSeen(_ note: WhatsNewNote) {
        let defaults = UserDefaults.standard
        if note.build > defaults.integer(forKey: seenKey) {
            defaults.set(note.build, forKey: seenKey)
        }
    }
}

struct WhatsNewSheet: View {
    let note: WhatsNewNote
    @Environment(\.dismiss) private var dismiss

    /// Icon hues cycle through the wordmark's three colours.
    private static let tints: [Color] = [Theme.accentText, Theme.neonBlue, Theme.neonPurple]

    var body: some View {
        ZStack {
            AmbientBackground()
            ScrollView {
                VStack(spacing: 22) {
                    header
                    itemsCard
                    if let footer = note.footer, !footer.isEmpty {
                        Label {
                            Text(footer)
                        } icon: {
                            Image(systemName: "flag")
                        }
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 34)
                .padding(.bottom, 16)
            }
            .scrollIndicators(.hidden)
        }
        .safeAreaInset(edge: .bottom) {
            Button("Got it") { dismiss() }
                .buttonStyle(AccentButtonStyle())
                .padding(.horizontal, 20)
                .padding(.top, 22)
                .padding(.bottom, 12)
                // Solid under the button so the list does not show through
                // it, fading in at the top edge so rows slide under softly.
                .background {
                    LinearGradient(stops: [.init(color: Theme.bg.opacity(0), location: 0),
                                           .init(color: Theme.bg, location: 0.3)],
                                   startPoint: .top, endPoint: .bottom)
                        .ignoresSafeArea(edges: .bottom)
                }
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Text("tbr*a")
                .font(Theme.logo(26))
                .foregroundStyle(Theme.logoGradient)
            Text("JUST UPDATED")
                .font(Theme.body(11, .semibold))
                .tracking(1.6)
                .foregroundStyle(Theme.muted)
            Text(note.title)
                .font(Theme.heading(30))
                .foregroundStyle(Theme.foreground)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var itemsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(note.items.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Rectangle()
                        .fill(Theme.border.opacity(0.55))
                        .frame(height: 1)
                        .padding(.leading, 52)
                }
                row(item, tint: Self.tints[index % Self.tints.count])
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(LinearGradient(
                    colors: [Theme.accent.opacity(0.55), Theme.neonBlue.opacity(0.35),
                             Theme.neonPurple.opacity(0.45)],
                    startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
        )
    }

    private func row(_ item: WhatsNewNote.Item, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: Self.symbol(item.icon))
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 38, height: 38)
                .background(tint.opacity(0.12), in: Circle())
                .overlay(Circle().stroke(tint.opacity(0.35), lineWidth: 1))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.heading)
                    .font(Theme.heading(17))
                    .foregroundStyle(Theme.foreground)
                Text(item.body)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.foreground.opacity(0.78))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 14)
        .accessibilityElement(children: .combine)
    }

    /// The server names the SF Symbol; a name this iOS does not have (or a
    /// typo) falls back to a sparkle rather than an empty circle.
    private static func symbol(_ name: String?) -> String {
        guard let name, !name.isEmpty, UIImage(systemName: name) != nil else { return "sparkles" }
        return name
    }
}
