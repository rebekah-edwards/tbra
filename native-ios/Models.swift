import Foundation

// Codable models mirroring docs/native-api-contract.md. The API sends snake_case
// nowhere — the query layer already returns camelCase JSON keys — so these map
// 1:1 with default decoding.

struct PublicUser: Codable, Identifiable, Hashable {
    let id: String
    let email: String
    let username: String?
    let displayName: String?
    let avatarUrl: String?
    let accountType: String
    let emailVerified: Bool
}

struct UpNextItem: Codable, Identifiable, Hashable {
    let id: String
    let bookId: String
    let slug: String?
    let position: Int
    let title: String
    let coverImageUrl: String?
    let authorName: String?
    let topLevelGenre: String?
    let pages: Int?
    let audioLengthMinutes: Int?
    let userRating: Double?
}

struct ShelfSummary: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let slug: String
    let description: String?
    let color: String?
    let coverImageUrl: String?
    let isPublic: Bool
    let position: Int
    let bookCount: Int
    let coverUrls: [String]
    let coverSlugs: [String]
    let createdAt: String
}

/// A shelf the user follows (web: FollowedShelf in queries/shelves.ts).
struct FollowedShelf: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let slug: String
    let description: String?
    let color: String?
    let bookCount: Int
    let coverUrls: [String]
    let ownerUsername: String
    let ownerDisplayName: String?
    let followedAt: String
}

struct ShelfBook: Codable, Identifiable, Hashable {
    // Books are unique within a shelf by bookId — use it as the identity.
    var id: String { bookId }
    let bookId: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let position: Int
    let note: String?
    let state: String?
    let addedAt: String
    let userRating: Double?
    let publicationYear: Int?
    let pages: Int?
    let isFiction: Bool?
    let genres: [String]
    let ownedFormats: [String]
    let aggregateRating: Double?
}

struct ShelfDetail: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let slug: String
    let description: String?
    let color: String?
    let coverImageUrl: String?
    let isPublic: Bool
    let position: Int
    let createdAt: String
    let userId: String
    let books: [ShelfBook]
    // Owner attribution (added 2026-07-13): header link + rating-pill avatar.
    let ownerUsername: String?
    let ownerDisplayName: String?
    let ownerAvatarUrl: String?
}

// ─── Home (Reading Now + goal + streak) ───

struct ReadingNowBook: Codable, Identifiable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    /// True when coverImageUrl is the admin-uploaded SQUARE audiobook image —
    /// the only case where the cover renders in a square frame. Optional so
    /// older server payloads still decode.
    let usesAudiobookCover: Bool?
    let authors: [String]
    let pages: Int?
    /// Audiobook runtime in minutes, when the catalog has one. Shown instead
    /// of the page count for readers whose active format is audiobook.
    let audioLengthMinutes: Int?
    let activeFormats: [String]
    let progress: Int?          // 0-100, derived from the latest reading note
    let buddyReadId: String?
}

struct ReadingGoal: Codable, Hashable {
    let targetBooks: Int
    let completedBooks: Int
    let percentComplete: Int
}

struct ReadingStreak: Codable, Hashable {
    let currentStreak: Int
    let longestStreak: Int
}

struct TbrSuggestion: Codable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let reason: String?
}

struct HomeData: Hashable {
    let year: Int
    let readingNow: [ReadingNowBook]
    let goal: ReadingGoal?
    let streak: ReadingStreak
    let tbrSuggestion: TbrSuggestion?
}

struct HomeResponse: Codable {
    let ok: Bool
    let year: Int
    let readingNow: [ReadingNowBook]
    let goal: ReadingGoal?
    let streak: ReadingStreak
    let tbrSuggestion: TbrSuggestion?
}

// ─── Home deferred sections (/api/v1/home/discover) ───

/// The site's BookCard payload: bare cover + rating pill + conflict badge.
struct LiteBook: Codable, Identifiable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let aggregateRating: Double?
    let hasContentConflict: Bool
}

struct BylSeed: Codable, Hashable { let id: String; let title: String }
struct BylSection: Codable, Hashable {
    let seed: BylSeed
    let books: [LiteBook]
}

