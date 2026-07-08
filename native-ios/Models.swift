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
}

// ─── Home (Reading Now + goal + streak) ───

struct ReadingNowBook: Codable, Identifiable, Hashable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let pages: Int?
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

struct FavoriteBookRow: Codable, Hashable, Identifiable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let authors: [String]
    let position: Int
    let userRating: Double?
}

struct ProfileData: Codable, Hashable {
    let ok: Bool
    let user: ProfileUser
    let stats: ProfileStats
    let favorites: [FavoriteBookRow]
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
    let authors: [BookAuthor]
    let seriesInfo: BookSeriesInfo?
    let seriesPosition: Int?
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
}

struct BookDetailData: Codable, Hashable {
    let ok: Bool
    let book: BookFull
    let slug: String?
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
struct ShelvesResponse: Codable { let ok: Bool; let shelves: [ShelfSummary] }
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
}
