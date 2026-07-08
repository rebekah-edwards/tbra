import SwiftUI

// Discover — recreates /discover (discover-client.tsx): "Find Your Next
// Read" + info bubble, the 14-mood tinted grid, Fiction/Non-fiction/Both,
// How long?, Audience, Search in (lime active), the two toggle pills,
// the lime Find Books CTA, and the results grid.

struct Mood: Identifiable, Hashable {
    let key: String
    let label: String
    let emoji: String
    let tint: Color
    var id: String { key }
}

// mood-genre-map.ts moods + MOOD_TINTS (Tailwind-500 hexes)
let ALL_MOODS: [Mood] = [
    Mood(key: "cozy", label: "Cozy", emoji: "☕", tint: Color(hex: "f59e0b")),
    Mood(key: "dark", label: "Dark & Gritty", emoji: "🌑", tint: Color(hex: "64748b")),
    Mood(key: "thrilling", label: "Thrilling", emoji: "⚡", tint: Color(hex: "eab308")),
    Mood(key: "romantic", label: "Romantic", emoji: "💕", tint: Color(hex: "ec4899")),
    Mood(key: "funny", label: "Funny", emoji: "😂", tint: Color(hex: "f97316")),
    Mood(key: "emotional", label: "Emotional", emoji: "😢", tint: Color(hex: "f43f5e")),
    Mood(key: "adventurous", label: "Adventurous", emoji: "🗺️", tint: Color(hex: "10b981")),
    Mood(key: "mindblowing", label: "Mind-bending", emoji: "🤯", tint: Color(hex: "8b5cf6")),
    Mood(key: "spooky", label: "Spooky", emoji: "👻", tint: Color(hex: "a855f7")),
    Mood(key: "inspiring", label: "Inspiring", emoji: "✨", tint: Color(hex: "84cc16")),
    Mood(key: "informative", label: "Informative", emoji: "🧠", tint: Color(hex: "06b6d4")),
    Mood(key: "fantastical", label: "Fantastical", emoji: "🐉", tint: Color(hex: "6366f1")),
    Mood(key: "historical", label: "Historical", emoji: "🏛️", tint: Color(hex: "b45309")),
    Mood(key: "sciencey", label: "Science-y", emoji: "🔬", tint: Color(hex: "14b8a6")),
]

@MainActor
@Observable
final class DiscoverModel {
    var moods: Set<String> = []
    var fictionFilter: String? = nil       // fiction | nonfiction | both
    var length: String? = nil              // short | medium | long
    var audience: String? = nil            // adult | ya | teen | mg | any
    var libraryFilter: String? = nil       // nil = All Books | tbr | owned
    var seriesStartersOnly = false
    var ignorePreferences = false

    var results: [LiteBook] = []
    var reasons: [String: String] = [:]
    var searching = false
    var searched = false

    func find() async {
        searching = true; defer { searching = false }
        var body: [String: Any] = [
            "moods": Array(moods),
            "seriesStartersOnly": seriesStartersOnly,
            "ignorePreferences": ignorePreferences,
        ]
        if let fictionFilter { body["fictionFilter"] = fictionFilter }
        if let length { body["length"] = length }
        if let audience { body["audience"] = audience }
        if let libraryFilter { body["libraryFilter"] = libraryFilter }

        if let found = try? await APIClient.shared.discover(body: body) {
            results = found.books
            reasons = found.reasons
            searched = true
        }
    }
}

struct DiscoverRootView: View {
    @Binding var path: NavigationPath
    var body: some View {
        NavigationStack(path: $path) {
            DiscoverView()
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
        }
    }
}

struct DiscoverView: View {
    @State private var model = DiscoverModel()

