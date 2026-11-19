import SwiftUI

// Reading Stats — recreates /stats (stats-client.tsx): year pills, three
// hero cards (emoji circle + value + label), three mini stats, the
// Reading Goal ring, Monthly/Yearly Reading bar chart, Rating
// Distribution, Fiction vs Nonfiction split bar, Most Read Authors, and
// Top Genres.

@MainActor
@Observable
final class StatsModel {
    var data: StatsData?
    var year: String
    var error: String?
    var loading = false

    init() {
        year = String(Calendar.current.component(.year, from: Date()))
    }

    func load() async {
        loading = true; defer { loading = false }
        do { data = try await APIClient.shared.stats(year: year) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Couldn't load stats." }
    }
}

struct StatsView: View {
    @Environment(ChromeState.self) private var chrome: ChromeState?
    @Environment(AuthStore.self) private var auth
    @State private var model = StatsModel()
    /// Admins only: books in this year's reads missing pages / audio length.
    @State private var adminMissing = AdminMissingModel()
    @State private var adminFixFocus: AdminMissingFocus?
    @State private var goalsRefresh = 0
    @State private var goalEditing = false
    // Goal / streak the reader has hidden (MotivationPrefs) — hidden here too.
    @AppStorage(MotivationPrefs.hideGoalKey) private var hideGoal = false
    @AppStorage(MotivationPrefs.hideStreakKey) private var hideStreak = false
    private var currentYear: Int { Calendar.current.component(.year, from: Date()) }
    private var isAdmin: Bool {
        if case .signedIn(let u) = auth.phase { return ["admin", "super_admin"].contains(u.accountType) }
        return false
    }
    /// Based Readers (incl. staff/testers) get the missing-data warnings too —
    /// admins fix the catalog, everyone else fills values for their own goals.
    private var isPremium: Bool {
        if case .signedIn(let u) = auth.phase {
            return ["premium", "beta_tester", "admin", "super_admin"].contains(u.accountType)
        }
        return false
    }
    /// The goal belongs to the current year; "All Time" shows it too.
    private var isCurrentYear: Bool { model.year == "all" || model.year == String(currentYear) }

    private var yearOptions: [String] {
        let current = Calendar.current.component(.year, from: Date())
        return [String(current), String(current - 1), String(current - 2), "all"]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Reading Stats")
                    .font(Theme.heading(26, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 20)

                yearPills

                if let data = model.data {
                    heroCards(data)
                    miniStats(data)
                    if !hideGoal { goalCard(data) }
                    if DesignPreview.on, isCurrentYear, !hideStreak { streakCard(data.streak) }
                    if model.year != "all" {
                        CustomGoalsCard(year: model.year, editable: model.year == String(currentYear),
                                        refreshKey: goalsRefresh,
                                        adminMissing: isPremium ? adminMissing : nil,
                                        onAdminFix: { adminFixFocus = $0 })
                    }
                    monthlyChart(data)
                    if data.ratingDistribution.contains(where: { $0.count > 0 }) {
                        ratingDistribution(data)
                    }
                    if data.fictionSplit.fiction + data.fictionSplit.nonfiction > 0 {
                        fictionSplit(data)
                    }
                    if !data.mostReadAuthors.isEmpty { authorsCard(data) }
                    if !data.genreBreakdown.isEmpty { genresCard(data) }
                } else if model.loading {
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
        .reportsPage("/stats")
        .refreshable {
            await model.load()
            if isPremium, model.year != "all" { adminMissing.personal = !isAdmin; await adminMissing.load(year: model.year) }
        }
        .task { await model.load() }
        .task(id: model.year) {
            if isPremium, model.year != "all" {
                adminMissing.personal = !isAdmin
                await adminMissing.load(year: model.year)
            } else { adminMissing.clear() }
        }
        .sheet(item: $adminFixFocus) { focus in
            AdminMissingMetaSheet(model: adminMissing, focus: focus, year: model.year) {
                Task {
                    await model.load()
                    await adminMissing.load(year: model.year)
                    goalsRefresh += 1   // custom goal totals use the new number
                }
            }
            .presentationDetents([.large])
            .presentationBackground(Theme.bg)
        }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    private var yearPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(yearOptions, id: \.self) { y in
                    let active = model.year == y
                    Button {
                        model.year = y
                        Task { await model.load() }
                    } label: {
                        Text(y == "all" ? "All Time" : y)
                            .font(Theme.body(16, .medium))
                            .foregroundStyle(active ? Theme.accentText : Theme.muted)
                            .padding(.horizontal, 20).padding(.vertical, 10)
                            .background(active ? Theme.accent.opacity(0.18) : Theme.surfaceAlt.opacity(0.6), in: Capsule())
                            .overlay(Capsule().stroke(active ? Theme.accent.opacity(0.5) : .clear, lineWidth: 1))
                    }
                }
            }
        }
    }

    // ── Hero cards: 📚 books · 🔥 streak · ⭐ avg rating ──
    private func heroCards(_ data: StatsData) -> some View {
        HStack(spacing: 12) {
            heroCard(emoji: "📚", bg: Theme.neonPurple.opacity(0.25),
                     value: "\(data.pageStats.bookCount)", label: "BOOKS")
            if !hideStreak {
                heroCard(emoji: "🔥", bg: Color.orange.opacity(0.25),
                         value: "\(data.streak.currentStreak)", label: "DAY STREAK")
            }
            heroCard(emoji: "⭐", bg: Theme.accentDark.opacity(0.3),
                     value: avgRatingLabel(data), label: "AVG RATING")
        }
    }

    private func avgRatingLabel(_ data: StatsData) -> String {
        // The web derives the average from the rating distribution buckets.
        var total = 0.0, count = 0
        for bucket in data.ratingDistribution {
            if let v = Double(bucket.bucket) {
                total += v * Double(bucket.count)
                count += bucket.count
            }
        }
        guard count > 0 else { return "—" }
        return String(format: "%.1f", total / Double(count))
    }

    private static let heroSymbols: [String: (symbol: String, tint: Color)] = [
        "📚": ("books.vertical", Theme.neonPurple),
        "🔥": ("flame", Color(hex: "fb923c")),
        "⭐": ("star", Color(hex: "eab308")),
    ]

