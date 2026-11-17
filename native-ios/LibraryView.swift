import SwiftUI

// My Library — recreates /library (library-client.tsx): header + stats,
// the My Shelves row card, the TBR/Activity/Owned segmented control,
// per-group sub-filter chips with counts, and the 3-column book grid.
// Grouping/filter/sort logic is ported line-for-line from the web client.
//
// Deferred (manifest): the advanced Filters expander (year/genre/rating/
// format) and sort menu — the "Filters ⌄" row renders as the entry point.

struct ShelvesListRoute: Hashable {}

/// Push a shelf's page. `ownerName`/`editing` distinguish the Following tab
/// (someone else's shelf, read-only) and the card-pencil edit shortcut.
struct ShelfRoute: Hashable {
    let shelfId: String
    var ownerName: String? = nil
    var editing: Bool = false
}

struct LibraryRootView: View {
    @Binding var path: NavigationPath
    var body: some View {
        NavigationStack(path: $path) {
            LibraryView()
                .pushedScreenChrome()
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: ShelvesListRoute.self) { _ in
                    LibraryShelvesView()
                        .pushedScreenChrome()
                }
                // ShelfRoute now lives in appDestinations() so every stack can
                // push a shelf (public profiles gained "View shelf" buttons).
                .appDestinations()
        }
    }
}

@MainActor
@Observable
final class LibraryModel {
    var books: [LibraryBook] = []
    var error: String?
    var loading = false
    /// Set after the first successful load so the view can tell "never loaded"
    /// (let .task do it) from "returning to a view that already has data"
    /// (needs a refresh — see the .onAppear in LibraryView).
    private(set) var hasLoaded = false

    func load() async {
        loading = true; defer { loading = false }
        do { books = try await APIClient.shared.library(); hasLoaded = true }
        catch {
            // Pushing a screen over this one cancels the in-flight .task —
            // that's not an error the user should see on the way back.
            guard !APIError.isCancellation(error) else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load your library."
        }
    }
}

/// "Search within my own library" — the Swift twin of
/// src/lib/library-search.ts. KEEP THE TWO IN STEP: same folding, same
/// every-word-must-appear rule, same initials handling, so a query finds
/// the same books on the site and in the app.
///   1. Fold both sides: compatibility-decompose, lowercase, strip
///      diacritics, drop apostrophes and periods, turn every other run of
///      punctuation into one space.
///   2. A book matches when EVERY query word appears somewhere in its
///      title + authors + series names.
///   3. Runs of single letters are also indexed joined, so "aa milne",
///      "a a milne" and "a.a. milne" all find A. A. Milne.
enum LibrarySearch {
    private static let specialFolds: [Unicode.Scalar: String] = [
        "ø": "o", "đ": "d", "ð": "d", "ł": "l", "ı": "i", "ß": "ss",
        "æ": "ae", "œ": "oe", "þ": "th", "ς": "σ",
    ]
    private static let dropped: Set<Unicode.Scalar> = ["'", "\u{2019}", "\u{2018}", "`", "."]

    static func fold(_ input: String) -> String {
        var out = String.UnicodeScalarView()
        var needSpace = false
        for scalar in input.decomposedStringWithCompatibilityMapping.lowercased().unicodeScalars {
            switch scalar.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark:
                continue
            default: break
            }
            if dropped.contains(scalar) { continue }
            let replacement = specialFolds[scalar]
            let isWordChar: Bool
            switch scalar.properties.generalCategory {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
                 .decimalNumber, .letterNumber, .otherNumber:
                isWordChar = true
            default:
                isWordChar = false
            }
            guard isWordChar || replacement != nil else { needSpace = true; continue }
            if needSpace && !out.isEmpty { out.append(" ") }
            needSpace = false
            if let replacement { out.append(contentsOf: replacement.unicodeScalars) } else { out.append(scalar) }
        }
        return String(out)
    }

    static func searchText(title: String, authors: [String], seriesNames: [String]) -> String {
        let folded = fold(([title] + authors + seriesNames).joined(separator: " "))
        var initials: [String] = []
        var run = ""
        for word in folded.split(separator: " ") {
            if word.count == 1 {
                run += word
            } else {
                if run.count > 1 { initials.append(run) }
                run = ""
            }
        }
        if run.count > 1 { initials.append(run) }
        return initials.isEmpty ? folded : folded + " " + initials.joined(separator: " ")
    }

    /// Folded query words; empty when the query is blank or punctuation-only.
    static func tokens(_ query: String) -> [String] {
        fold(query).split(separator: " ").map(String.init)
    }

    static func matches(_ searchText: String, _ tokens: [String]) -> Bool {
        tokens.allSatisfy { searchText.contains($0) }
    }

    /// Per-book folded text, built once and reused across keystrokes. Keyed
    /// by id AND title so an edited title can't serve a stale entry.
    final class Index {
        private var cache: [String: String] = [:]
        func text(for book: LibraryBook) -> String {
            let key = book.id + "\u{1F}" + book.title
            if let hit = cache[key] { return hit }
            let text = LibrarySearch.searchText(title: book.title, authors: book.authors,
                                                seriesNames: book.seriesNames ?? [])
            cache[key] = text
            return text
        }
    }
}