struct ActivityUser: Codable, Hashable {
    let id: String
    let displayName: String?
    let username: String?
    let avatarUrl: String?
}
struct ActivityBookRef: Codable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
}
struct ActivityItem: Codable, Hashable {
    let type: String   // completed | review | rating | currently_reading | tbr | reading_note
    let user: ActivityUser
    let book: ActivityBookRef
    let rating: Double?
    let reviewPreview: String?
    let reviewId: String?
    let percentComplete: Double?
    let pageNumber: Int?
    let timestamp: String
}

struct HomeDiscoverData: Hashable {
    let becauseYouLiked: [BylSection]
    let friendsActivity: [ActivityItem]
    let discover: [LiteBook]
}

struct HomeDiscoverResponse: Codable {
    let ok: Bool
    let becauseYouLiked: [BylSection]
    let friendsActivity: [ActivityItem]
    let discover: [LiteBook]
}

struct TbrSuggestionResponse: Codable {
    let ok: Bool
    let suggestion: TbrSuggestion?
}

// ─── Profile (/api/v1/profile) ───

struct ProfileUser: Codable, Hashable {
    let id: String
    let displayName: String?
    let username: String?
    let avatarUrl: String?
    let accountType: String?
    let createdAt: String
    // Edit-Profile prefill — only the own-profile payload sends these;
    // public-profile decodes leave them nil.
    let bio: String?
    let instagram: String?
    let tiktok: String?
    let threads: String?
    let twitter: String?
    let isPrivate: Bool?
}

struct ProfileStats: Codable, Hashable {
    let completed: Int
    let currentlyReading: Int
    let tbr: Int
    let owned: Int
}

struct JournalNote: Codable, Hashable, Identifiable {
    let id: String
    let bookId: String
    let bookSlug: String?
    let bookTitle: String
    let bookCoverUrl: String?
    let noteText: String
    let pageNumber: Int?
    let percentComplete: Int?
    let mood: String?
    let pace: String?
    let isPrivate: Bool?
    let createdAt: String
}

/// "4" for whole series positions, "4.5" for novella slots.
enum SeriesPos {
    static func label(_ pos: Double) -> String {
        pos.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(pos)) : String(format: "%.1f", pos)
    }
}

struct FavoriteBookRow: Codable, Hashable, Identifiable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let position: Int
    let userRating: Double?
}

/// One review row as getUserReviewsWithBooks emits it (shared by
/// /api/v1/profile and /api/v1/users/[username]).
struct UserReviewRow: Codable, Hashable, Identifiable {
    let reviewId: String
    let bookId: String
    let bookSlug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let rating: Double?
    let reviewText: String?
    let didNotFinish: Bool
    let dnfPercentComplete: Double?
    let isAnonymous: Bool
    let createdAt: String
    var id: String { reviewId }
}

struct ProfileData: Codable, Hashable {
    let ok: Bool
    let user: ProfileUser
    let stats: ProfileStats
    let favorites: [FavoriteBookRow]
    let reviews: [UserReviewRow]
    let journalNotes: [JournalNote]
    let followerCount: Int
    let followingCount: Int
    let shelves: [ShelfSummary]
    let referralCode: String
    let referralCount: Int
}

// ─── Stats (/api/v1/stats) ───

struct MonthCount: Codable, Hashable { let month: String; let count: Int }
struct MonthPages: Codable, Hashable { let month: String; let pages: Int }
struct YearCount: Codable, Hashable { let year: String?; let count: Int; let pages: Int }
struct GenreCount: Codable, Hashable { let genre: String; let count: Int }
struct RatingBucket: Codable, Hashable { let bucket: String; let count: Int }
struct AuthorCount: Codable, Hashable { let author: String; let count: Int }
struct ReadingPace: Codable, Hashable { let avgDays: Int; let totalBooks: Int }
struct PageStats: Codable, Hashable { let totalPages: Int; let bookCount: Int }
struct FictionSplit: Codable, Hashable { let fiction: Int; let nonfiction: Int }

struct StatsData: Codable, Hashable {
    let ok: Bool
    let currentYear: Int
    let goal: ReadingGoal?
    let streak: ReadingStreak
    let booksByMonth: [MonthCount]
    let booksByYear: [YearCount]
    let pagesByMonth: [MonthPages]
    let genreBreakdown: [GenreCount]
    let ratingDistribution: [RatingBucket]
    let mostReadAuthors: [AuthorCount]
    let readingPace: ReadingPace?
    let pageStats: PageStats
    let minutesListened: Int
    let fictionSplit: FictionSplit
}

// ─── Search (/api/v1/search) ───