    private func heroCard(emoji: String, bg: Color, value: String, label: String) -> some View {
        VStack(spacing: 8) {
            if DesignPreview.on, let icon = Self.heroSymbols[emoji] {
                // Refreshed (2026-11): line icon in its own hue.
                Image(systemName: icon.symbol)
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(icon.tint)
                    .frame(width: 52, height: 52)
                    .background(icon.tint.opacity(0.16), in: Circle())
            } else {
                Text(emoji)
                    .font(.system(size: 22))
                    .frame(width: 52, height: 52)
                    .background(bg, in: Circle())
            }
            Text(value)
                .font(Theme.heading(26, .bold))
                .foregroundStyle(Theme.foreground)
            Text(label)
                .font(Theme.body(10, .medium))
                .tracking(1.0)
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .background(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }

    private func miniStats(_ data: StatsData) -> some View {
        HStack(spacing: 12) {
            miniStat(value: data.pageStats.totalPages >= 10000
                        ? String(format: "%.1fk", Double(data.pageStats.totalPages) / 1000)
                        : data.pageStats.totalPages.formatted(.number.grouping(.automatic)),
                     label: "PAGES READ",
                     warn: isPremium && adminMissing.pagesCount > 0 ? .pages : nil)
            miniStat(value: data.readingPace.map { "\($0.avgDays)d" } ?? "—", label: "AVG PACE")
            miniStat(value: data.minutesListened > 0 ? formatMinutes(data.minutesListened) : "—", label: "LISTENED",
                     warn: isPremium && adminMissing.audioCount > 0 ? .audio : nil)
        }
    }

    // Mirrors stats-client.tsx formatMinutes: "97h 10m", "97h", "45m".
    private func formatMinutes(_ mins: Int) -> String {
        if mins < 60 { return "\(mins)m" }
        let h = mins / 60, m = mins % 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    private func miniStat(value: String, label: String, warn: AdminMissingFocus? = nil) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(Theme.body(17, .bold))
                .foregroundStyle(Theme.foreground)
            Text(label)
                .font(Theme.body(9, .medium))
                .tracking(1.0)
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            if let warn {
                AdminMissingWarningButton(count: warn == .pages ? adminMissing.pagesCount : adminMissing.audioCount,
                                          focus: warn) { adminFixFocus = $0 }
                    .padding(5)
            }
        }
    }

    @ViewBuilder private func goalCard(_ data: StatsData) -> some View {
        if DesignPreview.on, data.goal == nil, isCurrentYear {
            statCard("Reading Goal") {
                HStack(spacing: 16) {
                    Image(systemName: "target")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Theme.accentText)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Pick a number for \(String(currentYear)) and watch the ring fill.")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        Button { goalEditing = true } label: {
                            Text("Set a goal")
                                .font(Theme.body(14, .bold))
                                .foregroundStyle(Theme.onAccent)
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .background(Theme.accent, in: Capsule())
                        }
                    }
                }
            }
            .sheet(isPresented: $goalEditing) {
                GoalEditSheet(year: currentYear, current: nil, onSaved: { await model.load() },
                              onHide: { withAnimation { MotivationPrefs.setHideGoal(true) } })
                    .presentationDetents([.height(330)])
                    .presentationBackground(Theme.surface)
            }
        } else if DesignPreview.on, let goal = data.goal {
            // Refreshed (2026-11): the same ring, big number and pace pill as
            // the Home goal tile. The right-hand column runs to the card's
            // edge (Rebekah, 2026-11-16: "a ton of open space to the right"):
            // the count and pace pill share a row, and under them a track
            // sets the goal's progress against how much of the year is gone.
            statCard("Reading Goal") {
                HStack(spacing: 18) {
                    GoalSweepRing(percent: goal.percentComplete, lineWidth: 10, labelSize: 19,
                                  yearElapsed: yearProgress?.elapsed)
                        .frame(width: 96, height: 96)
                    VStack(alignment: .leading, spacing: 12) {
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .center, spacing: 8) {
                                goalCount(goal)
                                Spacer(minLength: 0)
                                GoalPacePill(pace: goal.paceLine(year: Int(model.year)))
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                goalCount(goal)
                                GoalPacePill(pace: goal.paceLine(year: Int(model.year)))
                            }
                        }
                        goalTrack(goal)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            // Edit right here (Rebekah 2026-11-19: tapping the card opens the
            // finished books, and there was no way to change the goal on
            // Stats). A Button in the corner wins over the card's tap.
            .overlay(alignment: .topTrailing) {
                if model.year == String(currentYear) {
                    Button { goalEditing = true } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.85))
                            .frame(width: 34, height: 34)
                            .glassEffect(.regular, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit reading goal")
                    .padding(12)
                }
            }
            .sheet(isPresented: $goalEditing) {
                GoalEditSheet(year: currentYear, current: goal.targetBooks, onSaved: { await model.load() })
                    .presentationDetents([.height(330)])
                    .presentationBackground(Theme.surface)
            }
            .contentShape(RoundedRectangle(cornerRadius: 16))
            .onTapGesture {
                // Same destination as the Home tile and the web card.
                chrome?.pendingLibrarySelection = LibrarySelection(
                    group: "activity", filter: "completed", year: Int(model.year) ?? currentYear)
                chrome?.selectTab(.library)
            }
            .accessibilityAddTraits(.isButton)
        } else {
            goalCardV1(data)
        }
    }

    private func goalCount(_ goal: ReadingGoal) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(goal.completedBooks)")
                .font(Theme.heading(40, .heavy))
                .foregroundStyle(Theme.foreground)
            Text("of \(goal.targetBooks) books")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
        }
        .lineLimit(1)
        .fixedSize()
    }

    /// Today's place in the goal's year — nil for a past year.
    private var yearProgress: (elapsed: Double, daysLeft: Int)? {
        GoalYear.progress(year: Int(model.year))
    }

    /// Goal progress as a full-width track, with a tick where the year is:
    /// fill past the tick is ahead of pace, short of it is behind.
    private func goalTrack(_ goal: ReadingGoal) -> some View {
        let done = min(1, max(0, Double(goal.percentComplete) / 100))
        return VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.foreground.opacity(0.10))
                    Capsule()
                        .fill(LinearGradient(colors: [Theme.accent, Theme.neonBlue],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(width: done > 0 ? max(8, geo.size.width * done) : 0)
                    if let elapsed = yearProgress?.elapsed {
                        Capsule()
                            .fill(Theme.foreground)
                            .frame(width: 2, height: 14)
                            .offset(x: min(geo.size.width - 2, max(0, geo.size.width * elapsed - 1)))
                    }
                }
                .frame(height: geo.size.height)
            }
            .frame(height: 14)
            HStack(spacing: 0) {
                Text("\(goal.percentComplete)% of goal")
                Spacer(minLength: 8)
                if let left = yearProgress?.daysLeft {
                    Text("\(left) \(left == 1 ? "day" : "days") left")
                }
            }
            .font(Theme.body(11, .medium))
            .foregroundStyle(Theme.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
        }
    }

    // ── Streak (2026-11) — the Home tile's flame, status and record bar, at
    // this page's full width (Rebekah, 2026-11-16). The hero row above keeps
    // the bare number; this is where today's status and the best run live.
    private func streakCard(_ streak: ReadingStreak) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Reading Streak")
                    .font(Theme.heading(14, .semibold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                if let doneToday = streak.activeToday {
                    StreakTodayPill(doneToday: doneToday)
                }
            }
            HStack(spacing: 14) {
                StreakFlame(streak: streak, size: 52)
                    .frame(width: 72, height: 72)
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(streak.currentStreak)")
                        .font(Theme.heading(40, .heavy))
                        .foregroundStyle(Theme.foreground)
                        .contentTransition(.numericText())
                    Text(streak.currentStreak == 1 ? "day in a row" : "days in a row")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(streak.longestStreak)")
                        .font(Theme.heading(26, .bold))
                        .foregroundStyle(Theme.foreground.opacity(0.85))
                    Text(streak.longestStreak == 1 ? "day · best" : "days · best")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                StreakRaceBar(streak: streak, height: 6)
                Text(streak.footerLine)
                    .font(Theme.body(12, .semibold))
                    .foregroundStyle(Theme.foreground.opacity(0.75))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            ZStack {
                Theme.surface.opacity(0.5)
                RadialGradient(
                    colors: [(streak.isAlive ? StreakStyle.flame : Theme.neonPurple).opacity(0.22), .clear],
                    center: .topTrailing, startRadius: 0, endRadius: 220)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16)
            .stroke((streak.isAlive ? StreakStyle.flame : Theme.neonPurple).opacity(0.28), lineWidth: 1))
    }

    private func goalCardV1(_ data: StatsData) -> some View {
        statCard("Reading Goal") {
            if let goal = data.goal {
                HStack(spacing: 22) {
                    ZStack {
                        Circle().stroke(Theme.surfaceAlt, lineWidth: 8)
                        Circle()
                            .trim(from: 0, to: CGFloat(min(goal.percentComplete, 100)) / 100)
                            .stroke(Theme.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(goal.percentComplete)%")
                            .font(Theme.heading(18, .bold))
                            .foregroundStyle(Theme.foreground)
                    }
                    .frame(width: 92, height: 92)
                    VStack(alignment: .leading, spacing: 2) {
                        (Text("\(goal.completedBooks) ").font(Theme.heading(28, .bold)).foregroundStyle(Theme.foreground)
                            + Text("of \(goal.targetBooks)").font(Theme.body(17)).foregroundStyle(Theme.muted))
                        Text("books this year")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                        if goal.percentComplete >= 100 {
                            if DesignPreview.on {
                                Label("Goal reached", systemImage: "checkmark.seal")
                                    .font(Theme.body(12, .medium))
                                    .foregroundStyle(Theme.accentText)
                            } else {
                                Text("🎉 Goal reached!")
                                    .font(Theme.body(12, .medium))
                                    .foregroundStyle(Theme.accent)
                            }
                        }
                    }
                }
            } else {
                Text("No goal set for this year")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    // ── Monthly (or Yearly, for All Time) bar chart ──
    private func monthlyChart(_ data: StatsData) -> some View {
        let isAllTime = model.year == "all"
        let pagesByMonth = Dictionary(uniqueKeysWithValues: data.pagesByMonth.map { ($0.month, $0.pages) })
        let entries: [(label: String, books: Int)] = isAllTime
            ? data.booksByYear.map { ($0.year ?? "No Year", $0.count) }
            : monthlyEntries(data)
        let maxBooks = max(entries.map(\.books).max() ?? 1, 1)
        _ = pagesByMonth

        return statCard(isAllTime ? "Yearly Reading" : "Monthly Reading") {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    VStack(spacing: 4) {
                        if entry.books > 0 {
                            Text("\(entry.books)")
                                .font(Theme.body(9, .medium))
                                .foregroundStyle(Theme.muted)
                        }
                        Capsule()
                            .fill(entry.books > 0
                                  ? AnyShapeStyle(LinearGradient(colors: [Theme.accent, Theme.neonBlue],
                                                                 startPoint: .bottom, endPoint: .top))
                                  : AnyShapeStyle(Theme.surfaceAlt))
                            .frame(height: max(CGFloat(entry.books) / CGFloat(maxBooks) * 90, 4))
                        Text(entry.label)
                            .font(Theme.body(8))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 130, alignment: .bottom)
        }
    }

    private func monthlyEntries(_ data: StatsData) -> [(String, Int)] {
        let names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        let counts = Dictionary(uniqueKeysWithValues: data.booksByMonth.map { ($0.month, $0.count) })
        return (1...12).map { m in
            let key = String(format: "%02d", m)
            // months come back as "YYYY-MM" or "MM" depending on the query — match by suffix
            let count = counts.first { $0.key.hasSuffix(key) }?.value ?? 0
            return (names[m - 1], count)
        }
    }

    private func ratingDistribution(_ data: StatsData) -> some View {
        let maxCount = max(data.ratingDistribution.map(\.count).max() ?? 1, 1)
        return statCard("Rating Distribution") {
            VStack(spacing: 8) {
                ForEach(data.ratingDistribution, id: \.bucket) { row in
                    HStack(spacing: 10) {
                        Text("\(row.bucket)★")
                            .font(Theme.body(12, .medium))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 34, alignment: .trailing)
                        GeometryReader { geo in
                            Capsule().fill(Theme.surfaceAlt)
                            Capsule().fill(LinearGradient(colors: [Theme.neonBlue, Theme.accent],
                                                          startPoint: .leading, endPoint: .trailing))
                                .frame(width: max(geo.size.width * CGFloat(row.count) / CGFloat(maxCount), row.count > 0 ? 8 : 0))
                        }
                        .frame(height: 8)
                        Text("\(row.count)")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 26, alignment: .leading)
                    }
                }
            }
        }
    }

    private func fictionSplit(_ data: StatsData) -> some View {
        let total = data.fictionSplit.fiction + data.fictionSplit.nonfiction
        return statCard("Fiction vs Nonfiction") {
            VStack(spacing: 10) {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        Capsule().fill(Theme.neonPurple)
                            .frame(width: max(geo.size.width * CGFloat(data.fictionSplit.fiction) / CGFloat(total), geo.size.width * 0.15))
                        Capsule().fill(Theme.neonBlue)
                    }
                }
                .frame(height: 12)
                HStack {
                    Label("\(data.fictionSplit.fiction) Fiction", systemImage: "circle.fill")
                        .foregroundStyle(Theme.neonPurple)
                    Spacer()
                    Label("\(data.fictionSplit.nonfiction) Nonfiction", systemImage: "circle.fill")
                        .foregroundStyle(Theme.neonBlue)
                }
                .font(Theme.body(12, .medium))
            }
        }
    }

    private func authorsCard(_ data: StatsData) -> some View {
        let maxCount = max(data.mostReadAuthors.first?.count ?? 1, 1)
        return statCard("Most Read Authors") {
            VStack(spacing: 10) {
                ForEach(Array(data.mostReadAuthors.enumerated()), id: \.element.author) { i, row in
                    HStack(spacing: 10) {
                        Group {
                            if i == 0 {
                                if DesignPreview.on {
                                    // Line crown, not emoji (web stats-client parity).
                                    Image(systemName: "crown")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(Color(hex: "eab308"))
                                        .accessibilityLabel("Most read")
                                } else {
                                    Text("👑").font(.system(size: 13))
                                }
                            }
                            else {
                                Text("\(i + 1)")
                                    .font(Theme.body(11))
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                        .frame(width: 20)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(row.author)
                                    .font(Theme.body(12, .medium))
                                    .foregroundStyle(Theme.foreground)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(row.count) book\(row.count == 1 ? "" : "s")")
                                    .font(Theme.body(11))
                                    .foregroundStyle(Theme.muted)
                            }
                            GeometryReader { geo in
                                Capsule().fill(Theme.surfaceAlt)
                                Capsule()
                                    .fill(i == 0 ? Theme.accent : Theme.neonPurple)
                                    .frame(width: max(geo.size.width * CGFloat(row.count) / CGFloat(maxCount), geo.size.width * 0.05))
                            }
                            .frame(height: 6)
                        }
                    }
                }
            }
        }
    }

    // CHART_COLORS from stats-client.tsx
    private var chartColors: [Color] {
        [Theme.accent, Theme.neonPurple, Theme.neonBlue,
         Color(hex: "fb923c"), Color(hex: "f472b6"), Color(hex: "34d399")]
    }

    private func genresCard(_ data: StatsData) -> some View {
        let top = Array(data.genreBreakdown.prefix(6))
        let total = max(top.reduce(0) { $0 + $1.count }, 1)
        return statCard("Top Genres") {
            HStack(spacing: 22) {
                // Donut pie (web: stroked circles, -90° start)
                ZStack {
                    ForEach(Array(top.enumerated()), id: \.element.genre) { i, row in
                        let startPct = top.prefix(i).reduce(0.0) { $0 + Double($1.count) / Double(total) }
                        let endPct = startPct + Double(row.count) / Double(total)
                        Circle()
                            .trim(from: startPct, to: endPct)
                            .stroke(chartColors[i % chartColors.count],
                                    style: StrokeStyle(lineWidth: 13))
                            .rotationEffect(.degrees(-90))
                    }
                    Text(top.first?.genre ?? "")
                        .font(Theme.body(10, .bold))
                        .foregroundStyle(Theme.foreground)
                        .multilineTextAlignment(.center)
                        .frame(width: 62)
                        .lineLimit(2)
                }
                .frame(width: 104, height: 104)
                .padding(6)

                // Legend
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(top.enumerated()), id: \.element.genre) { i, row in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(chartColors[i % chartColors.count])
                                .frame(width: 9, height: 9)
                            Text(row.genre)
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                            Spacer()
                            Text("\(row.count)")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        }
    }

    // The web's stat cards: bordered surface w/ the tiny uppercase heading.
    private func statCard<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(Theme.heading(14, .semibold))
                .foregroundStyle(Theme.foreground)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Theme.surface.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }
}