struct LibraryView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(ChromeState.self) private var chrome: ChromeState?
    @State private var model = LibraryModel()
    // TBRA_DEBUG_ROUTE=library:activity lands on the Activity tab so the
    // agent can screenshot it headless (sim-only, like AppShell's hook).
    @State private var group: Group = {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.environment["TBRA_DEBUG_ROUTE"] == "library:activity" {
            return .activity
        }
        #endif
        return .tbr
    }()
    @State private var subFilter: String = {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.environment["TBRA_DEBUG_ROUTE"] == "library:activity" {
            return "currently_reading"
        }
        #endif
        return "all"
    }()

    // A stat-pill deep-link's sub-filter. Setting `group` and `subFilter`
    // together in onAppear doesn't work: .onChange(of: group) fires after and
    // stomps subFilter back to the group default, which sent "Read" taps to
    // "Current Read" instead of "Finished". onChange consumes this instead.
    @State private var pendingSubFilter: String?
    /// Same one-shot, for a deep-link that also names a completion year (the
    /// Home goal tile). Applied after the group change clears the filters.
    @State private var pendingYearFilter: Int?

    // In-library search (refreshed header). Matches title or author.
    @State private var searchActive = false
    @State private var searchText = ""
    @State private var searchIndex = LibrarySearch.Index()
    @FocusState private var searchFocused: Bool

    // Advanced filters (web: the collapsible Filters panel, TBR + Activity)
    @State private var filtersOpen = false
    @State private var sort: SortKey = .recent
    @State private var yearFilter: Int?
    @State private var genreFilter: String?
    @State private var minRating = 0
    @State private var fictionFilter: String?   // "fiction" | "nonfiction"
    @State private var formatFilter: String?

    enum Group: String, CaseIterable {
        case tbr = "TBR", activity = "Activity", owned = "Owned"
    }

    enum SortKey: String, CaseIterable {
        case recent = "Recently Updated"
        case title = "Title A-Z"
        case author = "Author A-Z"
        case rating = "Highest Rated"
    }

    // SUB_FILTERS from library-client.tsx
    private var subFilters: [(key: String, label: String)] {
        switch group {
        case .activity:
            return [("currently_reading", "Current Read"), ("completed", "Finished"),
                    ("paused", "Paused"), ("dnf", "DNF")]
        case .tbr:
            return [("all", "All"), ("owned", "Owned"), ("not_owned", "Not Owned"),
                    ("fiction", "Fiction"), ("nonfiction", "Non-Fiction"),
                    ("flagged", "⚠ Flagged")]
        case .owned:
            return [("all", "All"), ("hardcover", "Hardcover"), ("paperback", "Paperback"),
                    ("ebook", "eBook"), ("audiobook", "Audiobook")]
        }
    }

    private var columns: [GridItem] {
        [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if DesignPreview.on {
                    headerV2
                    groupSegmentsV2
                    toolbarRowV2
                    if filtersOpen && showAdvanced && !searchActive { filtersPanel }
                    if !showAdvanced && filteredBooks.count > 1 && !searchActive {
                        HStack { Spacer(); sortMenu(includeRating: false) }
                    }
                    content
                } else {
                header

                // My Shelves row card
                NavigationLink(value: ShelvesListRoute()) {
                    HStack(spacing: 12) {
                        Image(systemName: "books.vertical.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.accent)
                        Text("My Shelves")
                            .font(Theme.body(17, .semibold))
                            .foregroundStyle(Theme.foreground)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
                }

                groupSegments
                subFilterChips
                filtersRow

                content
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .tracksScrollAtTop()
        .refreshable { await model.load() }
        .task { await model.load() }
        .onAppear {
            // Refresh when returning to a view that already has data. SwiftUI's
            // .task runs ONCE per view lifetime, and it does not re-run when you
            // navigate back to an existing view — so opening a book, changing its
            // owned formats, and coming back left this list rendering pre-change
            // data. The book kept appearing under "Not Owned" while its own detail
            // page said "you own 1 copy" (reported 2026-07-27 for Every Exquisite
            // Thing). The owned/not-owned filters are exact complements, so a book
            // in both places is always a staleness bug, never a filter bug.
            //
            // Guarded on hasLoaded so this does not double-fetch on first appear,
            // where .task is already loading.
            if model.hasLoaded { Task { await model.load() } }

            // Consume a one-shot deep-link from the profile stat pills
            // (Read → Activity/Finished, Reading → Activity/Current, TBR).
            if let sel = chrome?.pendingLibrarySelection {
                let newGroup: Group
                switch sel.group {
                case "activity": newGroup = .activity
                case "owned": newGroup = .owned
                default: newGroup = .tbr
                }
                // A deep-link is a fresh view of the library, not a
                // refinement of whatever search was left open.
                searchText = ""
                searchActive = false
                if newGroup == group {
                    // No group change → onChange won't fire; apply directly.
                    subFilter = sel.filter
                    clearAdvancedFilters()
                    yearFilter = sel.year
                    filtersOpen = sel.year != nil
                } else {
                    // Group change → let .onChange(of: group) apply the filter,
                    // otherwise it overwrites it with the group default.
                    pendingSubFilter = sel.filter
                    pendingYearFilter = sel.year
                    group = newGroup
                }
                chrome?.pendingLibrarySelection = nil
            }
        }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onChange(of: group) {
            if let pending = pendingSubFilter {
                subFilter = pending
                pendingSubFilter = nil
            } else {
                subFilter = group == .activity ? "currently_reading" : "all"
            }
            clearAdvancedFilters()
            // A year from a deep-link is shown, not just applied: the panel
            // opens so "Year: 2026" is on screen and the short list explains
            // itself.
            yearFilter = pendingYearFilter
            filtersOpen = pendingYearFilter != nil
            pendingYearFilter = nil
        }
    }

    private var avatarUrl: String? {
        if case .signedIn(let user) = auth.phase { return user.avatarUrl }
        return nil
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("My Library")
                .font(Theme.heading(26, .bold))
                .foregroundStyle(Theme.foreground)
            Spacer()
            Text("\(ownedCount) owned · \(readCount) read · \(tbrCount) tbr")
                .font(Theme.body(12))
                .foregroundStyle(Theme.muted)
        }
    }

    // ── Refreshed header (2026-11) ──────────────────────────────────────
    // v1 stacked five rows above the first cover: title+counts, My Shelves,
    // the group switch, the sub-filter chips, and Filters. v2 is three:
    //   1. title + a Shelves pill (was a full-width row)
    //   2. the group switch, now carrying the counts
    //   3. ONE toolbar: search · filters · sub-filter chips
    // Search filters the books already in memory, so it is instant and
    // works offline; it scopes to the tab and sub-filter on screen.
    private var headerV2: some View {
        HStack(alignment: .center) {
            Text("My Library")
                .font(Theme.heading(26, .bold))
                .foregroundStyle(Theme.foreground)
            Spacer()
            NavigationLink(value: ShelvesListRoute()) {
                HStack(spacing: 6) {
                    Image(systemName: "books.vertical.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.accentText)
                    Text("Shelves").font(Theme.body(14, .semibold))
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.muted)
                }
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .glassEffect(.regular, in: Capsule())
            }
        }
    }

    private func groupCount(_ g: Group) -> Int? {
        switch g {
        case .tbr: return tbrCount
        case .owned: return ownedCount
        case .activity: return nil
        }
    }

    private var groupSegmentsV2: some View {
        HStack(spacing: 4) {
            ForEach(Group.allCases, id: \.self) { g in
                let active = group == g
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { group = g }
                } label: {
                    HStack(spacing: 6) {
                        Text(g.rawValue)
                            .font(Theme.body(15, active ? .bold : .medium))
                        if let n = groupCount(g) {
                            Text("\(n)")
                                .font(Theme.body(12, .semibold))
                                .opacity(active ? 0.6 : 0.7)
                        }
                    }
                    .foregroundStyle(active ? Theme.onAccent : Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(active ? Theme.accent : .clear, in: Capsule())
                }
            }
        }
        .padding(4)
        .glassEffect(.regular, in: Capsule())
    }

    private func toolbarCircle(_ icon: String, active: Bool, badge: Int = 0,
                               action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(active ? Theme.accentText : Theme.foreground)
                .frame(width: 40, height: 40)
                .glassEffect(.regular, in: Circle())
                .overlay(Circle().stroke(active ? Theme.accent.opacity(0.7) : .clear, lineWidth: 1.5))
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Text("\(badge)")
                            .font(Theme.body(10, .bold))
                            .foregroundStyle(Theme.onAccent)
                            .frame(width: 16, height: 16)
                            .background(Theme.accent, in: Circle())
                            .offset(x: 3, y: -3)
                    }
                }
        }
    }

    @ViewBuilder private var toolbarRowV2: some View {
        if searchActive {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                    TextField("Title, author or series", text: $searchText)
                        .font(Theme.body(16))
                        .foregroundStyle(Theme.foreground)
                        .focused($searchFocused)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                    if !searchText.isEmpty {
                        // 36pt target around a 17pt glyph: a simulator tap on
                        // the bare glyph missed, and a thumb would too.
                        Button { searchText = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(Theme.muted)
                                .frame(width: 36, height: 36)
                                .contentShape(Rectangle())
                        }
                        .padding(.trailing, -10)
                        .accessibilityLabel("Clear search")
                    }
                }
                .padding(.horizontal, 14)
                .frame(height: 40)
                .glassEffect(.regular, in: Capsule())

                Button("Cancel") {
                    searchText = ""
                    searchFocused = false
                    withAnimation(.easeOut(duration: 0.15)) { searchActive = false }
                }
                .font(Theme.body(15, .medium))
                .foregroundStyle(Theme.neonBlue)
            }
        } else {
            HStack(spacing: 8) {
                toolbarCircle("magnifyingglass", active: false) {
                    withAnimation(.easeOut(duration: 0.15)) { searchActive = true }
                    searchFocused = true
                }
                .accessibilityLabel("Search library")
                if showAdvanced {
                    toolbarCircle("line.3.horizontal.decrease", active: filtersOpen,
                                  badge: advancedFilterCount) {
                        withAnimation(.easeOut(duration: 0.15)) { filtersOpen.toggle() }
                    }
                    .accessibilityLabel("Filters")
                }
                subFilterChipsV2
            }
        }
    }

    private var subFilterChipsV2: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(subFilters, id: \.key) { key, label in
                    let active = subFilter == key
                    Button { subFilter = key } label: {
                        HStack(spacing: 5) {
                            Text(label).font(Theme.body(14, active ? .semibold : .medium))
                            Text("\(countFor(key))").font(Theme.body(12)).opacity(0.6)
                        }
                        .foregroundStyle(active ? Theme.foreground : Theme.muted)
                        .padding(.horizontal, 14)
                        .frame(height: 40)
                        .background(active ? Theme.foreground.opacity(0.10) : .clear, in: Capsule())
                        .overlay(Capsule().stroke(active ? Theme.foreground.opacity(0.35) : Theme.border,
                                                  lineWidth: 1))
                    }
                }
            }
            .padding(.vertical, 2)
            .padding(.trailing, 20)
        }
        .padding(.trailing, -20)   // chips run off the trailing edge
    }

    private var ownedCount: Int { model.books.filter { !$0.ownedFormats.isEmpty }.count }
    private var readCount: Int { model.books.filter { $0.state == "completed" }.count }
    private var tbrCount: Int { model.books.filter { $0.state == "tbr" }.count }

    private var groupSegments: some View {
        HStack(spacing: 4) {
            ForEach(Group.allCases, id: \.self) { g in
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { group = g }
                } label: {
                    Text(g.rawValue)
                        .font(Theme.body(16, group == g ? .bold : .medium))
                        .foregroundStyle(group == g ? .black : Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(group == g ? Theme.accent : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(4)
        .background(Theme.surfaceAlt.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var subFilterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(subFilters, id: \.key) { key, label in
                    let active = subFilter == key
                    let count = countFor(key)
                    Button {
                        subFilter = key
                    } label: {
                        HStack(spacing: 6) {
                            Text(label)
                                .font(Theme.body(15, .medium))
                                .foregroundStyle(active ? Theme.neonBlue : Theme.muted)
                            Text("\(count)")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.muted.opacity(0.7))
                        }
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .background(Capsule().stroke(active ? Theme.neonBlue : Theme.border,
                                                     lineWidth: active ? 1.5 : 1))
                        .background((active ? Theme.neonBlue.opacity(0.08) : Theme.surfaceAlt.opacity(0.4)), in: Capsule())
                    }
                }
            }
            // The stroke draws half its width OUTSIDE the capsule — without
            // breathing room the ScrollView clips it into flat edges.
            .padding(.vertical, 2)
            .padding(.horizontal, 20)
        }
        // Full-bleed scroll (chips slide edge-to-edge past the page margin).
        .padding(.horizontal, -20)
    }

    // Which tabs get the advanced panel (web: activity + tbr only).
    private var showAdvanced: Bool { group != .owned }

    private var advancedFilterCount: Int {
        [yearFilter != nil, genreFilter != nil, minRating > 0,
         fictionFilter != nil, formatFilter != nil].filter { $0 }.count
    }

    private func clearAdvancedFilters() {
        yearFilter = nil; genreFilter = nil; minRating = 0
        fictionFilter = nil; formatFilter = nil
    }

    @ViewBuilder private var filtersRow: some View {
        if showAdvanced {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { filtersOpen.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "line.3.horizontal.decrease")
                            .font(.system(size: 14))
                        Text("Filters")
                            .font(Theme.body(16))
                        if advancedFilterCount > 0 {
                            // accentText, NOT accent: the count was rendering
                            // lime-on-lime in light mode (user report 2026-07-22).
                            Text("\(advancedFilterCount)")
                                .font(Theme.body(11, .medium))
                                .foregroundStyle(Theme.accentText)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Theme.accent.opacity(0.2), in: Capsule())
                        }
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .rotationEffect(.degrees(filtersOpen ? 180 : 0))
                    }
                    .foregroundStyle(Theme.muted)
                }

                if filtersOpen { filtersPanel }
            }
        } else if filteredBooks.count > 1 {
            // Owned tab: standalone sort control (web parity).
            HStack {
                Spacer()
                sortMenu(includeRating: false)
            }
        }
    }

    private var filtersPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            FlowLayout(spacing: 8) {
                if group == .activity && !availableYears.isEmpty {
                    dropdown("Year", value: yearFilter.map(String.init) ?? "All Years") {
                        Button("All Years") { yearFilter = nil }
                        ForEach(availableYears, id: \.self) { y in
                            Button(String(y)) { yearFilter = y }
                        }
                    }
                }
                dropdown("Type", value: fictionFilter == "fiction" ? "Fiction"
                         : fictionFilter == "nonfiction" ? "Non-Fiction" : "All Types") {
                    Button("All Types") { fictionFilter = nil }
                    Button("Fiction") { fictionFilter = "fiction" }
                    Button("Non-Fiction") { fictionFilter = "nonfiction" }
                }
                dropdown("Format", value: formatFilter.map(formatLabel) ?? "All Formats") {
                    Button("All Formats") { formatFilter = nil }
                    ForEach(["hardcover", "paperback", "ebook", "audiobook"], id: \.self) { f in
                        Button(formatLabel(f)) { formatFilter = f }
                    }
                }
                sortMenu(includeRating: showRatingSort)
            }

            if group == .activity && (subFilter == "completed" || subFilter == "dnf") {
                HStack(spacing: 8) {
                    Text("Min rating:")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                    ForEach(1...5, id: \.self) { star in
                        Button {
                            minRating = minRating == star ? 0 : star
                        } label: {
                            Image(systemName: "star.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(star <= minRating ? .yellow : Theme.muted.opacity(0.35))
                        }
                    }
                }
            }

            if !availableGenres.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Genre")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            genrePill("All", active: genreFilter == nil) { genreFilter = nil }
                            ForEach(availableGenres.prefix(20), id: \.name) { g in
                                genrePill("\(g.name)  \(g.count)", active: genreFilter == g.name) {
                                    genreFilter = genreFilter == g.name ? nil : g.name
                                }
                            }
                        }
                        .padding(.vertical, 1)
                    }
                }
            }

            if advancedFilterCount > 0 {
                Button {
                    clearAdvancedFilters()
                } label: {
                    Text("Clear all filters")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.destructive)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
    }

    private var showRatingSort: Bool { group == .activity && subFilter == "completed" }

    private func formatLabel(_ f: String) -> String {
        switch f {
        case "hardcover": return "Hardcover"
        case "paperback": return "Paperback"
        case "ebook": return "eBook"
        case "audiobook": return "Audiobook"
        default: return f
        }
    }

    private func dropdown(_ title: String, value: String,
                          @ViewBuilder content: () -> some View) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 6) {
                Text(value)
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(Theme.foreground)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
        }
    }

    private func sortMenu(includeRating: Bool) -> some View {
        dropdown("Sort", value: sort.rawValue) {
            ForEach(SortKey.allCases.filter { includeRating || $0 != .rating }, id: \.self) { key in
                Button(key.rawValue) { sort = key }
            }
        }
    }

    private func genrePill(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.body(11, .medium))
                .foregroundStyle(active ? Theme.neonBlue : Theme.muted)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(active ? Theme.neonBlue.opacity(0.2) : Theme.surfaceAlt, in: Capsule())
                .overlay(Capsule().stroke(active ? Theme.neonBlue.opacity(0.3) : .clear, lineWidth: 1))
        }
    }

    private var availableYears: [Int] {
        let base = model.books.filter { $0.state == "completed" || $0.state == "dnf" }
        return Array(Set(base.compactMap(\.completionYear))).sorted(by: >)
    }

    private var availableGenres: [(name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for book in Self.filter(model.books, group: group, subFilter: subFilter) {
            for g in book.genres { counts[g, default: 0] += 1 }
        }
        return counts.map { (name: $0.key, count: $0.value) }
            .sorted { $0.count > $1.count || ($0.count == $1.count && $0.name < $1.name) }
    }

    @Environment(\.openSearch) private var openSearch

    @ViewBuilder private var content: some View {
        let books = filteredBooks
        if DesignPreview.on && books.isEmpty && !model.loading {
            let searching = searchActive && !LibrarySearch.tokens(searchText).isEmpty
            VStack(spacing: 12) {
                Image(systemName: searching ? "magnifyingglass" : "books.vertical")
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(Theme.muted)
                Text(searching ? "No books match \u{201C}\(searchText)\u{201D}"
                     : model.books.isEmpty ? "Your library starts here" : "Nothing in this view yet")
                    .font(Theme.heading(19, .bold))
                    .foregroundStyle(Theme.foreground)
                    .multilineTextAlignment(.center)
                if !searching {
                    Text(model.books.isEmpty
                         ? "Add the books you own, want to read, or have finished."
                         : "Try another tab or filter, or add more books.")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                    Button { openSearch() } label: {
                        Label("Find books to add", systemImage: "plus")
                            .font(Theme.body(15, .bold))
                            .foregroundStyle(Theme.onAccent)
                            .padding(.horizontal, 20).padding(.vertical, 11)
                            .background(Theme.accent, in: Capsule())
                    }
                    .padding(.top, 4)
                    if model.books.isEmpty {
                        Button {
                            if let url = URL(string: "https://thebasedreader.app/import") {
                                UIApplication.shared.open(url)
                            }
                        } label: {
                            Text("Import from Goodreads or StoryGraph")
                                .font(Theme.body(14, .medium))
                                .foregroundStyle(Theme.neonBlue)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 44).padding(.horizontal, 20)
            .background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.border, lineWidth: 1))
        } else if books.isEmpty && !model.loading {
            VStack(spacing: 10) {
                Text("Nothing here yet.")
                    .font(Theme.body(17))
                    .foregroundStyle(Theme.muted)
                Button { openSearch() } label: {
                    Text("Find books to add")
                        .font(Theme.body(17, .medium))
                        .foregroundStyle(Theme.accent)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 60)
            .background(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
                ForEach(books) { book in
                    NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                        LibraryBookCard(book: book, avatarUrl: avatarUrl)
                    }
                }
            }
        }
    }

    // filterBooks() + applyAdvancedFilters() + sortBooks() from
    // library-client.tsx, ported 1:1.
    private var filteredBooks: [LibraryBook] {
        var books = Self.filter(model.books, group: group, subFilter: subFilter)
        if showAdvanced {
            if let yr = yearFilter { books = books.filter { $0.completionYear == yr } }
            if let g = genreFilter {
                books = books.filter { $0.genres.contains { $0.caseInsensitiveCompare(g) == .orderedSame } }
            }
            if minRating > 0 { books = books.filter { ($0.userRating ?? 0) >= Double(minRating) } }
            if fictionFilter == "fiction" { books = books.filter { $0.isFiction == true } }
            else if fictionFilter == "nonfiction" { books = books.filter { $0.isFiction == false } }
            if let f = formatFilter {
                books = books.filter { $0.ownedFormats.contains(f) || $0.activeFormats.contains(f) }
            }
        }
        let tokens = searchActive ? LibrarySearch.tokens(searchText) : []
        if !tokens.isEmpty {
            books = books.filter { LibrarySearch.matches(searchIndex.text(for: $0), tokens) }
        }
        switch sort {
        case .recent: return books  // base filter already sorts by updatedAt
        case .title: return books.sorted { Self.titleSortKey($0.title).localizedCaseInsensitiveCompare(Self.titleSortKey($1.title)) == .orderedAscending }
        case .author: return books.sorted { Self.authorSortKey($0.authors.first).localizedCaseInsensitiveCompare(Self.authorSortKey($1.authors.first)) == .orderedAscending }
        case .rating: return books.sorted { ($0.userRating ?? 0) > ($1.userRating ?? 0) }
        }
    }

    private func countFor(_ key: String) -> Int {
        Self.filter(model.books, group: group, subFilter: key).count
    }

    // Library convention: ignore a leading article when sorting by title, so
    // "A Court of Thorns and Roses" files under C, not A.
    private static func titleSortKey(_ title: String) -> String {
        for article in ["a ", "an ", "the "] where title.lowercased().hasPrefix(article) {
            return String(title.dropFirst(article.count)).trimmingCharacters(in: .whitespaces)
        }
        return title
    }

    // Sort people by surname ("A. Rae Dunlap" -> "Dunlap, A. Rae"), the way a
    // library shelf does. Books with no author sort last rather than first.
    private static let nameSuffixes: Set<String> = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "md"]
    // Surname particles travel with the surname: "Ursula K. Le Guin" -> "Le Guin, Ursula K."
    private static let nameParticles: Set<String> = ["le", "la", "de", "del", "della", "di", "da", "dos",
                                                     "du", "van", "von", "der", "den", "ter", "ten",
                                                     "bin", "al", "st", "st.", "mac", "mc"]
    private static func authorSortKey(_ name: String?) -> String {
        let n = (name ?? "").trimmingCharacters(in: .whitespaces)
        if n.isEmpty { return "\u{FFFF}" }   // no author -> end of list
        if n.contains(",") { return n }      // already "Last, First"
        let parts = n.split(separator: " ").map(String.init)
        guard parts.count > 1 else { return n }
        var end = parts.count - 1
        while end > 0 && nameSuffixes.contains(parts[end].lowercased()) { end -= 1 }
        var start = end
        while start > 0 && nameParticles.contains(parts[start - 1].lowercased()) { start -= 1 }
        let surname = parts[start...end].joined(separator: " ")
        let rest = (parts[0..<start] + parts[(end + 1)...]).joined(separator: " ")
        return rest.isEmpty ? surname : "\(surname), \(rest)"
    }

    private static func filter(_ books: [LibraryBook], group: Group, subFilter: String) -> [LibraryBook] {
        let sorted = books.sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
        switch group {
        case .activity:
            return sorted.filter { $0.state == subFilter }
        case .tbr:
            let tbr = sorted.filter { $0.state == "tbr" }
            switch subFilter {
            case "owned": return tbr.filter { !$0.ownedFormats.isEmpty }
            case "not_owned": return tbr.filter { $0.ownedFormats.isEmpty }
            case "fiction": return tbr.filter { $0.isFiction == true }
            case "nonfiction": return tbr.filter { $0.isFiction == false }
            case "flagged": return tbr.filter { $0.hasContentConflict == true }
            default: return tbr
            }
        case .owned:
            let owned = sorted.filter { !$0.ownedFormats.isEmpty }
            if subFilter == "all" { return owned }
            return owned.filter { $0.ownedFormats.contains(subFilter) }
        }
    }
}

