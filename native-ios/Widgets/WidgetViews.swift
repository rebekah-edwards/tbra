import WidgetKit
import SwiftUI

// The widget's VIEW layer, split out of TbraWidgets.swift so the app target
// can compile it too and render the same views in the debug preview harness
// (TBRA_DEBUG_WIDGET_PREVIEW). TbraWidgets.swift keeps the @main bundle,
// which the app obviously cannot compile.
//
// DESIGN: covers ARE the content. No titles or author lines EXCEPT when a
// single book is showing — one cover alone leaves a wide empty plate, and
// that's the one case where the copy earns its space.
//
// Brand rules that apply here exactly as on web (docs/BRANDING.md):
//   · accent is ALWAYS #a3e635, never darkened toward olive
//   · text on OPAQUE lime is ALWAYS near-black #18181b
//   · the lime→blue→purple gradient is the WORDMARK's alone — the goal ring
//     gets depth from a glow, not from a brand gradient

// MARK: - Deep links
//
// Widget taps use the app's private scheme (registered in project.yml). Note
// the hard WidgetKit rule: only systemMedium/systemLarge can contain multiple
// `Link`s. A systemSmall widget has exactly ONE tap target — its widgetURL —
// so per-element routing there is impossible, and small sends you to the book
// on top of the stack.
enum WidgetLink {
    static func book(_ b: WidgetBook) -> URL {
        if let slug = b.slug, !slug.isEmpty {
            return URL(string: "tbra://book/\(slug)")!
        }
        return URL(string: "tbra://book/\(b.id)")!
    }
    static let home = URL(string: "tbra://home")!
    static let goal = URL(string: "tbra://goal")!
    static let stats = URL(string: "tbra://stats")!
}

// MARK: - Shared pieces

enum W {
    static let accent = Color(hex: "a3e635")
    static let onAccent = Color(hex: "18181b")
    static let fg = Color(dark: "e4e2ef", light: "18181b")
    static let muted = Color(dark: "7a7890", light: "71717a")
    static let surfaceAlt = Color(dark: "1c1c2a", light: "f0eff4")
    static let neonPurple = Color(dark: "c084fc", light: "a855f7")
    /// EXACTLY Theme.neonBlue. Never hand-roll a light-mode blue here — the
    /// page-stack and pace dial each drifted to #0284c7 and shipped off-brand.
    static let neonBlue   = Color(dark: "38bdf8", light: "0ea5e9")

    static func heading(_ s: CGFloat, _ w: Font.Weight = .bold) -> Font {
        .custom("Outfit", size: s).weight(w)
    }
    static func body(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font {
        .custom("Plus Jakarta Sans", size: s).weight(w)
    }
}

/// The app's ambient "neon mesh" (Theme.swift AmbientBackground), re-cut for a
/// widget-sized canvas. Positions are fractions so one definition works at
/// every family; opacities run a touch stronger than the app's because a
/// widget is small enough that the app's values read as flat grey.
struct WidgetAmbientBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // Light mode gets a SMALLER boost than dark: over a near-white plate
        // the same opacities wash the whole widget lavender.
        // Round 3: dialled up. Light mode still gets a smaller share — over a
        // near-white plate the dark-mode values wash the whole widget lavender.
        let boost = scheme == .dark ? 0.0 : -0.04
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                Color(dark: "0a0a0f", light: "f5f4f8")
                blob(Color(hex: "a855f7"), 0.24 + boost, CGPoint(x: 0.10 * w, y: 0.02 * h), 0.95 * w)
                blob(Color(hex: "c084fc"), 0.17 + boost, CGPoint(x: 0.95 * w, y: 0.10 * h), 0.80 * w)
                blob(Color(hex: "38bdf8"), 0.21 + boost, CGPoint(x: 0.88 * w, y: 0.98 * h), 0.95 * w)
                blob(Color(hex: "a3e635"), 0.15 + boost, CGPoint(x: 0.28 * w, y: 1.02 * h), 0.80 * w)
            }
        }
    }

    private func blob(_ c: Color, _ o: Double, _ at: CGPoint, _ r: CGFloat) -> some View {
        RadialGradient(colors: [c.opacity(max(o, 0)), .clear],
                       center: .center, startRadius: 0, endRadius: r)
            .frame(width: r * 2, height: r * 2)
            .position(at)
    }
}

/// A cover with its reading progress rendered as a lime fill along the BOTTOM
/// EDGE, inside the artwork — zero extra vertical space, one per book.
struct WidgetCover: View {
    let book: WidgetBook
    let width: CGFloat
    let height: CGFloat
    var radius: CGFloat = 7
    var showProgress = true