// ── Premium custom goals (2026-11-19, web custom-goals-section.tsx) ──
// Pages read, hours listened, days read, books in a genre — per year, beside
// the free books goal. Data from GET /api/v1/goals/custom, which also says
// whether the reader is premium (free readers get the upgrade card).

struct CustomGoalMissingAudio: Codable, Hashable, Identifiable {
    let bookId: String
    let title: String
    let slug: String?
    let coverImageUrl: String?
    var id: String { bookId }
}

struct CustomGoal: Codable, Hashable, Identifiable {
    let id: String
    let kind: String          // pages | hours | days | genre
    let genreName: String?
    let target: Int
    let current: Double
    let percentComplete: Int
    /// Part of `current` from books still being read (current year).
    let fromInProgress: Double?
    let missingAudio: [CustomGoalMissingAudio]?
}

private struct CustomGoalsResponse: Codable {
    let premium: Bool
    let goals: [CustomGoal]
    let genres: [String]
}

private struct CustomGoalSaveResponse: Codable { let id: String? }

private struct CustomGoalBody: Encodable, Sendable {
    let kind: String
    let target: Int
    let genreName: String?
}

private struct CustomGoalIdBody: Encodable, Sendable { let id: String }

private struct AudioLengthBody: Encodable, Sendable {
    let bookId: String
    let minutes: Int
}

