import SwiftUI

// Settings — recreates /settings for the native app: the Content Comfort
// Zone (per-category max-tolerance rows — THE core preference set that
// drives What's Inside conflict matching), custom topics-to-avoid,
// email notification toggles, hidden-books manager, and the theme row.
// Account flows (password, email, export, delete) open the live site.

struct ContentPref: Codable, Hashable, Identifiable {
    var id: String { categoryId }
    let categoryId: String
    let key: String
    let name: String
    var maxTolerance: Int
}

struct NotifPrefs: Codable, Hashable {
    var emailNewFollower: Bool
    var emailNewCorrection: Bool
    var emailWeeklyDigest: Bool
}

struct HiddenBookRow: Codable, Hashable, Identifiable {
    var id: String { bookId }
    let bookId: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
}

@MainActor
@Observable
final class SettingsModel {
    var contentPrefs: [ContentPref] = []
    var customWarnings: [String] = []
    var notifPrefs = NotifPrefs(emailNewFollower: true, emailNewCorrection: true, emailWeeklyDigest: false)
    var hiddenBooks: [HiddenBookRow] = []
    var loaded = false

    struct Res: Codable {
        let ok: Bool
        let contentPrefs: [ContentPref]
        let customWarnings: [String]
        let notificationPrefs: NotifPrefs
        let hiddenBooks: [HiddenBookRow]
    }

    func load() async {
        if let res: Res = try? await APIClient.shared.get("/api/v1/settings") {
            contentPrefs = res.contentPrefs
            customWarnings = res.customWarnings
            notifPrefs = res.notificationPrefs
            hiddenBooks = res.hiddenBooks
            loaded = true
        }
    }

    func setTolerance(_ categoryId: String, _ level: Int) async {
        if let i = contentPrefs.firstIndex(where: { $0.categoryId == categoryId }) {
            contentPrefs[i].maxTolerance = level
        }
        struct Body: Codable, Sendable { let categoryId: String; let maxTolerance: Int }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request("/api/v1/settings", method: "PATCH",
                                                         json: Body(categoryId: categoryId, maxTolerance: level))
    }

    func saveWarnings(_ warnings: [String]) async {
        struct Body: Codable, Sendable { let customWarnings: [String] }
        struct Ok: Codable { let ok: Bool; let customWarnings: [String] }
        if let res: Ok = try? await APIClient.shared.request("/api/v1/settings", method: "PATCH",
                                                             json: Body(customWarnings: warnings)) {
            customWarnings = res.customWarnings
        }
    }

    func saveNotifs() async {
        struct Body: Codable, Sendable { let notifications: NotifPrefs }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request("/api/v1/settings", method: "PATCH",
                                                         json: Body(notifications: notifPrefs))
    }

    func unhide(_ bookId: String) async {
        hiddenBooks.removeAll { $0.bookId == bookId }
        struct Body: Codable, Sendable { let hide: Bool }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request("/api/v1/books/\(bookId)/flags", method: "POST",
                                                         json: Body(hide: false))
    }
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = SettingsModel()
    @State private var warningInput = ""
    @AppStorage("themeOverride") private var themeOverride = "dark"

