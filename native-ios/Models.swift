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