@MainActor
@Observable
final class CustomGoalsModel {
    var premium = false
    var goals: [CustomGoal] = []
    var genres: [String] = []
    var loaded = false
    var error: String?

    func load(year: String) async {
        do {
            let res: CustomGoalsResponse = try await APIClient.shared.get(
                "/api/v1/goals/custom", query: [URLQueryItem(name: "year", value: year)])
            premium = res.premium
            goals = res.goals
            genres = res.genres
        } catch {
            // A failed fetch leaves the section hidden rather than alerting
            // over the rest of Stats.
        }
        loaded = true
    }

    func save(kind: String, target: Int, genre: String?) async -> String? {
        do {
            let _: CustomGoalSaveResponse = try await APIClient.shared.request(
                "/api/v1/goals/custom", method: "POST",
                json: CustomGoalBody(kind: kind, target: target, genreName: genre))
            return nil
        } catch {
            return (error as? APIError)?.errorDescription ?? "Couldn't save the goal."
        }
    }

    func remove(_ id: String) async {
        // id in the body: the client never bakes "?k=v" into a path.
        _ = try? await APIClient.shared.request("/api/v1/goals/custom", method: "DELETE",
                                               json: CustomGoalIdBody(id: id)) as OkResponse
    }

    func setLength(bookId: String, minutes: Int) async -> String? {
        do {
            let _: OkResponse = try await APIClient.shared.request(
                "/api/v1/goals/audio-length", method: "POST",
                json: AudioLengthBody(bookId: bookId, minutes: minutes))
            return nil
        } catch {
            return (error as? APIError)?.errorDescription ?? "Couldn't save the length."
        }
    }
}

