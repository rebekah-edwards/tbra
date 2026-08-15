import Foundation
import Security

// Shared between the app and the TbraWidgets extension. Compiled into BOTH
// targets (project.yml lists this file explicitly for the extension), so it
// must not import anything the extension can't have — no UIKit-only app APIs.
//
// TRANSPORT: the shared KEYCHAIN, not an App Group container.
//
// The natural choice would be an App Group — but `group.app.tbra.ios` has to
// be created in the Developer portal web UI (App Store Connect's API has no
// appGroups endpoint; verified 2026-08-13, returns 404), and this Mac has no
// Xcode signing account, so a device build demanding that capability fails
// provisioning outright. The keychain group `$(AppIdentifierPrefix)app.tbra.ios`
// is ALREADY in both targets' entitlements and already satisfied by the
// existing profiles, so it needs no portal work and no new profile.
//
// The snapshot is a few hundred bytes of non-secret display data — well
// within what a generic-password item is meant to carry. Covers are NOT
// stored here; the widget downloads them into its own cache (see below),
// because binary blobs do not belong in the keychain.
//
// If the App Group is ever registered in the portal, swap `SharedBlob` for a
// container file and let the app pre-download covers — everything above this
// layer stays the same.

public enum TbraShared {
    /// WidgetKit `kind` — also the string passed to reloadTimelines.
    public static let widgetKind = "TbraReadingWidget"
    /// Keychain service for app↔extension shared display state. Separate from
    /// the auth-token service so clearing one never clears the other.
    static let sharedService = "app.tbra.widget"
    /// Already granted by the existing provisioning profiles on both targets.
    static let accessGroup = "E5ZFZ263ET.app.tbra.ios"
}

/// Tiny keychain-backed blob store shared by the app and the extension.
enum SharedBlob {
    /// Base query, optionally scoped to the shared access group.
    ///
    /// The group is what lets the extension see the app's item, but the
    /// SIMULATOR cannot honour `kSecAttrAccessGroup` — simulator builds are
    /// ad-hoc signed and have no application-identifier, so a keychain call
    /// naming a group fails with errSecMissingEntitlement (-34018). Every
    /// call therefore tries the shared group first and falls back to the
    /// process-local keychain, which keeps the app and the debug preview
    /// harness working in the simulator while devices still get real sharing.
    private static func query(_ key: String, grouped: Bool) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: TbraShared.sharedService,
            kSecAttrAccount as String: key,
        ]
        if grouped { q[kSecAttrAccessGroup as String] = TbraShared.accessGroup }
        return q
    }

    static func write(_ data: Data, key: String) {
        for grouped in [true, false] {
            let q = query(key, grouped: grouped)
            SecItemDelete(q as CFDictionary)
            var add = q
            add[kSecValueData as String] = data
            // The widget renders on the Lock Screen, so it must stay readable
            // while the phone is locked — but only after one unlock since boot.
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            if SecItemAdd(add as CFDictionary, nil) == errSecSuccess { return }
        }
    }

    static func read(key: String) -> Data? {
        for grouped in [true, false] {
            var q = query(key, grouped: grouped)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
               let data = out as? Data {
                return data
            }
        }
        return nil
    }
}

// MARK: - Snapshot model