struct SearchResult: Codable, Identifiable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let publicationYear: Int?
    let pages: Int?
    let state: String?      // the user's existing reading state, if any
    let ownedCount: Int     // owned formats count (excl. "unknown")
}

struct SearchResponse: Codable {
    let ok: Bool
    let results: [SearchResult]
}

// ─── Library (/api/v1/library) ───

struct LibraryBook: Codable, Identifiable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    /// See ReadingNowBook.usesAudiobookCover — square frame gate.
    let usesAudiobookCover: Bool?
    let authors: [String]
    let state: String?
    let ownedFormats: [String]
    let activeFormats: [String]
    let isFiction: Bool?
    let userRating: Double?
    let updatedAt: String?
    let genres: [String]
    let completionYear: Int?
    let tbrNote: String?
    /// Server-computed "a rating exceeds the viewer's comfort zone"
    /// (2026-07-22) — drives the ⚠ cover badge + the Flagged sub-filter.
    let hasContentConflict: Bool?
}

struct LibraryResponse: Codable {
    let ok: Bool
    let books: [LibraryBook]
}

// ─── Book detail (/api/v1/books/[id]) ───

struct BookAuthor: Codable, Hashable {
    let id: String
    let name: String
    let slug: String?
    let role: String?
}

struct BookSeriesInfo: Codable, Hashable {
    let id: String
    let name: String
    let slug: String?
}

struct ContentRating: Codable, Hashable, Identifiable {
    var id: String { categoryId }
    let categoryId: String
    let categoryKey: String
    let categoryName: String
    let intensity: Int          // 0 None · 1 Mild · 2 Moderate · 3 Significant · 4 Extreme
    let notes: String?
    let evidenceLevel: String?  // e.g. human_verified
}

struct BookFull: Codable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    // Details tab (2026-07-15) — the v1 payload spreads the full book row,
    // these were just never declared for decoding.
    let publicationDate: String?
    let publisher: String?
    let language: String?
    let isbn10: String?
    let authors: [BookAuthor]
    let seriesInfo: BookSeriesInfo?
    // Double, NOT Int: novellas sit at fractional positions (Fairest = Lunar
    // Chronicles #3.5) — Int? made the whole book page fail to decode
    // (2026-07-23 "Unexpected response from the server" on 3 of her TBR taps).
    let seriesPosition: Double?
    let genres: [String]
    let topLevelGenre: String?
    let ageCategory: String?
    let pacing: String?
    let publicationYear: Int?
    let pages: Int?
    let audioLengthMinutes: Int?
    let summary: String?
    let description: String?
    let isbn13: String?
    let asin: String?
    let isBoxSet: Bool?
    let isFiction: Bool?
    /// Admin-uploaded SQUARE audiobook image (books.audiobook_cover_url).
    let audiobookCoverUrl: String?
    let ratings: [ContentRating]
}

struct BookUserState: Codable, Hashable {
    let state: String?
    let ownedFormats: [String]
    let activeFormats: [String]
}

struct BookAggregate: Codable, Hashable {
    let average: Double?
    let count: Int
}

struct BookPageShelf: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct ReadingSessionRow: Codable, Hashable, Identifiable {
    let id: String
    let readNumber: Int
    let state: String
    let startedAt: String?
    let startedAtExplicit: Bool?
    let completionDate: String?
    let completionPrecision: String?
    let activeFormats: [String]?
    let pausedAt: String?
    /// Days accumulated across every pause period on this read. Optional so
    /// older payloads still decode.
    let totalPausedDays: Int?
}

struct BookNote: Codable, Hashable, Identifiable {
    let id: String
    let noteText: String
    let pageNumber: Int?
    let percentComplete: Int?
    let mood: String?
    let pace: String?
    let isPrivate: Bool?
    let createdAt: String
}

struct FriendWhoRead: Codable, Hashable, Identifiable {
    var id: String { userId }
    let userId: String
    let displayName: String?
    let username: String?
    let avatarUrl: String?
    let state: String?
    let rating: Double?
    /// Their review of THIS book — the payload always carried it; tapping
    /// the card opens it (user request 2026-07-14).
    let reviewId: String?
}