    private var image: UIImage? {
        CoverCache.cachedData(for: book.coverURL).flatMap(UIImage.init(data:))
    }

    var body: some View {
        // Color.clear.frame(...).overlay { } — same recipe as CoverBlurImage
        // in Theme.swift. A bare .resizable().aspectRatio(.fill) has an
        // UNBOUNDED layout frame and spills over its neighbours.
        Color.clear
            .frame(width: width, height: height)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                } else {
                    ZStack {
                        LinearGradient(colors: [Color(hex: "3b5998"), Color(hex: "8b5cf6")],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                        Text(book.title)
                            .font(W.body(9, .semibold))
                            .foregroundStyle(.white.opacity(0.9))
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                            .minimumScaleFactor(0.6)
                            .padding(4)
                    }
                }
            }
            .overlay(alignment: .bottom) {
                if showProgress, let p = book.progress, p > 0 {
                    ZStack(alignment: .leading) {
                        Rectangle().fill(.black.opacity(0.45))
                        Rectangle().fill(W.accent)
                            .frame(width: width * CGFloat(min(p, 100)) / 100)
                    }
                    .frame(height: 4)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(.white.opacity(0.12), lineWidth: 0.5))
    }
}

/// The fan: newest cover on top, the rest stepping off to the RIGHT and
/// fading back. The offsets are deliberately wide — the previous 9pt step
/// hid the stack behind the top cover and wasted the whole right half of the
/// small widget.
struct CoverStack: View {
    let books: [WidgetBook]
    let width: CGFloat
    let height: CGFloat
    /// How far each card behind steps right. Tuned so 3 covers span most of a
    /// small widget's width instead of huddling in the corner.
    var step: CGFloat = 26

    private var behind: [WidgetBook] { Array(books.dropFirst().prefix(2)) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Reversed so the furthest-back card paints first.
            ForEach(Array(behind.enumerated()).reversed(), id: \.element.id) { idx, book in
                let n = CGFloat(idx + 1)
                WidgetCover(book: book, width: width, height: height, showProgress: false)
                    .scaleEffect(1 - 0.07 * n, anchor: .top)
                    .offset(x: step * n, y: 6 * n)
                    .opacity(0.75 - 0.22 * (n - 1))
            }
            if let top = books.first {
                WidgetCover(book: top, width: width, height: height)
            }
        }
        .frame(width: width + step * CGFloat(behind.count),
               height: height + 6 * CGFloat(behind.count),
               alignment: .topLeading)
    }
}

/// Shelf constants callers need. Lives outside the generic view because a
/// static on `ShelfBackdrop<Content>` can't be read without naming Content.
enum ShelfMetrics {
    /// Plate visible ABOVE the covers.
    static let topPlate: CGFloat = 10
    /// Plate between the covers and the ledge line.
    static let underBooks: CGFloat = 9
    /// The ledge band itself.
    static let lip: CGFloat = 4
    /// Rule 1: how much PLATE stays visible below the lip. This is what keeps
    /// the ledge line off the bottom border.
    static let underLip: CGFloat = 8
    /// The shadow strip that falls BELOW the shelf (never behind it).
    static let shadowDrop: CGFloat = 5
    /// Total vertical chrome the shelf adds around its content. Callers size
    /// their book row as (cover height + this), so growing the plate here
    /// never silently crops the shelf.
    static let chromeHeight: CGFloat = topPlate + underBooks + lip + underLip + shadowDrop
}

/// A shelf the covers sit ON — the widget echo of the app's Top Shelf
/// (src/components/profile/favorites-shelf.tsx).
///
/// ── HOW THE SHELF WORKS (rules, not preferences) ──────────────────────
///
/// 1. THE LEDGE LINE IS A BAND ACROSS THE PLATE, NEVER THE PLATE'S BOTTOM
///    EDGE. Look at the web shelf: the darker lip runs across, and a strip of
///    plate continues BELOW it before the rounded bottom. That skirt is what
///    makes it read as a ledge you could rest a book on. Building the lip as
///    the last row of the plate — flush with the bottom border — just makes a
///    thick bottom border, and thickening it makes it worse, not better.
/// 2. IT SPANS THE BOOK AREA. The plate fills the width it is given so the
///    books sit ON a shelf rather than inside a badge. It must NOT wrap the
///    whole widget — the goal/streak column stays off it — but within the
///    book area it should own the space, not float in the middle of it.
/// 3. IT IS BRAND BLUE, NOT THE WEB'S AMBER, AND IT IS SUBTLE. The web shelf
///    is amber because it sits on a flat page. These widgets sit on the
///    neon-mesh glow, where warm brown goes muddy. Brand blue (W.neonBlue)
///    belongs to the palette without competing with the lime the goal ring,
///    progress bars and streak already use — but keep the plate opacity very
///    low: the covers are the content, the shelf is furniture. The BORDER
///    carries the definition, not the fill.
/// 4. PADDING STAYS TIGHT. Generous padding shrinks the covers and turns the
///    shelf into a picture frame.
///
/// Not used on the SMALL widget: its covers are a fanned, overlapping stack,
/// and a flat ledge contradicts that perspective.
struct ShelfBackdrop<Content: View>: View {
    var radius: CGFloat = 10
    /// False only where filling would drag the plate under adjacent text
    /// (the single-book layouts, where the cover sits beside a title).
    var fills: Bool = true
    // Declared LAST so the memberwise init keeps trailing-closure syntax
    // working alongside the other parameters.
    @ViewBuilder let content: Content

