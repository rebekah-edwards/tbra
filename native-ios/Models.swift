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