public struct WidgetBook: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let slug: String?
    public let title: String
    public let authors: [String]
    /// 0–100 from the latest reading note, or nil when the reader hasn't
    /// logged progress yet. nil is NOT 0 — the widget renders them
    /// differently ("Not started" vs a 0% bar).
    public let progress: Int?
    public let pages: Int?
    public let audioLengthMinutes: Int?
    /// The reader's active format for THIS book is audiobook, so length
    /// should read as runtime rather than pages.
    public let isAudiobook: Bool
    /// True only when the cover really is the square audiobook image.
    public let usesAudiobookCover: Bool
    /// Remote cover URL. The widget caches the bytes itself (CoverCache).
    public let coverURL: String?

    public init(id: String, slug: String?, title: String, authors: [String],
                progress: Int?, pages: Int?, audioLengthMinutes: Int?,
                isAudiobook: Bool, usesAudiobookCover: Bool, coverURL: String?) {
        self.id = id; self.slug = slug; self.title = title; self.authors = authors
        self.progress = progress; self.pages = pages
        self.audioLengthMinutes = audioLengthMinutes
        self.isAudiobook = isAudiobook; self.usesAudiobookCover = usesAudiobookCover
        self.coverURL = coverURL
    }

    public var authorLine: String { authors.first ?? "" }

    /// "398 pages" / "11h 42m" — the length line Rebekah asked for. Prefers
    /// runtime when the reader is actually listening AND the catalog has a
    /// runtime; falls back to pages so an audiobook reader with no cached
    /// runtime still sees something (53% of currently-reading books have a
    /// runtime, 96% have a page count).
    public var lengthLabel: String? {
        if isAudiobook, let m = audioLengthMinutes, m > 0 {
            let h = m / 60, r = m % 60
            return h > 0 ? (r > 0 ? "\(h)h \(r)m" : "\(h)h") : "\(r)m"
        }
        if let p = pages, p > 0 { return "\(p) pages" }
        if let m = audioLengthMinutes, m > 0 {
            let h = m / 60, r = m % 60
            return h > 0 ? (r > 0 ? "\(h)h \(r)m" : "\(h)h") : "\(r)m"
        }
        return nil
    }

    /// "62% · 398 pages", the compact one-line form for medium/large rows.
    public var progressAndLength: String {
        var parts: [String] = []
        if let p = progress, p > 0 { parts.append("\(p)%") }
        if let l = lengthLabel { parts.append(l) }
        return parts.joined(separator: " · ")
    }

    /// Remaining pages/time, when we know both progress and length. This is
    /// the number a reader actually wants mid-book.
    public var remainingLabel: String? {
        guard let p = progress, p > 0, p < 100 else { return nil }
        let frac = Double(100 - p) / 100.0
        if isAudiobook, let m = audioLengthMinutes, m > 0 {
            let left = Int((Double(m) * frac).rounded())
            let h = left / 60, r = left % 60
            return h > 0 ? "\(h)h \(r)m left" : "\(r)m left"
        }
        if let pg = pages, pg > 0 {
            return "\(Int((Double(pg) * frac).rounded())) pages left"
        }
        return nil
    }
}

/// Year-to-date figures for the large widget. All optional-ish: a new reader
/// has none of them, and each row hides itself rather than showing a zero.
/// One slice of the top-genres donut. Carries the count so the widget can
/// draw the same proportional chart the Stats page does.
public struct WidgetGenre: Codable, Hashable, Sendable, Identifiable {
    public let genre: String
    public let count: Int
    public var id: String { genre }
    public init(genre: String, count: Int) { self.genre = genre; self.count = count }
}

public struct WidgetStats: Codable, Hashable, Sendable {
    public var topGenres: [WidgetGenre]
    public var avgDaysPerBook: Int?
    public var booksThisYear: Int
    public var pagesThisYear: Int
    public var minutesListened: Int

    public init(topGenres: [WidgetGenre] = [], avgDaysPerBook: Int? = nil,
                booksThisYear: Int = 0, pagesThisYear: Int = 0, minutesListened: Int = 0) {
        self.topGenres = topGenres; self.avgDaysPerBook = avgDaysPerBook
        self.booksThisYear = booksThisYear; self.pagesThisYear = pagesThisYear
        self.minutesListened = minutesListened
    }

    /// "6h 12m" — hidden entirely when the reader listens to nothing.
    public var listeningLabel: String? {
        guard minutesListened > 0 else { return nil }
        let h = minutesListened / 60, m = minutesListened % 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }
    public var paceLabel: String? {
        guard let d = avgDaysPerBook, d > 0 else { return nil }
        return d == 1 ? "1 day/book" : "\(d) days/book"
    }
}

public struct WidgetSnapshot: Codable, Hashable, Sendable {
    public var year: Int
    public var books: [WidgetBook]
    /// Total currently-reading count, which can exceed `books.count` — the
    /// widget only carries the few it can draw but still says "+N more".
    public var totalReading: Int
    public var stats: WidgetStats
    public var currentStreak: Int
    public var longestStreak: Int
    public var goalTarget: Int?
    public var goalCompleted: Int?
    public var goalPercent: Int?
    public var updatedAt: Date
    /// False when the app has no token — the widget shows a "Sign in" state
    /// rather than a misleading empty shelf.
    public var signedIn: Bool