    private let tint = W.neonBlue

    var body: some View {
        VStack(spacing: 0) {
            plate
            // Shadow BELOW the shelf, never behind it — mirrors the web's
            // sibling div (favorites-shelf.tsx: h-2 from-black/10). Drawing it
            // as a backdrop behind a 5-9%-opaque plate meant the black showed
            // straight THROUGH the fill and greyed the whole shelf out.
            LinearGradient(colors: [.black.opacity(0.12), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: ShelfMetrics.shadowDrop)
                // Inset further and blurred: at 20% black with square ends it
                // started abruptly under the plate and read as a hard line.
                .padding(.horizontal, 12)
                .blur(radius: 2.5)
        }
    }

    private var plate: some View {
        VStack(spacing: 0) {
            content
                .padding(.horizontal, 10)
                .padding(.top, ShelfMetrics.topPlate)
                .padding(.bottom, ShelfMetrics.underBooks)
                .frame(maxWidth: fills ? .infinity : nil)

            // The ledge line…
            Rectangle()
                .fill(tint.opacity(0.26))
                .frame(height: ShelfMetrics.lip)

            // …and the skirt of plate beneath it. RULE 1 — do not remove.
            Color.clear.frame(height: ShelfMetrics.underLip)
        }
        // Rule 3: brand lime, but FURNITURE. Deliberately faint — a stronger
        // fill reads as a coloured panel competing with the covers.
        .background(
            LinearGradient(colors: [tint.opacity(0.045), tint.opacity(0.09)],
                           startPoint: .top, endPoint: .bottom)
        )
        .clipShape(RoundedRectangle(cornerRadius: radius))
        // The border is what actually defines the shelf's edge. At 0.13/0.5pt
        // it was invisible, so the plate had no outline at all.
        .overlay(
            RoundedRectangle(cornerRadius: radius)
                .stroke(tint.opacity(0.38), lineWidth: 1)
        )
    }
}

/// Streak as the app renders it: 🔥 + number, no pill.
struct StreakBadge: View {
    let days: Int
    var size: CGFloat = 13
    var showLabel = true

    var body: some View {
        HStack(spacing: 4) {
            Text("🔥").font(.system(size: size))
            Text("\(days)").font(W.heading(size + 2)).foregroundStyle(W.fg)
            if showLabel {
                Text(days == 1 ? "day" : "days")
                    .font(W.body(size * 0.72)).foregroundStyle(W.muted)
            }
        }
    }
}

/// Number formatting shared by every stat: three digits render in full, and
/// anything past that abbreviates so a long streak or a big page count can
/// never blow out its column. 1100 → "1.1k", 12400 → "12k".
enum WNum {
    static func abbrev(_ n: Int) -> String {
        if n < 1000 { return "\(n)" }
        let k = Double(n) / 1000
        return k < 10 ? String(format: "%.1fk", k) : "\(Int(k.rounded()))k"
    }
    /// "8,218" — grouped, for places with room for the real figure.
    static func grouped(_ n: Int) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? "\(n)"
    }
}

/// Streak stacked VERTICALLY: flame on top, count beneath. The horizontal
/// form clipped the flame as soon as the count reached two digits, because it
/// shared a fixed-width row with the cover stack.
struct StreakStack: View {
    let days: Int
    /// Personal best, shown under the count. nil hides the line entirely —
    /// a reader on their first streak shouldn't be told their record is 1.
    var best: Int? = nil
    var flame: CGFloat = 20
    var number: CGFloat = 17
    var showLabel = false
    /// Puts the count and its unit on ONE line ("2 days"). Stacking them made
    /// the number itself read small, which is the figure that matters.
    var inlineLabel = false