// The library grid card — BookCard with the library-specific accents:
// square aspect when the book is being actively read as an audiobook,
// avatar-in-pill rating (profile Top Shelf treatment), and the premium
// TBR note-to-self (pencil badge on the cover + 2-line note below).
private struct LibraryBookCard: View {
    let book: LibraryBook
    let avatarUrl: String?

    private var isAudiobookActive: Bool {
        // Square frame ONLY when the resolved cover is the real square
        // audiobook image (server-computed flag) — an audiobook format
        // choice alone must not square-crop the regular 2:3 cover.
        (book.state == "currently_reading" || book.state == "paused")
            && book.activeFormats == ["audiobook"]
            && book.usesAudiobookCover == true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GeometryReader { geo in
                CoverThumb(url: book.coverImageUrl,
                           width: geo.size.width,
                           height: isAudiobookActive ? geo.size.width : geo.size.width * 1.5,
                           radius: 10, title: book.title)
                    .overlay(alignment: .topTrailing) {
                        if book.tbrNote?.isEmpty == false {
                            ZStack {
                                Circle().fill(Theme.accent.opacity(0.85))
                                Image(systemName: "pencil")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.black)
                            }
                            .frame(width: 20, height: 20)
                            .padding(5)
                        }
                    }
                    // Web book-card.tsx parity: yellow "!" pill top-LEFT when
                    // a rating exceeds the viewer's comfort zone.
                    .overlay(alignment: .topLeading) {
                        if book.hasContentConflict == true {
                            Text("!")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.black)
                                .frame(width: 20, height: 20)
                                .background(Color(hex: "eab308").opacity(0.9), in: Circle())
                                .padding(5)
                        }
                    }
                    .overlay(alignment: .bottomTrailing) {
                        if let rating = book.userRating, rating > 0 {
                            AvatarRatingPill(avatarUrl: avatarUrl, rating: rating)
                                .padding(5)
                        }
                    }
            }
            .aspectRatio(isAudiobookActive ? 1 : 2 / 3, contentMode: .fit)

            if let note = book.tbrNote, !note.isEmpty {
                Text(note)
                    .font(Theme.body(10))
                    .foregroundStyle(Theme.muted.opacity(0.7))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
    }
}

