import SwiftUI

// Settings — full web /settings parity (rebuilt 2026-07-16 to match the
// user's screenshots): Reading Preferences card with four collapsible
// sections (Genre / Reading Style / Story / Content Comfort Zone,
// auto-saved), Display (theme + text size), Location, email Notifications,
// Export Your Data, Hidden Books, Change Password, Account, Danger Zone.
// Every control writes through /api/v1/settings and friends.

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

struct ReadingStyleData: Codable, Hashable {
    var fictionPreference: String?
    var pacePreference: [String]
    var pageLengthMin: Int?
    var pageLengthMax: Int?
    var moodPreferences: [String]
    var storyFocus: String?
    var characterTropes: [String]
    var dislikedTropes: [String]
    var textSize: String?
    var hasPrefsRow: Bool
}

struct GenrePrefRow: Codable, Hashable {
    let genreName: String
    let preference: String
}

// ── Constants — mirrored from the web editor / genre taxonomy ──

enum SettingsCatalog {
    // FICTION_GENRES minus "Dystopia" + "Crime Fiction" (web exclusions)
    static let fictionGenres = [
        "Literary Fiction", "Contemporary Fiction", "Mystery", "Thriller",
        "Suspense", "Crime", "Horror", "Romance", "Fantasy", "Sci-Fi",
        "LitRPG", "Historical Fiction", "Speculative Fiction", "Dystopian",
        "Action/Adventure", "Adventure", "Western", "Humor", "Satire",
        "Christian Fiction", "Amish Fiction", "Graphic Novel",
        "Short Stories", "Anthology", "Drama", "Poetry", "Classics",
        "Magical Realism",
    ]
    // NONFICTION_GENRES minus "Nonfiction"
    static let nonfictionGenres = [
        "Biography", "Autobiography", "Memoir", "History", "Politics",
        "Religion", "Spirituality", "Christian Nonfiction",
        "Christian Living", "Christianity", "Islam", "Judaism", "Buddhism",
        "Hinduism", "Philosophy", "Psychology", "Mental Health", "Self-Help",
        "Personal Development", "Business", "Leadership", "Economics",
        "Finance", "Science", "Technology", "Nature", "Environment",
        "Health", "Fitness", "Wellness", "Cookbooks", "Food & Wine",
        "Travel", "True Crime", "Essays", "Arts", "Music", "Film",
        "Photography", "Crafts",
    ]
    static let moods: [(key: String, label: String)] = [
        ("cozy", "Cozy"), ("dark", "Dark"), ("funny", "Funny"),
        ("emotional", "Emotional"), ("thrilling", "Thrilling"),
        ("romantic", "Romantic"), ("inspiring", "Inspiring"),
        ("adventurous", "Adventurous"), ("thought-provoking", "Thought-provoking"),
        ("contemplative", "Contemplative"), ("mind-blown", "Mind-blowing"),
        ("nostalgic", "Nostalgic"), ("spooky", "Spooky"),
        ("informative", "Informative"), ("happy", "Feel-good"),
        ("angry", "Rage-inducing"), ("fantastical", "Fantastical"),
        ("historical", "Historical"), ("sciencey", "Science-y"),
    ]
    static let tropes: [(key: String, label: String)] = [
        ("morally-grey", "Morally grey"), ("found-family", "Found family"),
        ("enemies-to-lovers", "Enemies to lovers"),
        ("unreliable-narrator", "Unreliable narrator"),
        ("strong-female-lead", "Strong female lead"), ("anti-hero", "Anti-hero"),
        ("chosen-one", "Chosen one"), ("slow-burn", "Slow burn romance"),
        ("reluctant-hero", "Reluctant hero"), ("complex-villain", "Complex villain"),
        ("dual-pov", "Dual / multiple POV"), ("mentor-figure", "Mentor figure"),
        ("redemption-arc", "Redemption arc"), ("fish-out-of-water", "Fish out of water"),
    ]
    static let focusOptions: [(key: String, label: String)] = [
        ("worldbuilding", "Worldbuilding"), ("plot", "Plot"),
        ("characters", "Characters"), ("mix", "A mix"),
    ]
    // Web TOLERANCE_LABELS: None/Mild/Moderate/Significant/Any
    static let toleranceLabels = ["None", "Mild", "Moderate", "Significant", "Any"]
    /// Shown under the selector for the CURRENT level — beta testers were
    /// overshooting (e.g. "None" everywhere) without realizing how strict
    /// each step is. Keep these short; they mirror the web editor.
    static let toleranceHints = [
        "Strictest — flags even a passing mention.",
        "Brief or non-graphic content is okay; more gets flagged.",
        "Recurring but non-graphic content is okay.",
        "Graphic or frequent content is okay — only extremes get flagged.",
        "No limit — this category is never flagged for you.",
    ]
}

