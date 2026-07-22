import Foundation

/// URLSession client for the tbr*a native API (docs/native-api-contract.md).
///
/// Auth: sends the Keychain access token as a Bearer header. On a 401 it tries
/// once to rotate the refresh token (POST /auth/refresh), stores the new pair,
/// and retries the original request. If refresh fails, it throws
/// `.unauthorized` and the UI should route back to login.
actor APIClient {
    static let shared = APIClient()

    /// Dev: a Mac-hosted `npm run dev`. Point at production otherwise.
    /// Set once at launch before any request; `nonisolated(unsafe)` is the
    /// standard Swift 6 escape hatch for a start-up-configured global.
    #if targetEnvironment(simulator)
    // TBRA_DEBUG_BASEURL lets the agent point the sim at the Tailscale IP to
    // reproduce device-only host quirks (e.g. WKWebView cookie handling on
    // IP-literal hosts) headlessly.
    nonisolated(unsafe) static var baseURL =
        ProcessInfo.processInfo.environment["TBRA_DEBUG_BASEURL"].flatMap(URL.init(string:))
        ?? URL(string: "http://localhost:3000")!
    #elseif DEBUG
    // Physical device, Debug (push-to-phone.sh): the Mac's Tailscale address
    // (clanker-macmini). Cleartext HTTP is fine here — the tailnet wraps it
    // in WireGuard. The Mac's dev server (port 3000) must be running.
    nonisolated(unsafe) static var baseURL = URL(string: "http://100.84.95.103:3000")!
    #else
    // Release (TestFlight / App Store): production. Info.plist (the Release
    // one) has no ATS exception, so this must stay https.
    nonisolated(unsafe) static var baseURL = URL(string: "https://thebasedreader.app")!
    #endif

    /// Admin surfaces ALWAYS talk to production (2026-07-22): admin actions
    /// (account upgrades, report triage, cover fixes) must land on the live
    /// DB — on the Mac's dev copy they'd strand behind the user-table sync
    /// safety filter. Local dev and prod share AUTH_SECRET, so the app's
    /// session token verifies on both hosts (confirmed before switching).
    nonisolated static let adminBaseURL = URL(string: "https://thebasedreader.app")!

    private let session = URLSession.shared
    private let decoder = JSONDecoder()

    // MARK: Auth

    /// Sign in with Apple: exchanges the ASAuthorization identityToken for
    /// the native session pair. fullName only arrives on FIRST authorization.
    func appleLogin(identityToken: String, fullName: String?) async throws -> LoginResponse {
        var body: [String: Any] = ["identityToken": identityToken]
        if let fullName, !fullName.isEmpty { body["fullName"] = fullName }
        let res: LoginResponse = try await send(
            "/api/v1/auth/apple", method: "POST", body: body, authed: false
        )
        Keychain.accessToken = res.token
        Keychain.refreshToken = res.refreshToken
        return res
    }

    func login(email: String, password: String) async throws -> LoginResponse {
        let res: LoginResponse = try await send(
            "/api/v1/auth/login", method: "POST",
            body: ["email": email, "password": password], authed: false
        )
        Keychain.accessToken = res.token
        Keychain.refreshToken = res.refreshToken
        return res
    }

    func me() async throws -> PublicUser {
        let res: MeResponse = try await send("/api/v1/auth/me", method: "GET")
        return res.user
    }

    func logout() async {
        if let refresh = Keychain.refreshToken {
            _ = try? await send("/api/v1/auth/logout", method: "POST",
                                body: ["refreshToken": refresh], authed: false) as OkResponse
        }
        Keychain.clear()
    }

    // MARK: Up Next

    func upNext() async throws -> [UpNextItem] {
        let res: UpNextResponse = try await send("/api/v1/up-next", method: "GET")
        return res.items
    }

    func addToUpNext(bookId: String) async throws {
        _ = try await send("/api/v1/up-next", method: "POST",
                           body: ["bookId": bookId]) as OkResponse
    }

    func removeFromUpNext(bookId: String) async throws {
        _ = try await send("/api/v1/up-next/\(bookId)", method: "DELETE") as OkResponse
    }

    /// Send the COMPLETE queue in the new order.
    func reorderUpNext(bookIds: [String]) async throws {
        _ = try await send("/api/v1/up-next/order", method: "PUT",
                           body: ["bookIds": bookIds]) as OkResponse
    }

    // MARK: Shelves

    func shelves() async throws -> (mine: [ShelfSummary], followed: [FollowedShelf]) {
        let res: ShelvesResponse = try await send("/api/v1/shelves", method: "GET")
        return (res.shelves, res.followed ?? [])
    }

    func createShelf(name: String, description: String?, isPublic: Bool, color: String?) async throws {
        var body: [String: Any] = ["name": name, "isPublic": isPublic]
        if let description, !description.isEmpty { body["description"] = description }
        if let color { body["color"] = color }
        _ = try await send("/api/v1/shelves", method: "POST", body: body) as OkResponse
    }

    func updateShelf(id: String, name: String, description: String?, isPublic: Bool, color: String?) async throws {
        // Explicit JSON null clears the color back to the Amber default.
        let body: [String: Any] = ["name": name,
                                   "description": description ?? "",
                                   "isPublic": isPublic,
                                   "color": color ?? NSNull()]
        _ = try await send("/api/v1/shelves/\(id)", method: "PATCH", body: body) as OkResponse
    }

    func deleteShelf(id: String) async throws {
        _ = try await send("/api/v1/shelves/\(id)", method: "DELETE") as OkResponse
    }

    func shelf(id: String) async throws -> ShelfDetail {
        let res: ShelfResponse = try await send("/api/v1/shelves/\(id)", method: "GET")
        return res.shelf
    }

    /// Send the COMPLETE set of the user's shelves in the new order.
    func reorderShelves(shelfIds: [String]) async throws {
        _ = try await send("/api/v1/shelves/order", method: "PUT",
                           body: ["shelfIds": shelfIds]) as OkResponse
    }

    func addBook(toShelf shelfId: String, bookId: String) async throws {
        _ = try await send("/api/v1/shelves/\(shelfId)/books", method: "POST",
                           body: ["bookId": bookId]) as OkResponse
    }

    func removeBook(fromShelf shelfId: String, bookId: String) async throws {
        _ = try await send("/api/v1/shelves/\(shelfId)/books/\(bookId)", method: "DELETE") as OkResponse
    }

    /// Send the COMPLETE set of the shelf's books in the new order.
    func reorderShelfBooks(shelfId: String, bookIds: [String]) async throws {
        _ = try await send("/api/v1/shelves/\(shelfId)/order", method: "PUT",
                           body: ["bookIds": bookIds]) as OkResponse
    }

    /// Set or clear the per-book "note to self" on a shelf.
    func updateShelfBookNote(shelfId: String, bookId: String, note: String?) async throws {
        _ = try await send("/api/v1/shelves/\(shelfId)/books/\(bookId)", method: "PATCH",
                           body: ["note": note ?? NSNull()]) as OkResponse
    }

    // MARK: Top Shelf (favorites)

    struct FavoritesResponse: Codable { let ok: Bool; let favorites: [FavoriteBookRow] }

    func favorites() async throws -> [FavoriteBookRow] {
        let res: FavoritesResponse = try await send("/api/v1/favorites", method: "GET")
        return res.favorites
    }

    /// Send the COMPLETE Top Shelf in the new order.
    func reorderFavorites(bookIds: [String]) async throws {
        _ = try await send("/api/v1/favorites", method: "PUT",
                           body: ["bookIds": bookIds]) as OkResponse
    }

    /// Toggle a book off (or onto) the Top Shelf.
    func toggleFavorite(bookId: String) async throws {
        _ = try await send("/api/v1/books/\(bookId)/favorite", method: "POST",
                           body: [String: String]()) as OkResponse
    }

    // MARK: Admin — native cover picker

    struct CoverEditorData: Codable {
        struct BookCovers: Codable {
            let id: String
            let title: String
            let coverImageUrl: String?
            let audiobookCoverUrl: String?
        }
        struct External: Codable, Hashable {
            let url: String
            let source: String
            let label: String
        }
        struct OLEdition: Codable, Hashable {
            let coverId: Int
            let title: String?
            let format: String?
            let year: String?
        }
        let ok: Bool
        let book: BookCovers
        let external: [External]
        let olEditions: [OLEdition]
    }

    func coverEditor(bookId: String) async throws -> CoverEditorData {
        try await send("/api/v1/admin/cover-editor", method: "GET",
                       query: [URLQueryItem(name: "bookId", value: bookId)])
    }

    /// nil url = remove the cover (book lands on the /admin/covers queue).
    func setCover(bookId: String, url: String?) async throws {
        _ = try await send("/api/v1/admin/books/\(bookId)/cover", method: "POST",
                           body: ["url": url ?? NSNull()]) as OkResponse
    }

    func setAudiobookCover(bookId: String, url: String?) async throws {
        _ = try await send("/api/v1/admin/books/\(bookId)/cover", method: "POST",
                           body: ["audiobookUrl": url ?? NSNull()]) as OkResponse
    }

    /// Multipart upload of a JPEG; returns the stored /uploads/... URL.
    func uploadCover(bookId: String, jpeg: Data) async throws -> String {
        struct Res: Codable { let ok: Bool; let url: String }
        let boundary = "tbra-\(UUID().uuidString)"
        var form = Data()
        form.append("--\(boundary)\r\n".data(using: .utf8)!)
        form.append("Content-Disposition: form-data; name=\"cover\"; filename=\"cover.jpg\"\r\n".data(using: .utf8)!)
        form.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        form.append(jpeg)
        form.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        let res: Res = try await send("/api/v1/admin/books/\(bookId)/cover", method: "POST",
                                      bodyData: form,
                                      contentType: "multipart/form-data; boundary=\(boundary)")
        return res.url
    }

    // MARK: Register + public posts

    struct AuthPair: Codable { let token: String; let refreshToken: String; let user: PublicUser }

    func register(email: String, password: String, referralCode: String?) async throws -> AuthPair {
        var body: [String: Any] = ["email": email, "password": password]
        if let referralCode { body["referralCode"] = referralCode }
        return try await send("/api/v1/auth/register", method: "POST", body: body, authed: false)
    }

    /// Unauthenticated POST with a typed body (forgot-password etc).
    func postPublic<T: Decodable, B: Encodable & Sendable>(_ path: String, json: B) async throws -> T {
        let data = try JSONEncoder().encode(json)
        return try await send(path, method: "POST", bodyData: data, authed: false)
    }

    // MARK: Generic

    /// Generic GET for simple endpoint fetches (decodes the full envelope).
    func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "GET")
    }

    /// Generic GET with query items (NEVER bake "?k=v" into the path —
    /// appending(path:) percent-encodes the "?" and the server 404s).
    func get<T: Decodable>(_ path: String, query: [URLQueryItem]) async throws -> T {
        try await send(path, method: "GET", query: query)
    }

    /// Generic POST with a JSON body.
    func post<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        try await send(path, method: "POST", body: body)
    }

    /// Generic request with a typed Encodable JSON body (PUT flows).
    /// Sendable payload structs cross actor isolation cleanly where
    /// `[String: Any]` trips Swift 6 region analysis.
    func request<T: Decodable, B: Encodable & Sendable>(_ path: String, method: String, json: B) async throws -> T {
        let data = try JSONEncoder().encode(json)
        return try await send(path, method: method, bodyData: data)
    }

    /// Generic body-less request (DELETE flows).
    func request<T: Decodable>(_ path: String, method: String) async throws -> T {
        try await send(path, method: method)
    }

    /// Untyped-JSON request (admin field editor — heterogeneous payloads
    /// with strings/numbers/bools/NSNull).
    func request<T: Decodable>(_ path: String, method: String, body: [String: Any]) async throws -> T {
        try await send(path, method: method, body: body)
    }

    // MARK: Admin (production-targeted — see adminBaseURL)

    func adminGet<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "GET", base: Self.adminBaseURL)
    }

    func adminRequest<T: Decodable>(_ path: String, method: String, body: [String: Any]) async throws -> T {
        try await send(path, method: method, body: body, base: Self.adminBaseURL)
    }

    // MARK: Profile

    func profile() async throws -> ProfileData {
        try await send("/api/v1/profile", method: "GET")
    }

    // MARK: Discover

    /// Returns (books, reasons-by-book-id).
    func discover(body: [String: Any]) async throws -> (books: [LiteBook], reasons: [String: String], remaining: Int?) {
        struct Row: Codable {
            let id: String; let slug: String?; let title: String
            let coverImageUrl: String?; let authors: [String]
            let aggregateRating: Double?; let hasContentConflict: Bool
            let reason: String?
        }
        struct Res: Codable { let ok: Bool; let results: [Row]; let remaining: Int? }
        let res: Res = try await send("/api/v1/discover", method: "POST", body: body)
        let books = res.results.map {
            LiteBook(id: $0.id, slug: $0.slug, title: $0.title, coverImageUrl: $0.coverImageUrl,
                     authors: $0.authors, aggregateRating: $0.aggregateRating,
                     hasContentConflict: $0.hasContentConflict)
        }
        var reasons: [String: String] = [:]
        for row in res.results where row.reason != nil { reasons[row.id] = row.reason }
        return (books, reasons, res.remaining)
    }

    // MARK: Stats

    func stats(year: String) async throws -> StatsData {
        try await send("/api/v1/stats", method: "GET",
                       query: [URLQueryItem(name: "year", value: year)])
    }

    // MARK: Search

    func search(_ query: String) async throws -> [SearchResult] {
        // NOTE: never bake "?q=" into the path — appending(path:) percent-
        // encodes the "?" and the server 404s. Query items go via `query:`.
        let res: SearchResponse = try await send(
            "/api/v1/search", method: "GET",
            query: [URLQueryItem(name: "q", value: query)]
        )
        return res.results
    }

    // MARK: Library

    func library() async throws -> [LibraryBook] {
        let res: LibraryResponse = try await send("/api/v1/library", method: "GET")
        return res.books
    }

    // MARK: Book detail

    func bookDetail(_ idOrSlug: String) async throws -> BookDetailData {
        try await send("/api/v1/books/\(idOrSlug)", method: "GET")
    }

    /// Owned and/or active formats — same rules as the web.
    func setFormats(bookId: String, owned: [String]? = nil, active: [String]? = nil) async throws {
        var body: [String: Any] = [:]
        if let owned { body["owned"] = owned }
        if let active { body["active"] = active }
        _ = try await send("/api/v1/books/\(bookId)/formats", method: "POST", body: body) as OkResponse
    }

    /// "Remove Everything" — review, rating, editions, sessions, state.
    func removeFromLibrary(bookId: String) async throws {
        _ = try await send("/api/v1/books/\(bookId)/library", method: "DELETE") as OkResponse
    }

    // MARK: Home (Reading Now + goal + streak)

    func home() async throws -> HomeData {
        let res: HomeResponse = try await send("/api/v1/home", method: "GET")
        return HomeData(year: res.year, readingNow: res.readingNow, goal: res.goal,
                        streak: res.streak, tbrSuggestion: res.tbrSuggestion)
    }

    /// The deferred home sections (Because You Liked / Friends Activity /
    /// Discover Something New) — loaded after the fold, like the web.
    func homeDiscover() async throws -> HomeDiscoverData {
        let res: HomeDiscoverResponse = try await send("/api/v1/home/discover", method: "GET")
        return HomeDiscoverData(becauseYouLiked: res.becauseYouLiked,
                                friendsActivity: res.friendsActivity,
                                discover: res.discover)
    }

    /// "Show me another" — reshuffle the Pick From Your Shelf suggestion.
    func shuffleTbrSuggestion() async throws -> TbrSuggestion? {
        let res: TbrSuggestionResponse = try await send("/api/v1/home/tbr-suggestion", method: "GET")
        return res.suggestion
    }

    func setReadingGoal(targetBooks: Int) async throws {
        _ = try await send("/api/v1/reading-goal", method: "POST",
                           body: ["targetBooks": targetBooks]) as OkResponse
    }

    /// The Track Progress sheet — same validation + writes as the web action.
    func addReadingNote(
        bookId: String, noteText: String,
        pageNumber: Int? = nil, percentComplete: Int? = nil,
        mood: String? = nil, pace: String? = nil, buddyReadId: String? = nil
    ) async throws {
        var body: [String: Any] = ["bookId": bookId, "noteText": noteText]
        if let pageNumber { body["pageNumber"] = pageNumber }
        if let percentComplete { body["percentComplete"] = percentComplete }
        if let mood { body["mood"] = mood }
        if let pace { body["pace"] = pace }
        if let buddyReadId { body["buddyReadId"] = buddyReadId }
        _ = try await send("/api/v1/reading-notes", method: "POST", body: body) as OkResponse
    }

    /// Reading-state changes; completed/dnf carry a completion date (YYYY-MM-DD).
    func setReadingState(
        bookId: String, state: String,
        completionDate: String? = nil, completionPrecision: String? = nil
    ) async throws {
        var body: [String: Any] = ["bookId": bookId, "state": state]
        if let completionDate { body["completionDate"] = completionDate }
        if let completionPrecision { body["completionPrecision"] = completionPrecision }
        _ = try await send("/api/v1/reading-state", method: "POST", body: body) as OkResponse
    }

    // MARK: Core request + refresh

    private func send<T: Decodable>(
        _ path: String, method: String,
        query: [URLQueryItem]? = nil,
        body: [String: Any]? = nil, bodyData: Data? = nil,
        contentType: String = "application/json",
        authed: Bool = true, isRetry: Bool = false,
        base: URL? = nil
    ) async throws -> T {
        var url = (base ?? Self.baseURL).appending(path: path)
        if let query { url.append(queryItems: query) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } else if let bodyData {
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
            req.httpBody = bodyData
        }
        if authed, let token = Keychain.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.decoding }

        if http.statusCode == 401 && authed && !isRetry {
            // Access token expired — rotate once and retry.
            try await refreshAccessToken()
            return try await send(path, method: method, query: query, body: body, bodyData: bodyData, authed: authed, isRetry: true, base: base)
        }

        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(APIErrorBody.self, from: data))?.error
            if http.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.server(status: http.statusCode, message: message ?? "Request failed.")
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    private func refreshAccessToken() async throws {
        guard let refresh = Keychain.refreshToken else { throw APIError.unauthorized }
        do {
            let res: RefreshResponse = try await send(
                "/api/v1/auth/refresh", method: "POST",
                body: ["refreshToken": refresh], authed: false
            )
            Keychain.accessToken = res.token
            Keychain.refreshToken = res.refreshToken
        } catch {
            Keychain.clear()
            throw APIError.unauthorized
        }
    }
}