    public init(year: Int, books: [WidgetBook], totalReading: Int = 0,
                stats: WidgetStats = WidgetStats(),
                currentStreak: Int, longestStreak: Int,
                goalTarget: Int?, goalCompleted: Int?, goalPercent: Int?,
                updatedAt: Date, signedIn: Bool) {
        self.year = year; self.books = books
        self.totalReading = max(totalReading, books.count); self.stats = stats
        self.currentStreak = currentStreak; self.longestStreak = longestStreak
        self.goalTarget = goalTarget; self.goalCompleted = goalCompleted
        self.goalPercent = goalPercent
        self.updatedAt = updatedAt; self.signedIn = signedIn
    }

    public static let signedOut = WidgetSnapshot(
        year: Calendar.current.component(.year, from: Date()), books: [],
        currentStreak: 0, longestStreak: 0, goalTarget: nil, goalCompleted: nil,
        goalPercent: nil, updatedAt: Date(), signedIn: false)

    /// Gallery/placeholder sample — never shows real data, so it's safe for
    /// the widget picker and for redacted (Lock Screen privacy) rendering.
    public static let sample = WidgetSnapshot(
        year: Calendar.current.component(.year, from: Date()),
        books: [
            WidgetBook(id: "s1", slug: nil, title: "The Wind in the Willows",
                       authors: ["Kenneth Grahame"], progress: 62, pages: 398,
                       audioLengthMinutes: nil, isAudiobook: false,
                       usesAudiobookCover: false, coverURL: nil),
            WidgetBook(id: "s2", slug: nil, title: "A Study in Scarlet",
                       authors: ["Arthur Conan Doyle"], progress: 18, pages: nil,
                       audioLengthMinutes: 702, isAudiobook: true,
                       usesAudiobookCover: false, coverURL: nil),
        ],
        currentStreak: 12, longestStreak: 40, goalTarget: 60, goalCompleted: 23,
        goalPercent: 38, updatedAt: Date(), signedIn: true)
}

// MARK: - Group-container store

public enum WidgetStore {
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }()
    private static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }()

    private static let key = "snapshot.v1"

    public static func load() -> WidgetSnapshot? {
        guard let data = SharedBlob.read(key: key),
              let snap = try? decoder.decode(WidgetSnapshot.self, from: data)
        else { return nil }
        return snap
    }

    public static func save(_ snapshot: WidgetSnapshot) {
        guard let data = try? encoder.encode(snapshot) else { return }
        SharedBlob.write(data, key: key)
    }
}

// MARK: - Cover cache (widget-local)

/// Covers live in the WIDGET's own caches directory, keyed by remote URL.
/// They can't ride in the keychain (binary blobs don't belong there) and
/// there's no shared container, so the extension fetches them once and
/// re-reads them from disk on every subsequent render.
public enum CoverCache {
    private static var dir: URL? {
        guard let base = try? FileManager.default.url(
            for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        else { return nil }
        let d = base.appendingPathComponent("covers", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func fileURL(for remote: String) -> URL? {
        // Hash the URL so an edition/cover change misses the cache naturally.
        var h: UInt64 = 5381
        for b in remote.utf8 { h = (h &* 33) &+ UInt64(b) }
        return dir?.appendingPathComponent("c\(h).img")
    }

    public static func cachedData(for remote: String?) -> Data? {
        guard let remote, !remote.isEmpty, let url = fileURL(for: remote) else { return nil }
        return try? Data(contentsOf: url)
    }

    /// Fetches any covers the snapshot references but the cache lacks.
    /// Called from the timeline provider BEFORE it hands back an entry, so
    /// the render itself stays pure disk I/O.
    public static func warm(_ books: [WidgetBook]) async {
        await withTaskGroup(of: Void.self) { group in
            for book in books {
                guard let remote = book.coverURL, !remote.isEmpty,
                      let dest = fileURL(for: remote),
                      !FileManager.default.fileExists(atPath: dest.path),
                      let url = URL(string: remote) else { continue }
                group.addTask {
                    guard let (data, response) = try? await URLSession.shared.data(from: url),
                          (response as? HTTPURLResponse)?.statusCode == 200,
                          !data.isEmpty else { return }
                    try? data.write(to: dest, options: .atomic)
                }
            }
        }
        prune(keeping: Set(books.compactMap { $0.coverURL.flatMap(fileURL(for:))?.lastPathComponent }))
    }

    /// Drops files no longer referenced — otherwise the cache grows by one
    /// image every time a reader changes books, forever.
    private static func prune(keeping keep: Set<String>) {
        guard let dir, let files = try? FileManager.default.contentsOfDirectory(atPath: dir.path)
        else { return }
        for f in files where !keep.contains(f) {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(f))
        }
    }
}
