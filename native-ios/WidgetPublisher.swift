import Foundation
import WidgetKit

// App-side half of the widget pipeline (the extension never imports this).
// Pulls /api/v1/widget — one call carrying the reading-now list, goal, streak
// and the year-to-date stats the large widget shows — and writes it to the
// shared keychain blob the extension reads.
//
// Why the app publishes instead of the widget fetching: the extension gets a
// few seconds and a tight memory ceiling per timeline refresh, and it can't
// safely run the app's token-refresh dance in parallel with the app. Pushing
// from here means the widget's render path is pure disk I/O and always has
// something real to show.

enum WidgetPublisher {
    /// The largest widget draws at most 4 covers; the server already trims to
    /// this, and `totalReading` carries the true count for the "+N" label.
    private static let maxBooks = 4

    private struct Response: Codable {
        struct Book: Codable {
            let id: String
            let slug: String?
            let title: String
            let coverImageUrl: String?
            let usesAudiobookCover: Bool?
            let authors: [String]
            let pages: Int?
            let audioLengthMinutes: Int?
            let activeFormats: [String]
            let progress: Int?
        }
        struct Goal: Codable {
            let targetBooks: Int
            let completedBooks: Int
            let percentComplete: Int
        }
        struct Streak: Codable { let currentStreak: Int; let longestStreak: Int }
        struct Stats: Codable {
            let topGenres: [WidgetGenre]
            let avgDaysPerBook: Int?
            let booksThisYear: Int
            let pagesThisYear: Int
            let minutesListened: Int
        }
        let year: Int
        let totalReading: Int
        let readingNow: [Book]
        let goal: Goal?
        let streak: Streak
        let stats: Stats
    }

    /// Refresh the widgets from the server. Safe to call often — it's one
    /// small request, and a failure leaves the previous snapshot in place
    /// rather than blanking the home screen.
    static func refresh() async {
        guard let res: Response = try? await APIClient.shared.get("/api/v1/widget") else { return }

        let books = res.readingNow.prefix(maxBooks).map { b in
            WidgetBook(
                id: b.id,
                slug: b.slug,
                title: b.title,
                authors: b.authors,
                progress: b.progress,
                pages: b.pages,
                audioLengthMinutes: b.audioLengthMinutes,
                isAudiobook: b.activeFormats.contains("audiobook"),
                usesAudiobookCover: b.usesAudiobookCover ?? false,
                coverURL: b.coverImageUrl
            )
        }

        WidgetStore.save(WidgetSnapshot(
            year: res.year,
            books: Array(books),
            totalReading: res.totalReading,
            stats: WidgetStats(
                topGenres: res.stats.topGenres,
                avgDaysPerBook: res.stats.avgDaysPerBook,
                booksThisYear: res.stats.booksThisYear,
                pagesThisYear: res.stats.pagesThisYear,
                minutesListened: res.stats.minutesListened
            ),
            currentStreak: res.streak.currentStreak,
            longestStreak: res.streak.longestStreak,
            goalTarget: res.goal?.targetBooks,
            goalCompleted: res.goal?.completedBooks,
            goalPercent: res.goal?.percentComplete,
            updatedAt: Date(),
            signedIn: true
        ))

        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Logout: wipe the snapshot so the home screen stops showing the last
    /// reader's shelf, and leave the widget in its explicit signed-out state.
    /// (The widget's own cover cache prunes itself on the next timeline pass,
    /// once the empty snapshot leaves nothing referenced.)
    static func clear() {
        WidgetStore.save(.signedOut)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