@MainActor
@Observable
final class SettingsModel {
    var contentPrefs: [ContentPref] = []
    var customWarnings: [String] = []
    var notifPrefs = NotifPrefs(emailNewFollower: true, emailNewCorrection: true, emailWeeklyDigest: false)
    var hiddenBooks: [HiddenBookRow] = []
    var genrePrefs: [String: String] = [:]   // genreName → love|dislike
    var style = ReadingStyleData(fictionPreference: nil, pacePreference: [], pageLengthMin: nil,
                                 pageLengthMax: nil, moodPreferences: [], storyFocus: nil,
                                 characterTropes: [], dislikedTropes: [], textSize: nil, hasPrefsRow: false)
    var location = ""
    var locationVisibility = "public"
    var email = ""
    var loaded = false

    struct Res: Codable {
        let ok: Bool
        let contentPrefs: [ContentPref]
        let customWarnings: [String]
        let notificationPrefs: NotifPrefs
        let hiddenBooks: [HiddenBookRow]
        let genrePrefs: [GenrePrefRow]?
        let readingStyle: ReadingStyleData?
        let location: String?
        let locationVisibility: String?
        let email: String?
    }

    func load() async {
        if let res: Res = try? await APIClient.shared.get("/api/v1/settings") {
            contentPrefs = res.contentPrefs
            customWarnings = res.customWarnings
            notifPrefs = res.notificationPrefs
            hiddenBooks = res.hiddenBooks
            genrePrefs = Dictionary(uniqueKeysWithValues: (res.genrePrefs ?? []).map { ($0.genreName, $0.preference) })
            if let s = res.readingStyle { style = s }
            location = res.location ?? ""
            locationVisibility = res.locationVisibility ?? "public"
            email = res.email ?? ""
            loaded = true
        }
    }

    // Header counts — same math as the web card
    var lovedCount: Int { genrePrefs.values.filter { $0 == "love" }.count }
    var dislikedCount: Int { genrePrefs.values.filter { $0 == "dislike" }.count }
    var restrictedCount: Int { contentPrefs.filter { $0.maxTolerance < 4 }.count }
    var countsLine: String {
        var parts: [String] = []
        if lovedCount > 0 { parts.append("\(lovedCount) loved genre\(lovedCount == 1 ? "" : "s")") }
        if dislikedCount > 0 { parts.append("\(dislikedCount) disliked") }
        if restrictedCount > 0 { parts.append("\(restrictedCount) content filter\(restrictedCount == 1 ? "" : "s")") }
        return parts.isEmpty ? "No preferences set yet" : parts.joined(separator: " · ")
    }

    /// Tri-state genre chip: none → love → dislike → none
    func cycleGenre(_ name: String) async {
        let next: String? = switch genrePrefs[name] {
        case nil: "love"
        case "love": "dislike"
        default: nil
        }
        if let next { genrePrefs[name] = next } else { genrePrefs.removeValue(forKey: name) }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request(
            "/api/v1/settings", method: "PATCH",
            body: ["genreName": name, "preference": next ?? NSNull()])
    }

    func saveStyle(_ fields: [String: Any]) async {
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request(
            "/api/v1/settings", method: "PATCH", body: ["readingStyle": fields])
    }

    func saveLocation() async -> Bool {
        struct Ok: Codable { let ok: Bool }
        let res: Ok? = try? await APIClient.shared.request(
            "/api/v1/settings", method: "PATCH",
            body: ["location": ["location": location, "locationVisibility": locationVisibility]])
        return res?.ok == true
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
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request(
            "/api/v1/settings/unhide", method: "POST", body: ["bookId": bookId])
    }
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var model = SettingsModel()
    @AppStorage("themeOverride") private var themeOverride = "dark"
    @AppStorage("textSize") private var textSizeLocal = "medium"
    /// Snapshot on appear — if the size differs when Settings closes, the
    /// shell is told to re-render every screen at the new Theme.textScale.
    @State private var textSizeOnAppear: String?
    @State private var openSection: String? = nil
    @State private var warningInput = ""
    @State private var locationSaved = false
    @State private var exportURL: URL?
    @State private var exporting: String? = nil
    @State private var exportError: String?
    // Password
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var passwordBusy = false
    @State private var passwordMessage: (text: String, isError: Bool)?
    // Danger zone
    @State private var dangerAction: DangerAction?