    var body: some View {
        VStack(spacing: 1) {
            Text("🔥").font(.system(size: flame))
            if showLabel && inlineLabel {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(WNum.abbrev(days))
                        .font(W.heading(number))
                        .foregroundStyle(W.fg)
                        .lineLimit(1).minimumScaleFactor(0.5)
                    Text(days == 1 ? "day" : "days")
                        .font(W.body(number * 0.62))
                        .foregroundStyle(W.muted)
                        .lineLimit(1)
                }
            } else {
                Text(WNum.abbrev(days))
                    .font(W.heading(number))
                    .foregroundStyle(W.fg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if showLabel {
                    Text(days == 1 ? "day" : "days")
                        .font(W.body(number * 0.62))
                        .foregroundStyle(W.muted)
                        .lineLimit(1)
                }
            }
            if let best, best > 0 {
                Text(verbatim: "Best: \(WNum.abbrev(best))")
                    .font(W.body(number * 0.56))
                    .foregroundStyle(W.muted.opacity(0.85))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        // Wide enough for "Best: 999" at this type size; the scale factors
        // cover the abbreviated forms so nothing can clip.
        .frame(minWidth: inlineLabel ? number * 2.2 : number * 3.0)
        .fixedSize(horizontal: true, vertical: false)
    }
}

/// Up to three covers in a row at full size, with any remainder peeking out
/// and fading off the right edge — the "there are more books" signal, without
/// the "+N more" caption.
struct CoverRow: View {
    let books: [WidgetBook]
    let total: Int
    let width: CGFloat
    let height: CGFloat
    var spacing: CGFloat = 7

    private var shown: [WidgetBook] { Array(books.prefix(3)) }
    private var trailing: WidgetBook? {
        books.count > 3 ? books[3] : nil
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: spacing) {
            ForEach(shown) { book in
                Link(destination: WidgetLink.book(book)) {
                    WidgetCover(book: book, width: width, height: height)
                }
            }
            // The fade: a fourth cover clipped to a sliver and dissolved into
            // the background with a gradient mask.
            if let extra = trailing {
                WidgetCover(book: extra, width: width, height: height, showProgress: false)
                    .frame(width: width * 0.42, alignment: .leading)
                    .clipped()
                    .mask(
                        LinearGradient(colors: [.black, .black.opacity(0.05)],
                                       startPoint: .leading, endPoint: .trailing)
                    )
                    .opacity(0.75)
            } else if total > shown.count {
                // More are in progress than the snapshot carries covers for.
                Rectangle().fill(.clear).frame(width: 0)
            }
        }
    }
}

/// Goal ring — flat lime arc (never a brand gradient; that belongs to the
/// wordmark). Depth comes from a soft lime glow behind the arc.
struct GoalRing: View {
    let completed: Int
    let target: Int
    var size: CGFloat = 52

    private var frac: Double {
        guard target > 0 else { return 0 }
        return min(1, Double(completed) / Double(target))
    }

