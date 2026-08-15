import SwiftUI

/// Debug-only side-by-side of every widget size, at WidgetKit's real point
/// dimensions, driven by the SAME snapshot the widgets read. Shown instead of
/// the app when TBRA_DEBUG_WIDGET_PREVIEW is set (same convention as
/// TBRA_DEBUG_WIZARD_STEP in ReviewWizardView).
///
/// Medium and large adapt to how many books are in progress, so this renders
/// BOTH the one-book and the many-book variant — otherwise the single-book
/// layout only ever gets seen by a reader who happens to have one book open.
///
/// Why it exists: verifying widget layout by adding widgets through
/// SpringBoard is slow and its long-press menus don't reliably render in
/// headless capture, so layout review had no fast feedback loop.
struct WidgetPreviewHarness: View {
    /// Real snapshot when the app has published one, sample data otherwise.
    private var snapshot: WidgetSnapshot {
        let live = WidgetStore.load()
        return (live?.books.isEmpty == false) ? live! : .sample
    }

    /// The same snapshot trimmed to a single book, for the solo layout.
    private var solo: WidgetSnapshot {
        var s = snapshot
        s.books = Array(s.books.prefix(1))
        s.totalReading = 1
        return s
    }

    /// The test account has no reading-pace or listening data, so the two
    /// stat tiles that depend on them never render. This variant fills them
    /// with stand-in numbers PURELY so the layout can be checked — it is
    /// labelled as simulated in the harness and never ships anywhere.
    /// A synthetic 4-book snapshot: the test account only ever has 3, so the
    /// "extra books fade off the right" path is otherwise never exercised.
    private var fourBooks: WidgetSnapshot {
        var s = withStats
        if s.books.count >= 2, s.books.count < 4 {
            var books = s.books
            while books.count < 4 {
                let src = books[books.count % max(s.books.count, 1)]
                books.append(WidgetBook(
                    id: src.id + "-dup\(books.count)", slug: src.slug, title: src.title,
                    authors: src.authors, progress: src.progress, pages: src.pages,
                    audioLengthMinutes: src.audioLengthMinutes, isAudiobook: src.isAudiobook,
                    usesAudiobookCover: src.usesAudiobookCover, coverURL: src.coverURL))
            }
            s.books = books
        }
        s.totalReading = max(s.books.count, s.totalReading)
        return s
    }

    private var withStats: WidgetSnapshot {
        var s = snapshot
        if s.stats.avgDaysPerBook == nil { s.stats.avgDaysPerBook = 12 }
        if s.stats.minutesListened == 0 { s.stats.minutesListened = 7988 }
        if s.stats.pagesThisYear == 0 { s.stats.pagesThisYear = 8218 }
        if s.stats.topGenres.isEmpty {
            s.stats.topGenres = [
                WidgetGenre(genre: "Sci-Fi", count: 12),
                WidgetGenre(genre: "Horror", count: 8),
                WidgetGenre(genre: "Thriller", count: 6),
                WidgetGenre(genre: "Fantasy", count: 4),
                WidgetGenre(genre: "Mystery", count: 3),
            ]
        }
        return s
    }

    // WidgetKit's canonical iPhone sizes (iPhone 17-class, 402pt wide).
    private let small = CGSize(width: 170, height: 170)
    private let medium = CGSize(width: 364, height: 170)
    private let large = CGSize(width: 364, height: 382)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                label("Small (2×2)")
                frame(small) { SmallView(snapshot: snapshot) }

                label("Medium (4×2) — \(snapshot.books.count) books")
                frame(medium) { MediumView(snapshot: snapshot) }

                label("Medium (4×2) — 4 books (fade-off test)")
                frame(medium) { MediumView(snapshot: fourBooks) }
                label("Large (4×4) — 4 books (fade-off test)")
                frame(large) { LargeView(snapshot: fourBooks) }

                label("Medium (4×2) — single book")
                frame(medium) { MediumView(snapshot: solo) }

                label("Large (4×4) — \(snapshot.books.count) books")
                frame(large) { LargeView(snapshot: snapshot) }

                label("Large (4×4) — with pace + listening (simulated numbers)")
                frame(large) { LargeView(snapshot: withStats) }

                label("Large (4×4) — single book")
                frame(large) { LargeView(snapshot: solo) }

                label("Lock Screen — accessoryRectangular")
                frame(CGSize(width: 160, height: 72), background: Color.black) {
                    AccessoryRectangularView(snapshot: snapshot)
                        .foregroundStyle(.white)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.bg)
        // The cover cache is per-process, so in the app the widget's cache is
        // empty and every book would draw its NoCover placeholder. Warm it
        // here so the harness shows the art the real widget shows.
        .task {
            await CoverCache.warm(snapshot.books)
            warmed = true
        }
        .id(warmed)
    }

    /// Flipped once covers land, to force ONE re-render (the views read the
    /// cache synchronously and have no other way to learn it filled). A Bool,
    /// not a UUID: changing .id re-runs the .task, and a fresh UUID each time
    /// would spin forever — assigning `true` twice is a no-op, so it settles.
    @State private var warmed = false

    private func label(_ text: String) -> some View {
        Text(text).font(Theme.body(12, .semibold)).foregroundStyle(Theme.muted)
    }

    private func frame<Content: View>(
        _ size: CGSize,
        background: Color? = nil,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        content()
            .padding(14)                       // WidgetKit's own content inset
            .frame(width: size.width, height: size.height)
            // Default to the real widget backdrop; an explicit color is only
            // used for the Lock Screen row, which renders on the wallpaper.
            .background {
                if let background { background } else { WidgetAmbientBackground() }
            }
            .clipShape(RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.border, lineWidth: 1))
    }
}