    private let toleranceLabels = ["None", "Mild", "Moderate", "Significant", "Extreme"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.35), in: Circle())
                            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Settings")
                            .font(Theme.heading(26, .bold))
                            .foregroundStyle(Theme.foreground)
                        Text("Manage your account and data")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .padding(.top, 14)

                if model.loaded {
                    comfortZone
                    topicsToAvoid
                    displaySection
                    notificationsSection
                    if !model.hiddenBooks.isEmpty { hiddenBooksSection }
                    accountSection
                } else {
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
    }

    // ── Content Comfort Zone ──
    private var comfortZone: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading("Content Comfort Zone")
            Text("The most you're comfortable with in each category. Books above your limit get flagged before you read them.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
            ForEach(model.contentPrefs) { pref in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(pref.name)
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(Theme.foreground)
                        Spacer()
                        Text(toleranceLabels[pref.maxTolerance])
                            .font(Theme.body(12, .medium))
                            .foregroundStyle(pref.maxTolerance < 4 ? Theme.accent : Theme.muted)
                    }
                    HStack(spacing: 5) {
                        ForEach(0..<5, id: \.self) { level in
                            let active = pref.maxTolerance == level
                            Button {
                                Task { await model.setTolerance(pref.categoryId, level) }
                            } label: {
                                Text(toleranceLabels[level])
                                    .font(Theme.body(10, .medium))
                                    .foregroundStyle(active ? .black : Theme.muted)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 7)
                                    .background(active ? Theme.accent : Theme.surfaceAlt.opacity(0.4), in: Capsule())
                            }
                        }
                    }
                }
                .padding(12)
                .background(Theme.surface.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            }
        }
    }

    // ── Custom topics to avoid ──
    private var topicsToAvoid: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Custom Topics to Avoid")
            Text("We scan reviews and content notes for these and warn you on the book page.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
            FlowLayout(spacing: 8) {
                ForEach(model.customWarnings, id: \.self) { warning in
                    HStack(spacing: 5) {
                        Text(warning.replacingOccurrences(of: "_", with: " "))
                            .font(Theme.body(13, .medium))
                        Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                    }
                    .foregroundStyle(Theme.foreground)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Theme.surfaceAlt.opacity(0.7), in: Capsule())
                    .onTapGesture {
                        Task { await model.saveWarnings(model.customWarnings.filter { $0 != warning }) }
                    }
                }
            }
            HStack(spacing: 10) {
                TextField("e.g. spiders, cheating…", text: $warningInput)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .font(Theme.body(14))
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                Button {
                    let trimmed = warningInput.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    warningInput = ""
                    Task { await model.saveWarnings(model.customWarnings + [trimmed]) }
                } label: {
                    Text("Add")
                        .font(Theme.body(14, .semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(Theme.accent, in: Capsule())
                }
            }
        }
    }

    // ── Display ──
    private var displaySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Display")
            HStack {
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
                .frame(width: 190)
            }
        }
    }

    // ── Notifications ──
    private var notificationsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Email Notifications")
            notifToggle("New followers", isOn: Bindable(model).notifPrefs.emailNewFollower)
            notifToggle("Correction updates", isOn: Bindable(model).notifPrefs.emailNewCorrection)
            notifToggle("Weekly digest", isOn: Bindable(model).notifPrefs.emailWeeklyDigest)
        }
    }

    private func notifToggle(_ label: String, isOn: Binding<Bool>) -> some View {
        Toggle(label, isOn: Binding(
            get: { isOn.wrappedValue },
            set: { newValue in
                isOn.wrappedValue = newValue
                Task { await model.saveNotifs() }
            }
        ))
        .font(Theme.body(15))
        .foregroundStyle(Theme.foreground)
        .tint(Theme.accent)
    }

    // ── Hidden books ──
    private var hiddenBooksSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Hidden Books (\(model.hiddenBooks.count))")
            Text("Hidden from all recommendations. Unhide to see them again.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
            ForEach(model.hiddenBooks) { book in
                HStack(spacing: 12) {
                    CoverThumb(url: book.coverImageUrl, width: 36, height: 54, radius: 4)
                    Text(book.title)
                        .font(Theme.body(14, .medium))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                    Spacer()
                    Button("Unhide") {
                        Task { await model.unhide(book.bookId) }
                    }
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(Theme.neonBlue)
                }
            }
        }
    }

    // ── Account (web flows) ──
    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Account")
            ForEach([("Change password", "/settings"), ("Export your data", "/settings"), ("Manage account", "/settings")], id: \.0) { label, path in
                Button {
                    if let url = URL(string: "https://thebasedreader.app\(path)") {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    HStack {
                        Text(label)
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.foreground)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 8)
                }
            }
        }
    }
}
