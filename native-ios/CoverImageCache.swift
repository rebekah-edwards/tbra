import SwiftUI
import UIKit

/// Cover loader that replaces `AsyncImage` in list rows.
///
/// WHY NOT AsyncImage (tester report 2b67d3ea, 2026-07-20 — "book covers
/// don't load on the library page"):
///
///  1. **It never retries.** One transient failure — a dropped request, a
///     timeout, a moment of no signal — and that row shows the placeholder
///     for the lifetime of the view. Nothing re-attempts it. The tester's own
///     screenshots show the book detail page rendering the cover fine while
///     the library row for the SAME book stayed blank, which is this exactly.
///  2. **It's cancelled by fast scrolling.** In a lazy grid the cell leaves
///     the window mid-request, the task is cancelled, and on the way back
///     AsyncImage starts from `.empty` — with no result cached, a scroll
///     through a long library leaves a trail of blanks.
///  3. **It has no memory cache of decoded images.** It leans entirely on
///     URLCache, so every re-appearance re-decodes at best, re-downloads at
///     worst.
///
/// This does the three things that fixes: an in-memory cache of DECODED
/// images (so a re-appearing row is instant and cannot flicker), request
/// de-duplication (a grid showing the same cover twice fetches once), and one
/// retry on failure.
@MainActor
final class CoverImageCache {
    static let shared = CoverImageCache()

    private let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        // Thumbnails are small; a few hundred covers is a couple of MB and
        // spans any realistic library scroll.
        c.countLimit = 400
        return c
    }()

    /// In-flight loads keyed by URL, so N rows wanting the same cover make
    /// ONE request and all await it.
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    func cached(_ url: URL) -> UIImage? {
        cache.object(forKey: url.absoluteString as NSString)
    }

    func load(_ url: URL) async -> UIImage? {
        let key = url.absoluteString
        if let hit = cache.object(forKey: key as NSString) { return hit }
        if let running = inFlight[key] { return await running.value }

        let task = Task<UIImage?, Never> { [weak self] in
            // Two attempts. The retry is the entire point: a single failed
            // GET must not condemn the row to a permanent placeholder.
            for attempt in 0..<2 {
                if Task.isCancelled { return nil }
                var req = URLRequest(url: url)
                req.cachePolicy = .returnCacheDataElseLoad
                req.timeoutInterval = 15
                if let (data, response) = try? await URLSession.shared.data(for: req),
                   (response as? HTTPURLResponse)?.statusCode == 200,
                   let image = UIImage(data: data) {
                    await self?.store(image, for: key)
                    return image
                }
                if attempt == 0 {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                }
            }
            return nil
        }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        return result
    }

    private func store(_ image: UIImage, for key: String) {
        cache.setObject(image, forKey: key as NSString)
    }
}

/// Drop-in replacement for the `AsyncImage` that used to live inside
/// `CoverThumb`. Renders a cached image synchronously when we already have
/// it — no placeholder frame, so a scrolled-back row never flashes.
struct CachedCoverImage<Placeholder: View>: View {
    let url: URL?
    @ViewBuilder let placeholder: Placeholder

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                placeholder
            }
        }
        // .task(id:) restarts when the row is recycled onto a different book.
        .task(id: url) {
            guard let url else { image = nil; return }
            if let hit = CoverImageCache.shared.cached(url) {
                image = hit
                return
            }
            image = await CoverImageCache.shared.load(url)
        }
    }
}