    private let moodColumns = [
        GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12),
    ]
    private let resultColumns = [
        GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16),
    ]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 10) {
                        Text("Find Your Next Read")
                            .font(Theme.heading(26, .bold))
                            .foregroundStyle(Theme.foreground)
                        InfoBubble(text: "Select one or more moods to describe what you're looking for. We'll match books based on genre overlap, content tone, and your reading preferences. Length filters nudge results toward your preferred page count.")
                    }
                    .padding(.top, 20)

                    Text("Select moods, set your filters, and we'll find books to match.")
                        .font(Theme.body(17))
                        .foregroundStyle(Theme.muted)

                    sectionLabel("What are you in the mood for?")
                    LazyVGrid(columns: moodColumns, spacing: 12) {
                        ForEach(ALL_MOODS) { mood in
                            moodCard(mood)
                        }
                    }

                    sectionLabel("Fiction or non-fiction?")
                    HStack(spacing: 10) {
                        choicePill("Fiction", selected: model.fictionFilter == "fiction") { toggleChoice(\.fictionFilter, "fiction") }
                        choicePill("Non-fiction", selected: model.fictionFilter == "nonfiction") { toggleChoice(\.fictionFilter, "nonfiction") }
                        choicePill("Both", selected: model.fictionFilter == "both") { toggleChoice(\.fictionFilter, "both") }
                    }
                    .frame(maxWidth: .infinity)

                    sectionLabel("How long?")
                    HStack(spacing: 10) {
                        lengthCard("Quick read", "Under 250 pages", key: "short")
                        lengthCard("Standard", "250–400 pages", key: "medium")
                        lengthCard("Epic", "400+ pages", key: "long")
                    }

                    sectionLabel("Audience")
                    FlowLayout(spacing: 10) {
                        choicePill("Adult", selected: model.audience == "adult") { toggleChoice(\.audience, "adult") }
                        choicePill("Young Adult", selected: model.audience == "ya") { toggleChoice(\.audience, "ya") }
                        choicePill("Teen", selected: model.audience == "teen") { toggleChoice(\.audience, "teen") }
                        choicePill("Middle Grade", selected: model.audience == "mg") { toggleChoice(\.audience, "mg") }
                        choicePill("Any", selected: model.audience == "any") { toggleChoice(\.audience, "any") }
                    }

                    sectionLabel("Search in")
                    HStack(spacing: 10) {
                        searchInPill("All Books", key: nil)
                        searchInPill("My TBR", key: "tbr")
                        searchInPill("Books I Own", key: "owned")
                    }

                    VStack(spacing: 10) {
                        togglePill("Series starters only", icon: "book", isOn: Bindable(model).seriesStartersOnly)
                        togglePill("Ignore my preferences", icon: "nosign", isOn: Bindable(model).ignorePreferences)
                    }
                    .frame(maxWidth: .infinity)

                    Button {
                        Task {
                            await model.find()
                            withAnimation { proxy.scrollTo("results", anchor: .top) }
                        }
                    } label: {
                        if model.searching { ProgressView().tint(Theme.onAccent) } else { Text("Find Books") }
                    }
                    .buttonStyle(AccentButtonStyle())

                    if model.searched {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeading(model.results.isEmpty ? "No matches" : "Your Matches")
                                .id("results")
                            if model.results.isEmpty {
                                Text("Try fewer moods or looser filters.")
                                    .font(Theme.body(14))
                                    .foregroundStyle(Theme.muted)
                            } else {
                                LazyVGrid(columns: resultColumns, alignment: .leading, spacing: 18) {
                                    ForEach(model.results) { book in
                                        NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                                            VStack(alignment: .leading, spacing: 5) {
                                                BookCardMini(book: book)
                                                if let reason = model.reasons[book.id], !reason.isEmpty {
                                                    Text(reason)
                                                        .font(Theme.body(9, .medium))
                                                        .tracking(0.5)
                                                        .foregroundStyle(Theme.accent)
                                                        .lineLimit(2)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        #if DEBUG && targetEnvironment(simulator)
        .task {
            // Headless verification: auto-select a mood + run the search.
            if ProcessInfo.processInfo.environment["TBRA_DEBUG_DISCOVER"] != nil {
                model.moods = ["fantastical"]
                await model.find()
            }
        }
        #endif
    }

    private func toggleChoice(_ keyPath: ReferenceWritableKeyPath<DiscoverModel, String?>, _ value: String) {
        model[keyPath: keyPath] = model[keyPath: keyPath] == value ? nil : value
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(Theme.body(17, .semibold))
            .foregroundStyle(Theme.foreground.opacity(0.85))
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
    }

    private func moodCard(_ mood: Mood) -> some View {
        let selected = model.moods.contains(mood.key)
        return Button {
            withAnimation(.easeOut(duration: 0.12)) {
                if selected { model.moods.remove(mood.key) } else { model.moods.insert(mood.key) }
            }
        } label: {
            VStack(spacing: 6) {
                Text(mood.emoji).font(.system(size: 24))
                Text(mood.label)
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(selected ? Theme.foreground : Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(mood.tint.opacity(selected ? 0.25 : 0.08))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14)
                .stroke(mood.tint.opacity(selected ? 0.55 : 0.2), lineWidth: selected ? 1.5 : 1))
        }
    }

    private func choicePill(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.body(16, .medium))
                .foregroundStyle(selected ? Theme.accentText : Theme.muted)
                .padding(.horizontal, 18).padding(.vertical, 11)
                .background(selected ? Theme.accent.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12)
                    .stroke(selected ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: selected ? 1.5 : 1))
        }
    }

    private func lengthCard(_ title: String, _ sub: String, key: String) -> some View {
        let selected = model.length == key
        return Button {
            model.length = selected ? nil : key
        } label: {
            VStack(spacing: 3) {
                Text(title)
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(selected ? Theme.accent : Theme.foreground.opacity(0.85))
                Text(sub)
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(selected ? Theme.accent.opacity(0.10) : .clear, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14)
                .stroke(selected ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: selected ? 1.5 : 1))
        }
    }

    private func searchInPill(_ label: String, key: String?) -> some View {
        let selected = model.libraryFilter == key
        return Button {
            model.libraryFilter = key
        } label: {
            Text(label)
                .font(Theme.body(15, .medium))
                .foregroundStyle(selected ? Theme.accentText : Theme.muted)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .frame(maxWidth: .infinity)
                .background(selected ? Theme.accent.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14)
                    .stroke(selected ? Theme.accent : Theme.border, lineWidth: selected ? 2 : 1))
        }
    }

    private func togglePill(_ label: String, icon: String, isOn: Binding<Bool>) -> some View {
        Button {
            isOn.wrappedValue.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13))
                Text(label).font(Theme.body(15, .medium))
            }
            .foregroundStyle(isOn.wrappedValue ? Theme.accentText : Theme.muted)
            .padding(.horizontal, 20).padding(.vertical, 11)
            .background(isOn.wrappedValue ? Theme.accent.opacity(0.10) : .clear, in: Capsule())
            .overlay(Capsule().stroke(isOn.wrappedValue ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: 1))
        }
    }
}