enum CustomGoalKindMeta {
    static func label(_ kind: String) -> String {
        switch kind {
        case "pages": return "Pages read"
        case "hours": return "Hours listened"
        case "days": return "Days read"
        default: return "Books in a genre"
        }
    }
    static func unit(_ kind: String) -> String {
        switch kind {
        case "pages": return "pages"
        case "hours": return "hours"
        case "days": return "days"
        default: return "books"
        }
    }
    static func symbol(_ kind: String) -> String {
        switch kind {
        case "pages": return "book.pages"
        case "hours": return "headphones"
        case "days": return "calendar"
        default: return "tag"
        }
    }
    static func tint(_ kind: String) -> Color {
        switch kind {
        case "pages": return Theme.neonBlue
        case "hours": return Theme.neonPurple
        case "days": return Theme.accent
        default: return Color(hex: "f472b6")
        }
    }
    static func format(_ value: Double, _ kind: String) -> String {
        if kind == "hours", value.truncatingRemainder(dividingBy: 1) != 0 {
            return String(format: "%.1f", value)
        }
        return Int(value).formatted()
    }
}

struct CustomGoalsCard: View {
    let year: String
    let editable: Bool
    /// Bumped by Stats after a missing-data save so totals reload.
    var refreshKey: Int = 0
    /// Admins only (nil otherwise): counts drive the warning icons.
    var adminMissing: AdminMissingModel? = nil
    var onAdminFix: (AdminMissingFocus) -> Void = { _ in }
    @State private var model = CustomGoalsModel()
    @State private var adding = false
    @State private var lengthsFor: CustomGoal?
    @State private var removing: CustomGoal?
    @State private var editingGoal: CustomGoal?
    @State private var upgradeOpen = false