    private var isPremium: Bool {
        if case .signedIn(let user) = auth.phase {
            return ["premium", "beta_tester", "admin", "super_admin"].contains(user.accountType)
        }
        return false
    }

    var body: some View {
        ScrollViewReader { tourProxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
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
                    // 1pt scroll marker for the tour (see BookDetailView note:
                    // tall sections scroll unpredictably with proportional
                    // anchors; a tiny target lands exactly where asked).
                    Color.clear.frame(height: 1).id("tour-prefs-top")
                    readingPreferencesCard
                    displaySection
                    locationSection
                        .id("tour-privacy")
                        .coachAnchor("tour-privacy")
                    notificationsSection
                    exportSection
                    if !model.hiddenBooks.isEmpty { hiddenBooksSection }
                    passwordSection
                    accountCard
                    dangerZone
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
        .tracksScrollAtTop()
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .onAppear { if textSizeOnAppear == nil { textSizeOnAppear = textSizeLocal } }
        .onDisappear {
            if let was = textSizeOnAppear, was != textSizeLocal {
                NotificationCenter.default.post(name: Theme.textSizeChanged, object: nil)
            }
        }
        .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) {
            if let exportURL {
                ShareSheet(items: [exportURL])
            }
        }
        .sheet(item: $dangerAction) { action in
            DangerConfirmSheet(action: action) { succeeded in
                dangerAction = nil
                guard succeeded else { return }
                if action.key == "delete-account" {
                    Task { await auth.logout() }
                } else {
                    Task { await model.load() }
                }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.bg)
        }
        // First-visit guided tour: genres → comfort zone (each accordion
        // auto-opens for its step, closes on advance) → privacy.
        .guidedTour("settings-r3", steps: [
            CoachStep(id: "tour-genres", title: "Pick your genres",
                      text: "Tap a genre once to heart it, twice to hide it. Your picks shape what search and Discover recommend — more of what you love, none of what you don't."),
            CoachStep(id: "tour-comfort-zone", title: "Your Content Comfort Zone",
                      text: "The heart of tbr*a. Set the most you're okay with for violence, language, sexual content, and more. Books beyond your limits become less likely to be recommended — and any book that crosses them shows a clear flag right on its page."),
            CoachStep(id: "tour-privacy", title: "Your privacy",
                      text: "Your profile is public under your username, so choose what you share. Control who can see your location here — everything else, like notes to self, stays private to you."),
        ], onStep: { step in
            // Open the accordion the step teaches; close it when moving on.
            switch step.id {
            case "tour-genres": openSection = "genres"
            case "tour-comfort-zone": openSection = "content"
            default: openSection = nil
            }
            // Scroll AFTER the accordion insert settles (same-transaction
            // scrollTo silently no-ops). The genres/comfort steps scroll the
            // 1pt marker above the card so the accordion HEADER is always
            // visible below the chrome — scrolling the tall open section
            // itself lands mid-list and hides its title above the ring.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                withAnimation {
                    if step.id == "tour-privacy" {
                        tourProxy.scrollTo(step.id, anchor: UnitPoint(x: 0.5, y: 0.45))
                    } else {
                        tourProxy.scrollTo("tour-prefs-top", anchor: UnitPoint(x: 0.5, y: 0.13))
                    }
                }
            }
        })
        } // ScrollViewReader
    }

    // ── 1. Reading Preferences (4 accordions) ──
    private var readingPreferencesCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Reading Preferences")
                        .font(Theme.heading(19, .bold))
                        .foregroundStyle(Theme.foreground)
                    Text(model.countsLine)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
                Spacer()
                Text("Auto-saved")
                    .font(Theme.body(11, .medium))
                    .foregroundStyle(Theme.muted)
            }
            .padding(16)

            accordion("genres", title: "Genre Preferences") {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Tap once to love a genre, twice to hide it from recommendations.")
                        .font(Theme.body(12)).foregroundStyle(Theme.muted)
                    genreGroup("Fiction", SettingsCatalog.fictionGenres)
                    genreGroup("Nonfiction", SettingsCatalog.nonfictionGenres)
                }
            }
            .id("tour-genres")
            .coachAnchor("tour-genres")
            accordion("style", title: "Reading Style") {
                VStack(alignment: .leading, spacing: 16) {
                    styleRow("I read mostly") {
                        segmented(["fiction": "Fiction", "nonfiction": "Nonfiction", "both": "Both"],
                                  order: ["fiction", "nonfiction", "both"],
                                  selection: model.style.fictionPreference) { key in
                            model.style.fictionPreference = model.style.fictionPreference == key ? nil : key
                            Task { await model.saveStyle(["fictionPreference": model.style.fictionPreference as Any]) }
                        }
                    }
                    styleRow("Preferred pace") { paceChips }
                    styleRow("Preferred length") { lengthChips }
                    styleRow("Preferred moods") { moodChips }
                }
            }
            accordion("story", title: "Story Preferences") {
                VStack(alignment: .leading, spacing: 16) {
                    styleRow("I care most about") {
                        FlowLayout(spacing: 8) {
                            ForEach(SettingsCatalog.focusOptions, id: \.key) { opt in
                                chip(opt.label, active: model.style.storyFocus == opt.key) {
                                    model.style.storyFocus = model.style.storyFocus == opt.key ? nil : opt.key
                                    Task { await model.saveStyle(["storyFocus": model.style.storyFocus as Any]) }
                                }
                            }
                        }
                    }
                    styleRow("Character types") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Tap once for ♥ like, twice for ✕ dislike.")
                                .font(Theme.body(11)).foregroundStyle(Theme.muted)
                            FlowLayout(spacing: 8) {
                                ForEach(SettingsCatalog.tropes, id: \.key) { trope in
                                    tropeChip(trope.key, trope.label)
                                }
                            }
                        }
                    }
                }
            }
            accordion("content", title: "Content Comfort Zone", isLast: true) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("The most you're comfortable with in each category. Books above your limit get flagged before you read them.\n\nTip: each step is a maximum, not a preference — \"None\" flags even a passing mention. Most readers start at Mild or Moderate and adjust after a few books.")
                        .font(Theme.body(12)).foregroundStyle(Theme.muted)
                    ForEach(model.contentPrefs) { pref in
                        toleranceRow(pref)
                    }
                    topicsToAvoid
                }
            }
            .id("tour-comfort-zone")
            .coachAnchor("tour-comfort-zone")
        }
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }

    private func accordion(_ key: String, title: String, isLast: Bool = false,
                           @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider().background(Theme.border.opacity(0.6))
            Button {
                withAnimation(.easeOut(duration: 0.2)) {
                    openSection = openSection == key ? nil : key
                }
            } label: {
                HStack {
                    Text(title)
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.foreground)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(openSection == key ? 180 : 0))
                }
                .padding(16)
                .contentShape(Rectangle())
            }
            if openSection == key {
                content()
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
            }
        }
    }

    private func styleRow(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(Theme.body(13, .semibold))
                .foregroundStyle(Theme.foreground)
            content()
        }
    }

    private func chip(_ label: String, active: Bool, icon: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon { Text(icon).font(Theme.body(11)) }
                Text(label).font(Theme.body(12, .medium))
            }
            .foregroundStyle(active ? .black : Theme.foreground.opacity(0.8))
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(active ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.surfaceAlt), in: Capsule())
            .overlay(Capsule().stroke(active ? .clear : Theme.border, lineWidth: 1))
        }
    }

    private func segmented(_ labels: [String: String], order: [String],
                           selection: String?, tap: @escaping (String) -> Void) -> some View {
        HStack(spacing: 8) {
            ForEach(order, id: \.self) { key in
                chip(labels[key] ?? key, active: selection == key) { tap(key) }
            }
        }
    }

    private func genreGroup(_ title: String, _ genres: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(Theme.body(10, .semibold)).kerning(1.2)
                .foregroundStyle(Theme.muted)
            FlowLayout(spacing: 8) {
                ForEach(genres, id: \.self) { genre in
                    let pref = model.genrePrefs[genre]
                    Button {
                        Task { await model.cycleGenre(genre) }
                    } label: {
                        HStack(spacing: 4) {
                            if pref == "love" { Text("♥").font(Theme.body(11)) }
                            if pref == "dislike" { Text("✕").font(Theme.body(11)) }
                            Text(genre).font(Theme.body(12, .medium))
                        }
                        .foregroundStyle(pref == "love" ? .black : pref == "dislike" ? Theme.destructive : Theme.foreground.opacity(0.8))
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(pref == "love" ? AnyShapeStyle(Theme.accent)
                                    : pref == "dislike" ? AnyShapeStyle(Theme.destructive.opacity(0.12))
                                    : AnyShapeStyle(Theme.surfaceAlt), in: Capsule())
                        .overlay(Capsule().stroke(
                            pref == "love" ? .clear : pref == "dislike" ? Theme.destructive.opacity(0.5) : Theme.border,
                            lineWidth: 1))
                    }
                }
            }
        }
    }

    private var paceChips: some View {
        let paces = [("slow", "Slow"), ("medium", "Steady"), ("fast", "Fast")]
        return FlowLayout(spacing: 8) {
            ForEach(paces, id: \.0) { key, label in
                chip(label, active: model.style.pacePreference.contains(key)) {
                    if model.style.pacePreference.contains(key) {
                        model.style.pacePreference.removeAll { $0 == key }
                    } else {
                        model.style.pacePreference.append(key)
                    }
                    Task { await model.saveStyle(["pacePreference": model.style.pacePreference]) }
                }
            }
            chip("Any", active: model.style.pacePreference.isEmpty) {
                model.style.pacePreference = []
                Task { await model.saveStyle(["pacePreference": [String]()]) }
            }
        }
    }

    private var lengthChips: some View {
        // Same min/max mapping as the web (Short null/200, Medium 200/400,
        // Long 400/null, Any null/null)
        let options: [(label: String, min: Int?, max: Int?)] = [
            ("Short", nil, 200), ("Medium", 200, 400), ("Long", 400, nil), ("Any", nil, nil),
        ]
        return FlowLayout(spacing: 8) {
            ForEach(options, id: \.label) { opt in
                let active = model.style.pageLengthMin == opt.min && model.style.pageLengthMax == opt.max
                chip(opt.label, active: active) {
                    model.style.pageLengthMin = opt.min
                    model.style.pageLengthMax = opt.max
                    Task { await model.saveStyle([
                        "pageLengthMin": opt.min as Any, "pageLengthMax": opt.max as Any]) }
                }
            }
        }
    }

    private var moodChips: some View {
        FlowLayout(spacing: 8) {
            ForEach(SettingsCatalog.moods, id: \.key) { mood in
                chip(mood.label, active: model.style.moodPreferences.contains(mood.key)) {
                    if model.style.moodPreferences.contains(mood.key) {
                        model.style.moodPreferences.removeAll { $0 == mood.key }
                    } else {
                        model.style.moodPreferences.append(mood.key)
                    }
                    Task { await model.saveStyle(["moodPreferences": model.style.moodPreferences]) }
                }
            }
        }
    }

    private func tropeChip(_ key: String, _ label: String) -> some View {
        let liked = model.style.characterTropes.contains(key)
        let disliked = model.style.dislikedTropes.contains(key)
        return Button {
            // none → like → dislike → none (web tri-state)
            if liked {
                model.style.characterTropes.removeAll { $0 == key }
                model.style.dislikedTropes.append(key)
            } else if disliked {
                model.style.dislikedTropes.removeAll { $0 == key }
            } else {
                model.style.characterTropes.append(key)
            }
            Task { await model.saveStyle([
                "characterTropes": model.style.characterTropes,
                "dislikedTropes": model.style.dislikedTropes]) }
        } label: {
            HStack(spacing: 4) {
                if liked { Text("♥").font(Theme.body(11)) }
                if disliked { Text("✕").font(Theme.body(11)) }
                Text(label).font(Theme.body(12, .medium))
            }
            .foregroundStyle(liked ? .black : disliked ? Theme.destructive : Theme.foreground.opacity(0.8))
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(liked ? AnyShapeStyle(Theme.accent)
                        : disliked ? AnyShapeStyle(Theme.destructive.opacity(0.12))
                        : AnyShapeStyle(Theme.surfaceAlt), in: Capsule())
            .overlay(Capsule().stroke(
                liked ? .clear : disliked ? Theme.destructive.opacity(0.5) : Theme.border, lineWidth: 1))
        }
    }

    private func toleranceRow(_ pref: ContentPref) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(pref.name)
                    .font(Theme.body(14, .semibold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Text(SettingsCatalog.toleranceLabels[pref.maxTolerance])
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(pref.maxTolerance < 4 ? Theme.accentText : Theme.muted)
            }
            HStack(spacing: 5) {
                ForEach(0..<5, id: \.self) { level in
                    let active = pref.maxTolerance == level
                    Button {
                        Task { await model.setTolerance(pref.categoryId, level) }
                    } label: {
                        Text(SettingsCatalog.toleranceLabels[level])
                            .font(Theme.body(10, .medium))
                            .foregroundStyle(active ? .black : Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 7)
                            .background(active ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.surfaceAlt), in: Capsule())
                            .overlay(Capsule().stroke(active ? .clear : Theme.border, lineWidth: 1))
                    }
                }
            }
            // Live hint for the selected level (overshoot guard)
            Text(SettingsCatalog.toleranceHints[pref.maxTolerance])
                .font(Theme.body(11))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(Theme.surface.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
    }

    private var topicsToAvoid: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Custom topics to avoid")
                .font(Theme.body(13, .semibold))
                .foregroundStyle(Theme.foreground)
            Text("We scan reviews and content notes for these and warn you on the book page.")
                .font(Theme.body(12))
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
        .padding(.top, 4)
    }

    // ── 2. Display ──
    private var displaySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading("Display")
            VStack(alignment: .leading, spacing: 6) {
                Text("Theme").font(Theme.body(14, .semibold)).foregroundStyle(Theme.foreground)
                Text("Choose your preferred color scheme").font(Theme.body(12)).foregroundStyle(Theme.muted)
                Picker("", selection: $themeOverride) {
                    Text("Light").tag("light")
                    Text("System").tag("system")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Text Size").font(Theme.body(14, .semibold)).foregroundStyle(Theme.foreground)
                Text("Adjust the base font size across the app").font(Theme.body(12)).foregroundStyle(Theme.muted)
                Picker("", selection: Binding(
                    get: { textSizeLocal },
                    set: { newValue in
                        textSizeLocal = newValue
                        Task { await model.saveStyle(["textSize": newValue]) }
                    }
                )) {
                    Text("Small").tag("small")
                    Text("Medium").tag("medium")
                    Text("Large").tag("large")
                }
                .pickerStyle(.segmented)
            }
        }
    }

    // ── 3. Location ──
    private var locationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Location")
            TextField("e.g., Nashville, TN or 'The Shire'", text: Bindable(model).location)
                .font(Theme.body(14))
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                .onChange(of: model.location) {
                    if model.location.count > 100 { model.location = String(model.location.prefix(100)) }
                }
            Text("Who can see your location?")
                .font(Theme.body(13, .semibold)).foregroundStyle(Theme.foreground)
            Picker("", selection: Bindable(model).locationVisibility) {
                Text("Everyone").tag("public")
                Text("Followers only").tag("followers")
            }
            .pickerStyle(.segmented)
            Button {
                Task {
                    locationSaved = await model.saveLocation()
                    try? await Task.sleep(for: .seconds(1.5))
                    locationSaved = false
                }
            } label: {
                Text(locationSaved ? "Saved ✓" : "Save Location")
                    .font(Theme.body(14, .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    // ── 4. Notifications ──
    private var notificationsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Notifications")
            Text("Choose which emails you receive")
                .font(Theme.body(13)).foregroundStyle(Theme.muted)
            notifToggle("New follower", subtitle: "Email when someone follows you",
                        isOn: Bindable(model).notifPrefs.emailNewFollower)
            notifToggle("Correction responses", subtitle: "Email when a correction you submitted gets a response",
                        isOn: Bindable(model).notifPrefs.emailNewCorrection)
            notifToggle("Weekly reading digest", subtitle: "A weekly summary of your reading activity",
                        isOn: Bindable(model).notifPrefs.emailWeeklyDigest)
        }
        .padding(16)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }

    private func notifToggle(_ label: String, subtitle: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: Binding(
            get: { isOn.wrappedValue },
            set: { newValue in
                isOn.wrappedValue = newValue
                Task { await model.saveNotifs() }
            }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(Theme.body(14, .semibold)).foregroundStyle(Theme.foreground)
                Text(subtitle).font(Theme.body(12)).foregroundStyle(Theme.muted)
            }
        }
        .tint(Theme.accent)
    }

    // ── 5. Export ──
    private var exportSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Export Your Data")
            Text("Download your reading data to keep a backup or move to another platform.")
                .font(Theme.body(13)).foregroundStyle(Theme.muted)
            exportCard(
                title: "Library Export",
                blurb: "CSV file compatible with Goodreads and StoryGraph. Includes your books, ratings, reviews, and reading dates.",
                tint: Theme.accent, format: "csv", enabled: true)
            exportCard(
                title: "Full Export",
                blurb: isPremium
                    ? "Complete JSON with books, notes, reviews, preferences, social data, and more."
                    : "Complete JSON export is a Based Reader feature.",
                tint: Theme.neonPurple, format: "json", enabled: isPremium)
            if let exportError {
                Text(exportError).font(Theme.body(12)).foregroundStyle(Theme.destructive)
            }
        }
        .padding(16)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }

    private func exportCard(title: String, blurb: String, tint: Color, format: String, enabled: Bool) -> some View {
        Button {
            downloadExport(format: format)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: exporting == format ? "arrow.triangle.2.circlepath" : "arrow.down.to.line")
                    .font(.system(size: 15))
                    .foregroundStyle(tint)
                    .frame(width: 40, height: 40)
                    .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(Theme.body(14, .semibold)).foregroundStyle(Theme.foreground)
                    Text(blurb).font(Theme.body(12)).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
            }
            .padding(12)
            .background(Theme.surfaceAlt.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        }
        .disabled(!enabled || exporting != nil)
        .opacity(enabled ? 1 : 0.5)
    }

    private func downloadExport(format: String) {
        exporting = format; exportError = nil
        Task {
            defer { exporting = nil }
            do {
                var req = URLRequest(url: APIClient.baseURL.appending(path: "api/v1/export")
                    .appending(queryItems: [URLQueryItem(name: "format", value: format)]))
                if let token = Keychain.accessToken {
                    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
                let (data, response) = try await URLSession.shared.data(for: req)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    exportError = "Export failed — try again."
                    return
                }
                let stamp = ISO8601DateFormatter().string(from: .now).prefix(10)
                let name = format == "json" ? "tbra-export-\(stamp).json" : "tbra-library-\(stamp).csv"
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
                try data.write(to: url)
                exportURL = url
            } catch {
                exportError = "Export failed — try again."
            }
        }
    }

    // ── 6. Hidden books ──
    private var hiddenBooksSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) {
                    openSection = openSection == "hidden" ? nil : "hidden"
                }
            } label: {
                HStack {
                    SectionHeading("Hidden Books (\(model.hiddenBooks.count))")
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(openSection == "hidden" ? 180 : 0))
                }
            }
            if openSection == "hidden" {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Hidden from all recommendations. Unhide to see them again.")
                        .font(Theme.body(13)).foregroundStyle(Theme.muted)
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
                .padding(.top, 12)
            }
        }
    }

    // ── 7. Change password ──
    private var passwordSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Change Password")
            passwordField("Current password", placeholder: "Your current password", text: $currentPassword)
            passwordField("New password", placeholder: "At least 8 characters", text: $newPassword)
            passwordField("Confirm new password", placeholder: "Repeat the new password", text: $confirmPassword)
            if let msg = passwordMessage {
                Text(msg.text)
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(msg.isError ? Theme.destructive : Theme.accentText)
            }
            Button {
                changePassword()
            } label: {
                // Black on lime — same rule as the web button.
                Text(passwordBusy ? "Updating…" : "Update password")
                    .font(Theme.body(14, .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
            }
            .disabled(passwordBusy || currentPassword.isEmpty || newPassword.isEmpty || confirmPassword.isEmpty)
        }
    }

    private func passwordField(_ label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(Theme.body(13, .semibold)).foregroundStyle(Theme.foreground)
            SecureField(placeholder, text: text)
                .font(Theme.body(14))
                .textContentType(.password)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
        }
    }

    private func changePassword() {
        passwordBusy = true; passwordMessage = nil
        Task {
            defer { passwordBusy = false }
            struct Ok: Codable { let ok: Bool }
            do {
                let _: Ok = try await APIClient.shared.request(
                    "/api/v1/settings/password", method: "POST",
                    body: ["currentPassword": currentPassword,
                           "newPassword": newPassword,
                           "confirmNewPassword": confirmPassword])
                passwordMessage = ("Password updated.", false)
                currentPassword = ""; newPassword = ""; confirmPassword = ""
            } catch {
                passwordMessage = ((error as? APIError)?.errorDescription ?? "Couldn't update password.", true)
            }
        }
    }

    // ── 8. Account + 9. Danger zone ──
    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Account").font(Theme.heading(17, .bold)).foregroundStyle(Theme.foreground)
            Text(model.email).font(Theme.body(14)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }

    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Danger Zone")
                .font(Theme.heading(19, .bold))
                .foregroundStyle(Theme.foreground)
                .padding(.bottom, 12)
            VStack(spacing: 0) {
                ForEach(Array(DangerAction.all.enumerated()), id: \.element.key) { index, action in
                    if index > 0 { Divider().background(Theme.destructive.opacity(0.15)) }
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(action.title).font(Theme.body(14, .semibold)).foregroundStyle(Theme.foreground)
                            Text(action.blurb).font(Theme.body(12)).foregroundStyle(Theme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        Button(action.buttonLabel) { dangerAction = action }
                            .font(Theme.body(13, .semibold))
                            .foregroundStyle(Theme.destructive)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.destructive.opacity(0.6), lineWidth: 1.5))
                    }
                    .padding(14)
                }
            }
            .background(Theme.destructive.opacity(0.03))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.destructive.opacity(0.3), lineWidth: 1))
        }
    }
}