struct BookDetailData: Codable, Hashable {
    let ok: Bool
    let book: BookFull
    let slug: String?
    /// Server-computed (2026-07-25): no content ratings yet — enrichment
    /// hasn't completed. Fetching the payload also auto-triggers enrichment
    /// server-side, so the client just polls until this flips false.
    let needsEnrichment: Bool?
    /// The last enrichment attempt hit the spent API budget — show the calm
    /// "queued" notice instead of the blocking wait overlay.
    let enrichmentQueued: Bool?
    /// Server-computed: the user's formats select the audiobook AND a real
    /// square image exists — hero renders square + swaps to that image.
    let usesAudiobookCover: Bool?
    /// Server-computed full display-cover cascade (audiobook square →
    /// owned-edition cover → canonical) — same as the web book page.
    let effectiveCoverUrl: String?
    let userState: BookUserState?
    let hasCompleted: Bool
    let sessions: [ReadingSessionRow]
    let readingNotes: [BookNote]
    let friendsWhoRead: [FriendWhoRead]
    let isHidden: Bool
    let upNextPosition: Int?
    let upNextCount: Int
    let isFavorited: Bool
    let aggregate: BookAggregate?
    let userRating: Double?
    let userShelves: [BookPageShelf]
    let bookShelfIds: [String]
    let tbrNote: String?
    // Content comfort-zone flags (2026-07-16) — server-computed, mirrors
    // the web ContentWarningBanner inputs. Optional: older payloads decode.
    let contentConflicts: [ContentConflict]?
    let reviewerWarnings: [ReviewerWarning]?
    let noteWarnings: [NoteWarning]?
}

/// Book intensity exceeds the user's max tolerance for a category.
struct ContentConflict: Codable, Hashable {
    let categoryName: String
    let bookIntensity: Int
    let userMax: Int
}

/// Reviewers flagged a topic on the user's avoid list.
struct ReviewerWarning: Codable, Hashable {
    let label: String
    let count: Int
}

/// A topic on the user's avoid list appears in admin content notes.
struct NoteWarning: Codable, Hashable {
    let label: String
    let categories: [String]
}

// ─── Response envelopes ───

struct LoginResponse: Codable {
    let token: String
    let refreshToken: String
    let user: PublicUser
}

struct RefreshResponse: Codable {
    let token: String
    let refreshToken: String
}

struct MeResponse: Codable { let user: PublicUser }
struct UpNextResponse: Codable { let ok: Bool; let items: [UpNextItem] }
struct ShelvesResponse: Codable {
    let ok: Bool
    let shelves: [ShelfSummary]
    /// Shelves the user FOLLOWS (optional for decode-compat).
    let followed: [FollowedShelf]?
}
struct ShelfResponse: Codable { let ok: Bool; let shelf: ShelfDetail }
struct OkResponse: Codable { let ok: Bool }

struct APIErrorBody: Codable { let error: String }

enum APIError: Error, LocalizedError {
    case unauthorized
    case server(status: Int, message: String)
    case decoding
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Your session expired. Please sign in again."
        case .server(_, let message): return message
        case .decoding: return "Unexpected response from the server."
        case .transport(let e): return e.localizedDescription
        }
    }

    /// True when the failure is just a cancelled in-flight request — e.g.
    /// SwiftUI cancels a `.task` load when its screen is pushed over. These
    /// must never surface as user-facing alerts: the "Error: cancelled" that
    /// popped after backing out of My Shelves (2026-07-13) was this.
    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        if case .transport(let inner) = error as? APIError {
            return isCancellation(inner)
        }
        return false
    }
}

// ── Format icons — mirrors web format-button.tsx leadFormatIcon ──
enum FormatIcon {
    /// One SF Symbol per reading format (web FormatIcon SVGs).
    static func symbol(for format: String?) -> String {
        switch format {
        case "hardcover": return "book.closed"
        case "paperback": return "book"
        case "ebook": return "ipad"
        case "audiobook": return "headphones"
        case "set": return "books.vertical"
        default: return "books.vertical"
        }
    }

    /// Web leadFormatIcon: exactly one active format → its icon; multiple →
    /// neutral stack; none → single owned format, else audiobook if owned,
    /// else neutral. NEVER defaults to a specific format's icon.
    static func lead(active: [String], owned: [String]) -> String {
        if active.count == 1 { return symbol(for: active[0]) }
        if active.count > 1 { return "books.vertical" }
        let realOwned = owned.filter { $0 != "unknown" }
        if realOwned.count == 1 { return symbol(for: realOwned[0]) }
        if realOwned.contains("audiobook") { return "headphones" }
        return "books.vertical"
    }
}