    var body: some View {
        // VStack + a zero-height Color, NOT Group { EmptyView() }: a view with
        // no content never "appears", so .task never ran and the section stayed
        // invisible for everyone (Rebekah 2026-11-19: "I don't see anywhere
        // for custom goal editing").
        VStack(spacing: 0) {
            if !model.loaded {
                Color.clear.frame(height: 0)
            } else if !model.premium {
                upsell
            } else if !model.goals.isEmpty || editable {
                section
            }
        }
        .task(id: "\(year)#\(refreshKey)") { await model.load(year: year) }
        .sheet(isPresented: $adding) {
            AddCustomGoalSheet(model: model, taken: model.goals) {
                Task { await model.load(year: year) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.bg)
        }
        .sheet(item: $editingGoal) { goal in
            AddCustomGoalSheet(model: model, taken: model.goals, editing: goal) {
                Task { await model.load(year: year) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.bg)
        }
        .sheet(item: $lengthsFor) { goal in
            AudioLengthsSheet(model: model, items: goal.missingAudio ?? []) {
                Task { await model.load(year: year) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.bg)
        }
        .confirmationDialog("Remove this goal?", isPresented: Binding(
            get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove goal", role: .destructive) {
                if let g = removing {
                    Task { await model.remove(g.id); await model.load(year: year) }
                }
                removing = nil
            }
        }
        .fullScreenCover(isPresented: $upgradeOpen) {
            NavigationStack {
                BasedReaderScreen()
                    .appDestinations()
            }
            .environment(\.shellBarInsets, (top: 0, bottom: 0))
            .environment(\.showsShellChrome, false)
        }
    }

    /// Today's place in the goals' year (0…1); nil for past years.
    private var yearElapsed: Double? {
        let cal = Calendar.current
        let now = Date()
        guard String(cal.component(.year, from: now)) == year,
              let start = cal.date(from: DateComponents(year: cal.component(.year, from: now), month: 1, day: 1)),
              let end = cal.date(byAdding: .year, value: 1, to: start) else { return nil }
        return min(1, max(0, now.timeIntervalSince(start) / end.timeIntervalSince(start)))
    }

    private var upsell: some View {
        VStack(spacing: 10) {
            Text("CUSTOM GOALS")
                .font(Theme.body(11, .bold)).tracking(0.9)
                .foregroundStyle(Theme.muted)
            HStack(spacing: 8) {
                ForEach(["pages", "hours", "days", "genre"], id: \.self) { k in
                    Image(systemName: CustomGoalKindMeta.symbol(k))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(CustomGoalKindMeta.tint(k))
                        .frame(width: 36, height: 36)
                        .glassEffect(.regular, in: Circle())
                }
            }
            Text("Set goals for pages read, hours listened, days read or a favorite genre.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            Button { upgradeOpen = true } label: {
                ShelfPill(kind: .neutral) {
                    Label {
                        Text("Upgrade to Based Reader")
                    } icon: {
                        Image(systemName: "star.fill").foregroundStyle(Theme.neonPurple)
                    }
                }
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .background(Theme.surface.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18)
            .stroke(style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
            .foregroundStyle(Theme.foreground.opacity(0.15)))
    }

    private var section: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Custom Goals")
                    .font(Theme.heading(14, .semibold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                if editable {
                    Button { adding = true } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "plus")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.accentText)
                            Text("Add goal")
                                .font(Theme.body(13, .semibold))
                                .foregroundStyle(Theme.foreground)
                        }
                        .padding(.horizontal, 13).padding(.vertical, 7)
                        .glassEffect(.regular, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            if model.goals.isEmpty {
                Text("Go beyond books: track pages, listening hours, reading days or a genre.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(18)
                    .overlay(RoundedRectangle(cornerRadius: 18)
                        .stroke(style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
                        .foregroundStyle(Theme.foreground.opacity(0.15)))
            } else {
                ForEach(model.goals) { goal in goalCard(goal) }
            }
        }
    }

    private func goalCard(_ goal: CustomGoal) -> some View {
        let tint = CustomGoalKindMeta.tint(goal.kind)
        let unit = CustomGoalKindMeta.unit(goal.kind)
        let title = goal.kind == "genre" ? "\(goal.genreName ?? "Genre") books" : CustomGoalKindMeta.label(goal.kind)
        let missing = goal.missingAudio ?? []
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: CustomGoalKindMeta.symbol(goal.kind))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 36, height: 36)
                    .glassEffect(.regular, in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(title.uppercased())
                            .font(Theme.body(11, .bold)).tracking(0.8)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                        if let am = adminMissing {
                            if goal.kind == "pages", am.pagesCount > 0 {
                                AdminMissingWarningButton(count: am.pagesCount, focus: .pages, action: onAdminFix)
                            } else if goal.kind == "hours", am.audioCount > 0 {
                                AdminMissingWarningButton(count: am.audioCount, focus: .audio, action: onAdminFix)
                            }
                        }
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(CustomGoalKindMeta.format(goal.current, goal.kind))
                            .font(Theme.heading(26, .heavy))
                            .foregroundStyle(Theme.foreground)
                        Text("of \(goal.target.formatted()) \(unit)")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                    if let partial = goal.fromInProgress, partial > 0 {
                        Text("incl. \(CustomGoalKindMeta.format(partial, goal.kind)) from books in progress")
                            .font(Theme.body(11))
                            .foregroundStyle(Theme.muted)
                    }
                }
                Spacer(minLength: 0)
                if editable {
                    Button { editingGoal = goal } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 32, height: 32)
                            .glassEffect(.regular, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit \(title) goal")
                    Button { removing = goal } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 32, height: 32)
                            .glassEffect(.regular, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(title) goal")
                }
            }
            // Progress against a tick for today's place in the year (same as
            // the books goal track): fill past the tick is ahead of pace.
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.foreground.opacity(0.10))
                        .frame(height: 7)
                    Capsule()
                        .fill(LinearGradient(colors: [tint.opacity(0.75), tint], startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * CGFloat(goal.percentComplete > 0 ? max(goal.percentComplete, 3) : 0) / 100,
                               height: 7)
                    if let elapsed = yearElapsed {
                        Capsule().fill(Theme.foreground)
                            .frame(width: 2, height: 14)
                            .offset(x: geo.size.width * CGFloat(elapsed) - 1)
                    }
                }
                .frame(height: 14)
            }
            .frame(height: 14)
            HStack {
                Text("\(goal.percentComplete)% of goal")
                Spacer()
                if let elapsed = yearElapsed, goal.percentComplete < 100 {
                    Text(goal.percentComplete >= Int((elapsed * 100).rounded()) ? "On pace" : "Behind pace")
                }
                if goal.percentComplete >= 100 {
                    Label("Goal reached", systemImage: "checkmark")
                        .foregroundStyle(Theme.foreground)
                }
            }
            .font(Theme.body(11, .medium))
            .foregroundStyle(Theme.muted)

            if goal.kind == "hours", !missing.isEmpty {
                Divider().overlay(Theme.foreground.opacity(0.10))
                Button {
                    // Admins fix the CATALOG (every reader benefits); others
                    // enter a length for their own goal.
                    if let am = adminMissing, !am.personal { onAdminFix(.audio) } else { lengthsFor = goal }
                } label: {
                    HStack(spacing: 6) {
                        Circle().fill(Theme.neonPurple).frame(width: 6, height: 6)
                        Text("\(missing.count) \(missing.count == 1 ? "listen is" : "listens are") missing a length")
                            .foregroundStyle(Theme.foreground)
                        Spacer()
                        Text(adminMissing.map { $0.personal ? "Add lengths" : "Fix in catalog" } ?? "Add lengths").foregroundStyle(Theme.neonBlue)
                    }
                    .font(Theme.body(12, .medium))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.foreground.opacity(0.10), lineWidth: 1))
    }
}

private struct AddCustomGoalSheet: View {
    let model: CustomGoalsModel
    let taken: [CustomGoal]
    /// Set when changing an existing goal's target (kind/genre fixed).
    var editing: CustomGoal? = nil
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = ""
    @State private var genre = ""
    @State private var target = ""
    @State private var saving = false
    @State private var error: String?