/// The owner's avatar riding inside a black rating capsule — the same
/// treatment as the profile Top Shelf / Recent Reviews pills. Quarter
/// ratings render exactly ("4.75", "4.5"), never rounded to a tenth.
struct AvatarRatingPill: View {
    let avatarUrl: String?
    let rating: Double

    var body: some View {
        HStack(spacing: 3) {
            avatarBubble
            Text(Self.label(rating))
                .font(Theme.body(10, .semibold))
                .foregroundStyle(.white)
            Text("★")
                .font(Theme.body(10))
                .foregroundStyle(.yellow)
        }
        .padding(.leading, 2).padding(.trailing, 7).padding(.vertical, 2)
        .background(.black.opacity(0.75), in: Capsule())
    }

    @ViewBuilder private var avatarBubble: some View {
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
                    Text("★").font(.system(size: 7, weight: .bold)).foregroundStyle(.black)
                }
            }
        }
        .frame(width: 16, height: 16)
        .clipShape(Circle())
    }

    /// "4" for whole numbers, otherwise 2 decimals with a trailing zero
    /// trimmed — matches the web's formatRating.
    static func label(_ r: Double) -> String {
        r == r.rounded()
            ? String(Int(r))
            : String(format: "%.2f", r).replacingOccurrences(of: "0$", with: "", options: .regularExpression)
    }
}
