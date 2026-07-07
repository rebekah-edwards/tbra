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
    @State private var model = StatsModel()

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
                    goalCard(data)
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
                            .foregroundStyle(active ? Theme.accent : Theme.muted)
                            .padding(.horizontal, 20).padding(.vertical, 10)
                            .background(active ? Theme.accent.opacity(0.12) : Theme.surfaceAlt.opacity(0.6), in: Capsule())
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
            heroCard(emoji: "🔥", bg: Color.orange.opacity(0.25),
                     value: "\(data.streak.currentStreak)", label: "DAY STREAK")
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

    private func heroCard(emoji: String, bg: Color, value: String, label: String) -> some View {
        VStack(spacing: 8) {
            Text(emoji)
                .font(.system(size: 22))
                .frame(width: 52, height: 52)
                .background(bg, in: Circle())
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
                        : "\(data.pageStats.totalPages)",
                     label: "PAGES READ")
            miniStat(value: data.readingPace.map { "\($0.avgDays)d" } ?? "—", label: "AVG PACE")
            miniStat(value: data.minutesListened > 0 ? formatMinutes(data.minutesListened) : "—", label: "LISTENED")
        }
    }

    private func formatMinutes(_ mins: Int) -> String {
        mins >= 60 ? "\(mins / 60)h" : "\(mins)m"
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

    private func goalCard(_ data: StatsData) -> some View {
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
                            Text("🎉 Goal reached!")
                                .font(Theme.body(12, .medium))
                                .foregroundStyle(Theme.accent)
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
                            if i == 0 { Text("👑").font(.system(size: 13)) }
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