    private var kinds: [String] {
        if let editing { return [editing.kind] }
        let takenKinds = Set(taken.filter { $0.kind != "genre" }.map(\.kind))
        return ["pages", "hours", "days", "genre"].filter { !takenKinds.contains($0) }
    }
    private var freeGenres: [String] {
        if let editing { return [editing.genreName ?? ""] }
        let takenGenres = Set(taken.compactMap { $0.kind == "genre" ? $0.genreName?.lowercased() : nil })
        return model.genres.filter { !takenGenres.contains($0.lowercased()) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(editing == nil
                     ? "New goal for \(String(Calendar.current.component(.year, from: Date())))"
                     : "Edit \(CustomGoalKindMeta.label(editing!.kind).lowercased()) goal")
                    .font(Theme.heading(20, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 22)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(kinds, id: \.self) { k in
                        Button { kind = k } label: {
                            ShelfPill(kind: kind == k ? .active : .neutral) {
                                Label {
                                    Text(CustomGoalKindMeta.label(k))
                                } icon: {
                                    Image(systemName: CustomGoalKindMeta.symbol(k))
                                        .foregroundStyle(CustomGoalKindMeta.tint(k))
                                }
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if kind == "genre" {
                    if freeGenres.isEmpty {
                        Text("Add some books to your library first — genre goals use the genres you read.")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                    } else {
                        Menu {
                            ForEach(freeGenres, id: \.self) { g in Button(g) { genre = g } }
                        } label: {
                            HStack {
                                Text(genre.isEmpty ? "Pick a genre" : genre)
                                    .foregroundStyle(genre.isEmpty ? Theme.muted : Theme.foreground)
                                Spacer()
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.muted)
                            }
                            .font(Theme.body(15))
                            .brandedField()
                        }
                    }
                }

                HStack(spacing: 10) {
                    TextField(placeholder, text: $target)
                        .keyboardType(.numberPad)
                        .font(Theme.body(15))
                        .brandedField()
                        .onChange(of: target) { _, v in
                            let digits = String(v.filter(\.isNumber).prefix(6))
                            if digits != v { target = digits }
                        }
                    Text("\(CustomGoalKindMeta.unit(kind)) this year")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                        .fixedSize()
                }

                if let error {
                    Text(error).font(Theme.body(13)).foregroundStyle(Theme.destructive)
                }

                Button {
                    Task {
                        saving = true; defer { saving = false }
                        let t = Int(target) ?? 0
                        if let e = await model.save(kind: kind, target: t, genre: kind == "genre" ? genre : nil) {
                            error = e
                        } else {
                            onSaved()
                            dismiss()
                        }
                    }
                } label: {
                    Text(saving ? "Saving…" : "Save goal")
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(saving || target.isEmpty || (kind == "genre" && genre.isEmpty))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 30)
        }
        .onAppear {
            if kind.isEmpty { kind = kinds.first ?? "genre" }
            if genre.isEmpty { genre = freeGenres.first ?? "" }
            if let editing, target.isEmpty { target = String(editing.target) }
        }
    }

    private var placeholder: String {
        switch kind {
        case "pages": return "e.g. 15000"
        case "hours": return "e.g. 100"
        case "days": return "e.g. 250"
        default: return "e.g. 12"
        }
    }
}

private struct AudioLengthsSheet: View {
    let model: CustomGoalsModel
    let items: [CustomGoalMissingAudio]
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var hours: [String: String] = [:]
    @State private var minutes: [String: String] = [:]
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Audiobook lengths")
                    .font(Theme.heading(20, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 22)
                Text("Enter each audiobook's length (from your audiobook app). You only need to do this once per book.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(items) { b in
                    HStack(spacing: 10) {
                        CoverThumb(url: b.coverImageUrl, width: 30, height: 45, radius: 4, title: b.title)
                        Text(b.title)
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(2)
                        Spacer(minLength: 6)
                        numberField("h", Binding(get: { hours[b.bookId] ?? "" }, set: { hours[b.bookId] = String($0.filter(\.isNumber).prefix(3)) }))
                        numberField("m", Binding(get: { minutes[b.bookId] ?? "" }, set: { minutes[b.bookId] = String($0.filter(\.isNumber).prefix(2)) }))
                    }
                }

                if let error {
                    Text(error).font(Theme.body(13)).foregroundStyle(Theme.destructive)
                }

                Button {
                    Task {
                        saving = true; defer { saving = false }
                        for b in items {
                            let m = (Int(hours[b.bookId] ?? "") ?? 0) * 60 + (Int(minutes[b.bookId] ?? "") ?? 0)
                            guard m > 0 else { continue }
                            if let e = await model.setLength(bookId: b.bookId, minutes: m) {
                                error = e
                                return
                            }
                        }
                        onSaved()
                        dismiss()
                    }
                } label: {
                    Text(saving ? "Saving…" : "Save lengths")
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(saving)
                .padding(.top, 6)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 30)
        }
    }

    private func numberField(_ placeholder: String, _ text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.center)
            .font(Theme.body(14))
            .frame(width: 44, height: 38)
            .background(Theme.surface.opacity(0.7), in: Capsule())
            .overlay(Capsule().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
    }
}


// ── Admin: missing page counts / audio lengths (2026-11-19, web /admin/book-metadata) ──
// Books in the admin's year of reads whose catalog row has no page count
// (print/ebook reads) or no audio length (audiobook reads). Data + saves go to
// PRODUCTION (adminBaseURL) so the catalog fix is permanent; a debug build also
// mirrors the save to its own server so the phone's totals update at once.

enum AdminMissingFocus: String, Identifiable {
    case pages, audio
    var id: String { rawValue }
}

struct AdminMissingBook: Codable, Hashable, Identifiable {
    let bookId: String
    let title: String
    let slug: String?
    let coverImageUrl: String?
    let authors: String?
    let ownMinutes: Int?
    let ownPages: Int?
    var id: String { bookId }
}

private struct AdminMissingResponse: Codable {
    let pages: [AdminMissingBook]
    let audio: [AdminMissingBook]
}

@MainActor
@Observable
final class AdminMissingModel {
    var pages: [AdminMissingBook] = []
    var audio: [AdminMissingBook] = []
    /// Based Reader (not admin): entries count for the reader's own goals
    /// only and become suggestions in the admin queue (2026-11-19).
    var personal = false

    /// Books still needing a number — for a Based Reader, ones they haven't
    /// filled in yet.
    var pagesCount: Int { personal ? pages.filter { $0.ownPages == nil }.count : pages.count }
    var audioCount: Int { personal ? audio.filter { $0.ownMinutes == nil }.count : audio.count }

    func load(year: String) async {
        let query = [URLQueryItem(name: "year", value: year)]
        do {
            let res: AdminMissingResponse = personal
                ? try await APIClient.shared.get("/api/v1/goals/missing", query: query)
                : try await APIClient.shared.adminGet("/api/v1/admin/missing-metadata", query: query)
            pages = res.pages
            audio = res.audio
        } catch {
            // Not entitled or offline: no warnings.
        }
    }

    func clear() { pages = []; audio = [] }

    /// Writes books.pages / books.audio_length_minutes on production, then
    /// best-effort on the app's own server (debug builds talk to the Mac).
    func save(bookId: String, fields: [String: Any]) async -> String? {
        if personal {
            do {
                if let p = fields["pages"] as? Int {
                    let _: OkResponse = try await APIClient.shared.post(
                        "/api/v1/goals/page-count", body: ["bookId": bookId, "pages": p])
                } else if let m = fields["audioLengthMinutes"] as? Int {
                    let _: OkResponse = try await APIClient.shared.post(
                        "/api/v1/goals/audio-length", body: ["bookId": bookId, "minutes": m])
                }
            } catch {
                return (error as? APIError)?.errorDescription ?? "Couldn't save."
            }
            return nil   // rows stay (book still has no catalog value) — the sheet marks them
        }
        do {
            let _: OkResponse = try await APIClient.shared.adminRequest(
                "/api/v1/admin/books/\(bookId)/fields", method: "POST", body: ["fields": fields])
        } catch {
            return (error as? APIError)?.errorDescription ?? "Couldn't save."
        }
        if APIClient.baseURL != APIClient.adminBaseURL {
            let _: OkResponse? = try? await APIClient.shared.request(
                "/api/v1/admin/books/\(bookId)/fields", method: "POST", body: ["fields": fields])
        }
        pages.removeAll { $0.bookId == bookId && fields["pages"] != nil }
        audio.removeAll { $0.bookId == bookId && fields["audioLengthMinutes"] != nil }
        return nil
    }
}

struct AdminMissingWarningButton: View {
    let count: Int
    let focus: AdminMissingFocus
    let action: (AdminMissingFocus) -> Void

    var body: some View {
        Button { action(focus) } label: {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color(hex: "f59e0b"))
                .frame(width: 22, height: 22)
                .background(Theme.surface.opacity(0.8), in: Circle())
                .overlay(Circle().stroke(Color(hex: "f59e0b").opacity(0.45), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(count) \(count == 1 ? "book" : "books") missing \(focus == .pages ? "a page count" : "an audio length")")
    }
}

struct AdminMissingMetaSheet: View {
    let model: AdminMissingModel
    let focus: AdminMissingFocus
    let year: String
    let onSaved: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.personal ? year : "ADMIN · \(year)")
                        .font(Theme.body(11, .bold)).tracking(0.9)
                        .foregroundStyle(Theme.muted)
                    Text("Missing pages & audio lengths")
                        .font(Theme.heading(22, .bold))
                        .foregroundStyle(Theme.foreground)
                    Text(model.personal
                         ? "These books don't have a page count or audiobook length on file yet, so they can't count toward your goals. Add the number from your copy — it counts for you right away, and we'll use it to fix the book for everyone."
                         : "Books you finished or are reading in \(year) that can't count toward pages or listening time yet. Saving updates the book itself, for every reader.")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 22)

                ForEach(focus == .audio ? [AdminMissingFocus.audio, .pages] : [.pages, .audio]) { kind in
                    let books = kind == .pages ? model.pages : model.audio
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(kind == .pages ? "No page count" : "No audio length")
                                .font(Theme.heading(15, .semibold))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                            Text("\(kind == .pages ? model.pagesCount : model.audioCount) left")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted)
                        }
                        if books.isEmpty {
                            Text(kind == .pages ? "Every print and ebook read has a page count." : "Every audiobook read has a length.")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity)
                                .padding(16)
                                .overlay(RoundedRectangle(cornerRadius: 18)
                                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
                                    .foregroundStyle(Theme.foreground.opacity(0.15)))
                        } else {
                            ForEach(books) { b in
                                AdminMissingRow(model: model, book: b, kind: kind, onSaved: onSaved)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 30)
        }
    }
}