// ── Danger zone plumbing ──

struct DangerAction: Identifiable {
    let key: String
    let title: String
    let blurb: String
    let buttonLabel: String
    let phrase: String
    var id: String { key }

    static let all: [DangerAction] = [
        .init(key: "reset-library", title: "Reset Library",
              blurb: "Permanently deletes all your books, ratings, reviews, reading sessions, notes, goals, favorites, and reading progress. Your account and profile will be kept.",
              buttonLabel: "Reset Library", phrase: "reset my library"),
        .init(key: "delete-account", title: "Delete Account",
              blurb: "Permanently deletes your account and all associated data. This cannot be undone.",
              buttonLabel: "Delete Account", phrase: "delete my account"),
        .init(key: "delete-tbr", title: "Delete TBR Pile",
              blurb: "Removes all books marked as 'to be read' and clears your Up Next queue.",
              buttonLabel: "Delete TBR", phrase: "delete tbr"),
        .init(key: "delete-owned", title: "Delete Owned Books",
              blurb: "Clears all owned edition records and format selections from your library.",
              buttonLabel: "Delete Owned", phrase: "delete owned"),
    ]
}

struct DangerConfirmSheet: View {
    let action: DangerAction
    let onDone: (Bool) -> Void
    @State private var input = ""
    @State private var busy = false
    @State private var error: String?