    var body: some View {
        ZStack {
            Circle().stroke(W.muted.opacity(0.22), lineWidth: size * 0.10)
            Circle()
                .trim(from: 0, to: frac)
                .stroke(W.accent.opacity(0.55),
                        style: StrokeStyle(lineWidth: size * 0.14, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .blur(radius: size * 0.09)
            Circle()
                .trim(from: 0, to: frac)
                .stroke(W.accent, style: StrokeStyle(lineWidth: size * 0.10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: -2) {
                Text("\(completed)").font(W.heading(size * 0.34)).foregroundStyle(W.fg)
                Text(verbatim: "of \(target)").font(W.body(size * 0.17)).foregroundStyle(W.muted)
            }
        }
        .frame(width: size, height: size)
    }
}

/// Wide goal bar for the small widget's bottom strip — a ring can't use a
/// short, full-width band, so the same data becomes a track with the count
/// inline.
struct GoalBar: View {
    let completed: Int
    let target: Int
    let year: Int

    private var frac: CGFloat {
        guard target > 0 else { return 0 }
        return min(1, CGFloat(completed) / CGFloat(target))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 0) {
                Text(verbatim: "\(year) goal")
                    .font(W.body(9, .medium)).foregroundStyle(W.muted)
                Spacer(minLength: 4)
                Text("\(completed)").font(W.heading(11)).foregroundStyle(W.fg)
                Text(verbatim: " of \(target)").font(W.body(9)).foregroundStyle(W.muted)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(W.muted.opacity(0.22))
                    Capsule().fill(W.accent.opacity(0.5))
                        .frame(width: geo.size.width * frac)
                        .blur(radius: 3)
                    Capsule().fill(W.accent)
                        .frame(width: geo.size.width * frac)
                }
            }
            .frame(height: 5)
        }
    }
}

/// Shown when there's no token or nothing is being read.
struct EmptyState: View {
    let snapshot: WidgetSnapshot
    var compact = false

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: snapshot.signedIn ? "books.vertical" : "person.crop.circle")
                .font(.system(size: compact ? 20 : 26))
                .foregroundStyle(W.accent)
            Text(snapshot.signedIn ? "No book in progress" : "Sign in to tbr*a")
                .font(W.body(compact ? 10 : 12, .medium))
                .foregroundStyle(W.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// "+2 more" — currently-reading books the widget couldn't draw.
struct MoreLabel: View {
    let shown: Int
    let total: Int
    var size: CGFloat = 10

    var body: some View {
        if total > shown {
            Text(verbatim: "+\(total - shown) more")
                .font(W.body(size, .medium))
                .foregroundStyle(W.muted)
        }
    }
}

/// One book's identity line. Only used when a SINGLE book is showing — the
/// case where covers alone leave the widget looking unfinished.
private struct SoloTitle: View {
    let book: WidgetBook
    var titleSize: CGFloat = 14

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(book.title)
                .font(W.heading(titleSize))
                .foregroundStyle(W.fg)
                .lineLimit(2)
            if !book.authorLine.isEmpty {
                Text(book.authorLine)
                    .font(W.body(titleSize - 4))
                    .foregroundStyle(W.muted)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Small (2×2) — the fanned stack
//
// One tap target only (WidgetKit rule), so the whole widget opens the book on
// top of the stack.

struct SmallView: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        if snapshot.books.isEmpty {
            EmptyState(snapshot: snapshot, compact: true)
        } else {
            // Round 3: the "N pages left" and "+2 more" captions are gone, and
            // the covers claim the height they freed. The streak sits in its
            // own fixed column so a 2- or 3-digit count can never be clipped
            // by the stack growing to meet it.
            VStack(alignment: .leading, spacing: 0) {
                // .center, not .top: the streak column reads as floating when
                // pinned to the top of a 90pt cover stack.
                HStack(alignment: .center, spacing: 2) {
                    CoverStack(books: snapshot.books, width: 60, height: 90, step: 18)
                    Spacer(minLength: 0)
                    if snapshot.currentStreak > 0 {
                        StreakStack(days: snapshot.currentStreak,
                                    best: snapshot.longestStreak > snapshot.currentStreak
                                        ? snapshot.longestStreak : nil,
                                    flame: 18, number: 15)
                    }
                }

                Spacer(minLength: 6)

                if let target = snapshot.goalTarget, let done = snapshot.goalCompleted, target > 0 {
                    GoalBar(completed: done, target: target, year: snapshot.year)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Medium (4×2) — adapts to how many books are in progress

struct MediumView: View {
    let snapshot: WidgetSnapshot

    private var shown: [WidgetBook] { Array(snapshot.books.prefix(3)) }

    var body: some View {
        if snapshot.books.isEmpty {
            EmptyState(snapshot: snapshot)
        } else {
            HStack(alignment: .center, spacing: 14) {
                // maxWidth: .infinity + centred content — left-aligning the
                // covers left a dead gutter between them and the goal column.
                booksSide.frame(maxWidth: .infinity)
                goalSide
            }
        }
    }

    /// One book gets its title and author (a lone cover leaves a large empty
    /// plate); two or more are centred in the space they have.
    @ViewBuilder private var booksSide: some View {
        if shown.count == 1, let book = shown[0] as WidgetBook? {
            HStack(spacing: 10) {
                ShelfBackdrop(fills: false) {
                    Link(destination: WidgetLink.book(book)) {
                        WidgetCover(book: book, width: 74, height: 111)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    SoloTitle(book: book)
                    if let remaining = book.remainingLabel {
                        Text(remaining).font(W.body(10)).foregroundStyle(W.muted).lineLimit(1)
                    } else if let length = book.lengthLabel {
                        Text(length).font(W.body(10)).foregroundStyle(W.muted).lineLimit(1)
                    }
                }
            }
        } else {
            // Bigger covers claiming the plate, 3 at full size with a 4th
            // fading off the right — no caption.
            ShelfBackdrop {
                CoverRow(books: snapshot.books, total: snapshot.totalReading,
                         width: 66, height: 99, spacing: 7)
            }
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    /// Goal above, streak below, with a real gap between them — at the old
    /// 7pt they read as one control.
    @ViewBuilder private var goalSide: some View {
        VStack(spacing: 14) {
            if let target = snapshot.goalTarget, let done = snapshot.goalCompleted, target > 0 {
                Link(destination: WidgetLink.goal) {
                    VStack(spacing: 3) {
                        GoalRing(completed: done, target: target, size: 54)
                        Text(verbatim: "\(snapshot.year) goal")
                            .font(W.body(8)).foregroundStyle(W.muted)
                    }
                }
            }
            if snapshot.currentStreak > 0 {
                Link(destination: WidgetLink.home) {
                    StreakStack(days: snapshot.currentStreak,
                                best: snapshot.longestStreak > snapshot.currentStreak
                                    ? snapshot.longestStreak : nil,
                                flame: 20, number: 21, showLabel: true, inlineLabel: true)
                }
            }
        }
    }
}

// MARK: - Large (4×4) — the analytics widget
//
// Top third: the shelf on the left, the streak on the right, vertically
// centred. Bottom two thirds: four stat quadrants. Every quadrant is its own
// tap target.

/// tbr*a's analytics palette — the SAME six colours the Stats page's Top
/// Genres donut uses (StatsView.chartColors), so the widget and the page read
/// as one chart rather than two unrelated ones.
private let chartColors: [Color] = [
    W.accent,                       // lime
    W.neonPurple,                   // purple
    W.neonBlue,                     // neon blue
    Color(hex: "fb923c"),           // orange
    Color(hex: "f472b6"),           // pink
    Color(hex: "34d399"),           // green
]

/// Faint plate behind each quadrant so the four read as distinct cells
/// without boxing them in — the glow still shows through.
private struct Quad<Content: View>: View {
    var alignment: Alignment = .leading
    @ViewBuilder let content: Content
    var body: some View {
        content
            .padding(.horizontal, 11)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(W.surfaceAlt.opacity(0.32))
            )
    }
}

private struct QuadLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(W.body(7.5, .semibold)).tracking(0.7)
            .foregroundStyle(W.muted)
            .lineLimit(1)
    }
}

/// Pages read, drawn as a fanned stack of page edges rather than an emoji —
/// the quantity IS the picture. BLUE, not lime: on the light-mode plate the
/// lime edges washed out to near-invisible.
private struct PaperStack: View {
    private let ink = W.neonBlue
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            ForEach(0..<5, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(ink.opacity(0.34 + 0.14 * Double(4 - i)))
                    .frame(width: 20 - CGFloat(i) * 1.4, height: 3)
                    .offset(x: CGFloat(i) * 1.3, y: -CGFloat(i) * 4.4)
            }
        }
        .frame(width: 26, height: 24, alignment: .bottomLeading)
    }
}

/// Listening time as a small audio waveform. Heights are a fixed pattern, not
/// data — it is an icon, and a fake data-shaped chart would be a lie.
private struct Waveform: View {
    private let heights: [CGFloat] = [4, 9, 14, 7, 16, 11, 5, 12, 8]
    var body: some View {
        HStack(alignment: .center, spacing: 1.6) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, h in
                Capsule()
                    .fill(W.neonPurple.opacity(0.85))
                    .frame(width: 2, height: h)
            }
        }
        .frame(width: 32, height: 18)
    }
}

/// Pace as a speedometer — a half-dial that fills as the reader gets FASTER,
/// so a good pace looks good. Mapped over 1–30 days per book and clamped.
/// A WIDE, shallow gauge arc — an ellipse, not a circle.
///
/// Built by sampling points rather than `Circle().trim()` + `scaleEffect`,
/// because scaling a stroked circle squashes the STROKE too (thick at the
/// sides, thin at the top). Transforming the path and stroking afterwards
/// keeps the line weight uniform all the way round.
private struct GaugeArc: Shape {
    /// 0…1 of the half-turn to draw, sweeping left → right.
    var fraction: Double
    var lineWidth: CGFloat

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard fraction > 0, rect.width > lineWidth, rect.height > lineWidth else { return p }
        // Inset by half the stroke so the round caps stay inside the frame.
        let rx = (rect.width - lineWidth) / 2
        let ry = rect.height - lineWidth
        let cx = rect.midX
        let cy = rect.maxY - lineWidth / 2

        let steps = 160
        for i in 0...steps {
            let t = Double(i) / Double(steps) * fraction
            let angle = Double.pi * (1 - t)          // π (left) → 0 (right)
            let x = cx + CGFloat(cos(angle)) * rx
            let y = cy - CGFloat(sin(angle)) * ry
            let pt = CGPoint(x: x, y: y)
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        return p
    }
}

private struct PaceDial: View {
    let days: Int
    /// The gauge is WIDE but not edge-to-edge: at full card width the ellipse
    /// flattened into a ~3:1 letterbox.
    var height: CGFloat = 56
    var lineWidth: CGFloat = 11
    /// Shared by the arc AND the slower/faster captions so the captions land
    /// directly under the arc's two ends.
    var insetH: CGFloat = 15

    /// Brand neon blue (W.neonBlue) — lime is the goal ring's colour two
    /// cards away, and a second lime arc read as the same metric twice.
    private let dial = W.neonBlue

    private var frac: Double {
        let clamped = min(max(Double(days), 1), 30)
        return 1 - (clamped - 1) / 29
    }

    var body: some View {
        VStack(spacing: 5) {
            ZStack {
                GaugeArc(fraction: 1, lineWidth: lineWidth)
                    .stroke(W.muted.opacity(0.22),
                            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                GaugeArc(fraction: frac, lineWidth: lineWidth)
                    .stroke(dial, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))

                // The value sits INSIDE the arc's bowl. Stacked under the
                // gauge it pushed slower/faster a full row away from the ends
                // they label; a wide ellipse (unlike the old semicircle) has
                // enough interior room to hold it.
                VStack(spacing: -2) {
                    Text("\(days)")
                        .font(W.heading(21))
                        .foregroundStyle(W.fg)
                        .lineLimit(1).minimumScaleFactor(0.5)
                    Text(days == 1 ? "day" : "days")
                        .font(W.body(11))
                        .foregroundStyle(W.muted)
                }
                .offset(y: height * 0.19)
            }
            .frame(height: height)
            .padding(.horizontal, insetH)

            // Now genuinely just beneath the arc's two ends.
            HStack(spacing: 0) {
                Text("slower").font(W.body(7)).foregroundStyle(W.muted.opacity(0.8))
                Spacer(minLength: 0)
                Text("faster").font(W.body(7)).foregroundStyle(W.muted.opacity(0.8))
            }
            .padding(.horizontal, insetH)
        }
        .frame(maxWidth: .infinity)
    }
}

/// The Stats page's Top Genres donut, at widget scale, with its legend.
private struct GenreDonut: View {
    let genres: [WidgetGenre]
    var size: CGFloat = 58

    private var total: Int { max(genres.reduce(0) { $0 + $1.count }, 1) }

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                ForEach(Array(genres.enumerated()), id: \.element.genre) { i, row in
                    let start = genres.prefix(i).reduce(0.0) { $0 + Double($1.count) / Double(total) }
                    let end = start + Double(row.count) / Double(total)
                    Circle()
                        .trim(from: start, to: end)
                        .stroke(chartColors[i % chartColors.count],
                                style: StrokeStyle(lineWidth: size * 0.20))
                        .rotationEffect(.degrees(-90))
                }
            }
            .frame(width: size, height: size)
            .padding(size * 0.10)

            VStack(alignment: .leading, spacing: 2.5) {
                ForEach(Array(genres.prefix(4).enumerated()), id: \.element.genre) { i, row in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(chartColors[i % chartColors.count])
                            .frame(width: 5, height: 5)
                        Text(row.genre)
                            .font(W.body(8))
                            .foregroundStyle(W.fg.opacity(0.9))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
            }
        }
    }
}

struct LargeView: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        VStack(spacing: 9) {
            // Shelf height (96 cover + 6 pad + 9 lip = 111) plus rule 1's
            // clearance beneath the lip.
            shelfRow.frame(height: 96 + ShelfMetrics.chromeHeight)
            quadrants
        }
    }

    /// Books centred in the space left of the streak; the streak stays put on
    /// the right, vertically centred. A SINGLE book still earns its title and
    /// author — one cover alone in a 4×4 leaves an obviously unfinished plate.
    @ViewBuilder private var shelfRow: some View {
        if snapshot.books.isEmpty {
            EmptyState(snapshot: snapshot)
        } else {
            HStack(alignment: .center, spacing: 8) {
                Group {
                    if snapshot.books.count == 1, let book = snapshot.books.first {
                        HStack(spacing: 11) {
                            ShelfBackdrop(fills: false) {
                                Link(destination: WidgetLink.book(book)) {
                                    WidgetCover(book: book, width: 64, height: 96)
                                }
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                SoloTitle(book: book, titleSize: 15)
                                if let remaining = book.remainingLabel {
                                    Text(remaining).font(W.body(10)).foregroundStyle(W.muted)
                                } else if let length = book.lengthLabel {
                                    Text(length).font(W.body(10)).foregroundStyle(W.muted)
                                }
                            }
                        }
                    } else {
                        ShelfBackdrop {
                            CoverRow(books: snapshot.books, total: snapshot.totalReading,
                                     width: 64, height: 96)
                        }
                    }
                }
                .frame(maxWidth: .infinity)   // centres within the shelf area

                if snapshot.currentStreak > 0 {
                    Link(destination: WidgetLink.home) {
                        StreakStack(days: snapshot.currentStreak,
                                    best: snapshot.longestStreak > snapshot.currentStreak
                                        ? snapshot.longestStreak : nil,
                                    flame: 27, number: 21, showLabel: true)
                    }
                }
            }
        }
    }

    private var quadrants: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Link(destination: WidgetLink.goal) { goalQuad }
                Link(destination: WidgetLink.stats) { volumeQuad }
            }
            HStack(spacing: 8) {
                Link(destination: WidgetLink.stats) { paceQuad }
                Link(destination: WidgetLink.stats) { genreQuad }
            }
        }
    }

    // ── top-left: the year's goal ──
    private var goalQuad: some View {
        Quad {
            HStack(spacing: 9) {
                if let target = snapshot.goalTarget, let done = snapshot.goalCompleted, target > 0 {
                    GoalRing(completed: done, target: target, size: 58)
                    VStack(alignment: .leading, spacing: 2) {
                        QuadLabel(text: "\(snapshot.year) GOAL")
                        Text(target > done ? "\(target - done) to go" : "Complete")
                            .font(W.body(10, .semibold))
                            .foregroundStyle(W.fg)
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 3) {
                        QuadLabel(text: "\(snapshot.year) GOAL")
                        Text("Set one").font(W.body(11, .semibold)).foregroundStyle(W.muted)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    // ── top-right: pages read + hours listened ──
    private var volumeQuad: some View {
        Quad(alignment: .center) {
            // Centred as a block rather than pinned to the leading edge.
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .bottom, spacing: 8) {
                    PaperStack()
                    VStack(alignment: .leading, spacing: -1) {
                        Text(WNum.grouped(snapshot.stats.pagesThisYear))
                            .font(W.heading(18))
                            .foregroundStyle(W.fg)
                            .lineLimit(1).minimumScaleFactor(0.6)
                        QuadLabel(text: "PAGES READ")
                    }
                }
                if let listening = snapshot.stats.listeningLabel {
                    HStack(alignment: .center, spacing: 8) {
                        Waveform()
                        VStack(alignment: .leading, spacing: -1) {
                            Text(listening)
                                .font(W.heading(14))
                                .foregroundStyle(W.fg)
                                .lineLimit(1).minimumScaleFactor(0.6)
                            QuadLabel(text: "LISTENED")
                        }
                    }
                }
            }
        }
    }

    // ── bottom-left: pace per book ──
    private var paceQuad: some View {
        Quad(alignment: .center) {
            Group {
                if let pace = snapshot.stats.avgDaysPerBook, pace > 0 {
                    // Clears the pinned label above it.
                    PaceDial(days: pace).padding(.top, 13)
                } else {
                    Text("Finish a book with\nstart and end dates")
                        .font(W.body(9))
                        .foregroundStyle(W.muted)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .overlay(alignment: .topLeading) {
            QuadLabel(text: "PACE PER BOOK")
                .padding(.horizontal, 11)
                .padding(.vertical, 9)
        }
    }

    // ── bottom-right: most-read genres ──
    private var genreQuad: some View {
        Quad {
            VStack(alignment: .leading, spacing: 3) {
                QuadLabel(text: "MOST-READ GENRES")
                if snapshot.stats.topGenres.isEmpty {
                    Text("No genres yet").font(W.body(9)).foregroundStyle(W.muted)
                    Spacer(minLength: 0)
                } else {
                    GenreDonut(genres: snapshot.stats.topGenres)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                }
            }
        }
    }
}

// MARK: - Lock Screen accessories
// Monochrome and tiny, so these stay textual — the cover-first rule applies to
// the home screen, where images can breathe.

struct AccessoryCircularView: View {
    let snapshot: WidgetSnapshot
    var body: some View {
        Gauge(value: Double(snapshot.books.first?.progress ?? 0), in: 0...100) {
            Image(systemName: "book.fill")
        } currentValueLabel: {
            Text("\(snapshot.books.first?.progress ?? 0)")
        }
        .gaugeStyle(.accessoryCircular)
    }
}

struct AccessoryRectangularView: View {
    let snapshot: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let book = snapshot.books.first {
                Text(book.title).font(.headline).lineLimit(1)
                Text(book.progressAndLength.isEmpty ? book.authorLine : book.progressAndLength)
                    .font(.caption).lineLimit(1)
                if snapshot.currentStreak > 0 {
                    Text(verbatim: "🔥 \(snapshot.currentStreak)").font(.caption2).lineLimit(1)
                }
            } else {
                Text("tbr*a").font(.headline)
                Text(snapshot.signedIn ? "No book in progress" : "Sign in").font(.caption)
            }
        }
        .widgetAccentable()
    }
}

struct AccessoryInlineView: View {
    let snapshot: WidgetSnapshot
    var body: some View {
        if let book = snapshot.books.first {
            if let p = book.progress {
                Text(verbatim: "\(p)% · \(book.title)")
            } else {
                Text(book.title)
            }
        } else {
            Text("tbr*a · nothing in progress")
        }
    }
}