private struct AdminMissingRow: View {
    let model: AdminMissingModel
    let book: AdminMissingBook
    let kind: AdminMissingFocus
    let onSaved: () -> Void
    @State private var pages = ""
    @State private var hours = ""
    @State private var minutes = ""
    @State private var saving = false
    @State private var saved = false
    @State private var error: String?

    var body: some View {
        HStack(spacing: 10) {
            CoverThumb(url: book.coverImageUrl, width: 32, height: 48, radius: 4, title: book.title)
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(Theme.body(14, .semibold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                if let authors = book.authors {
                    Text(authors).font(Theme.body(12)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                if saved {
                    Label("Saved", systemImage: "checkmark")
                        .font(Theme.body(11, .semibold))
                        .foregroundStyle(Theme.accentText)
                } else if model.personal, (kind == .pages ? book.ownPages : book.ownMinutes) != nil {
                    Text("Your entry — counts for your goals")
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.muted)
                }
                if let error {
                    Text(error).font(Theme.body(11)).foregroundStyle(Theme.destructive)
                }
            }
            Spacer(minLength: 6)
            if kind == .pages {
                field("pages", $pages, width: 64, max: 5)
            } else {
                field("h", $hours, width: 42, max: 3)
                field("m", $minutes, width: 42, max: 2)
            }
            Button {
                Task { await save() }
            } label: {
                Text(saving ? "…" : "Save")
                    .font(Theme.body(13, .bold))
                    .foregroundStyle(Theme.onAccent)
                    .padding(.horizontal, 12).frame(height: 36)
                    .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(saving)
        }
        .padding(12)
        .background(Theme.surface.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.foreground.opacity(0.10), lineWidth: 1))
        .onAppear {
            if kind == .audio, let own = book.ownMinutes, hours.isEmpty, minutes.isEmpty {
                hours = String(own / 60); minutes = String(own % 60)
            }
            if kind == .pages, let own = book.ownPages, pages.isEmpty { pages = String(own) }
        }
    }

    private func field(_ placeholder: String, _ text: Binding<String>, width: CGFloat, max: Int) -> some View {
        TextField(placeholder, text: Binding(get: { text.wrappedValue },
                                             set: { text.wrappedValue = String($0.filter(\.isNumber).prefix(max)) }))
            .keyboardType(.numberPad)
            .multilineTextAlignment(.center)
            .font(Theme.body(14))
            .frame(width: width, height: 36)
            .background(Theme.surface.opacity(0.7), in: Capsule())
            .overlay(Capsule().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
    }

    private func save() async {
        error = nil
        let value: Int
        let fields: [String: Any]
        if kind == .pages {
            value = Int(pages) ?? 0
            guard value >= 1, value <= 20000 else { error = "Pages must be 1–20,000."; return }
            fields = ["pages": value]
        } else {
            value = (Int(hours) ?? 0) * 60 + (Int(minutes) ?? 0)
            guard value >= 1, value <= 200 * 60 else { error = "Length must be 1 minute to 200 hours."; return }
            fields = ["audioLengthMinutes": value]
        }
        saving = true; defer { saving = false }
        if let e = await model.save(bookId: book.bookId, fields: fields) {
            error = e
        } else {
            saved = true
            onSaved()
        }
    }
}