    private var confirmed: Bool {
        input.lowercased().trimmingCharacters(in: .whitespaces) == action.phrase
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(action.title)
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.destructive)
            Text(action.blurb)
                .font(Theme.body(14))
                .foregroundStyle(Theme.foreground.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Text("This action is permanent and cannot be undone.")
                .font(Theme.body(13, .semibold))
                .foregroundStyle(Theme.destructive)
            Text("Type \u{201C}\(action.phrase)\u{201D} to confirm:")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
            TextField(action.phrase, text: $input)
                .font(Theme.body(15))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            if let error {
                Text(error).font(Theme.body(13)).foregroundStyle(Theme.destructive)
            }
            HStack(spacing: 12) {
                Button("Cancel") { onDone(false) }
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.muted)
                Spacer()
                Button {
                    run()
                } label: {
                    Text(busy ? "Working…" : "Confirm \(action.buttonLabel)")
                        .font(Theme.body(14, .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(confirmed ? Theme.destructive : Theme.destructive.opacity(0.3),
                                    in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(!confirmed || busy)
            }
            .padding(.top, 4)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bg)
    }

    private func run() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            struct Ok: Codable { let ok: Bool }
            do {
                let _: Ok = try await APIClient.shared.request(
                    "/api/v1/settings/danger", method: "POST",
                    body: ["action": action.key, "confirm": input])
                onDone(true)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Something went wrong."
            }
        }
    }
}

/// UIActivityViewController wrapper for the export share sheet.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
