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
    @State private var model = StatsModel()
    @State private var goalEditing = false
    // Goal / streak the reader has hidden (MotivationPrefs) — hidden here too.
    @AppStorage(MotivationPrefs.hideGoalKey) private var hideGoal = false
    @AppStorage(MotivationPrefs.hideStreakKey) private var hideStreak = false
    private var currentYear: Int { Calendar.current.component(.year, from: Date()) }
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
                        CustomGoalsCard(year: model.year, editable: model.year == String(currentYear))
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
        .refreshable { await model.load() }
        .task { await model.load() }
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
                     label: "PAGES READ")
            miniStat(value: data.readingPace.map { "\($0.avgDays)d" } ?? "—", label: "AVG PACE")
            miniStat(value: data.minutesListened > 0 ? formatMinutes(data.minutesListened) : "—", label: "LISTENED")
        }
    }

    // Mirrors stats-client.tsx formatMinutes: "97h 10m", "97h", "45m".
    private func formatMinutes(_ mins: Int) -> String {
        if mins < 60 { return "\(mins)m" }
        let h = mins / 60, m = mins % 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    private func miniStat(value: String, label: String) -> some View {
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
    @State private var model = CustomGoalsModel()
    @State private var adding = false
    @State private var lengthsFor: CustomGoal?
    @State private var removing: CustomGoal?
    @State private var upgradeOpen = false

    var body: some View {
        Group {
            if !model.loaded {
                EmptyView()
            } else if !model.premium {
                upsell
            } else if !model.goals.isEmpty || editable {
                section
            }
        }
        .task(id: year) { await model.load(year: year) }
        .sheet(isPresented: $adding) {
            AddCustomGoalSheet(model: model, taken: model.goals) {
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
                    Text(title.uppercased())
                        .font(Theme.body(11, .bold)).tracking(0.8)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(CustomGoalKindMeta.format(goal.current, goal.kind))
                            .font(Theme.heading(26, .heavy))
                            .foregroundStyle(Theme.foreground)
                        Text("of \(goal.target.formatted()) \(unit)")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                }
                Spacer(minLength: 0)
                if editable {
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
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.foreground.opacity(0.10))
                    Capsule()
                        .fill(LinearGradient(colors: [tint.opacity(0.75), tint], startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * CGFloat(goal.percentComplete > 0 ? max(goal.percentComplete, 3) : 0) / 100)
                }
            }
            .frame(height: 7)
            HStack {
                Text("\(goal.percentComplete)% of goal")
                Spacer()
                if goal.percentComplete >= 100 {
                    Label("Goal reached", systemImage: "checkmark")
                        .foregroundStyle(Theme.foreground)
                }
            }
            .font(Theme.body(11, .medium))
            .foregroundStyle(Theme.muted)

            if goal.kind == "hours", !missing.isEmpty {
                Divider().overlay(Theme.foreground.opacity(0.10))
                Button { lengthsFor = goal } label: {
                    HStack(spacing: 6) {
                        Circle().fill(Theme.neonPurple).frame(width: 6, height: 6)
                        Text("\(missing.count) \(missing.count == 1 ? "listen is" : "listens are") missing a length")
                            .foregroundStyle(Theme.foreground)
                        Spacer()
                        Text("Add lengths").foregroundStyle(Theme.neonBlue)
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
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = ""
    @State private var genre = ""
    @State private var target = ""
    @State private var saving = false
    @State private var error: String?

    private var kinds: [String] {
        let takenKinds = Set(taken.filter { $0.kind != "genre" }.map(\.kind))
        return ["pages", "hours", "days", "genre"].filter { !takenKinds.contains($0) }
    }
    private var freeGenres: [String] {
        let takenGenres = Set(taken.compactMap { $0.kind == "genre" ? $0.genreName?.lowercased() : nil })
        return model.genres.filter { !takenGenres.contains($0.lowercased()) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("New goal for \(String(Calendar.current.component(.year, from: Date())))")
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
