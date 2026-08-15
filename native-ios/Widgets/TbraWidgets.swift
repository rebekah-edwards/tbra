import WidgetKit
import SwiftUI

// tbr*a home-screen + Lock Screen widgets.
//
// Renders ONLY from the App Group snapshot the app publishes
// (WidgetPublisher) — no networking, no auth, no async image loading in the
// view body. That's what keeps the first frame correct instead of grey.
//
// Brand rules that apply here exactly as on web (docs/BRANDING.md):
//   · accent is ALWAYS #a3e635, never darkened toward olive
//   · text on OPAQUE lime is ALWAYS near-black #18181b
//   · titles use Outfit, body uses Plus Jakarta Sans (bundled in this target)

// MARK: - Timeline

struct TbraEntry: TimelineEntry, Sendable {
    let date: Date
    let snapshot: WidgetSnapshot
}

/// TimelineProvider's requirements are the COMPLETION-HANDLER ones (its async
/// forms are defaults that call these, not requirements you can implement
/// instead). Under Swift 6 strict concurrency, capturing the @escaping
/// non-Sendable completion inside a Task is a `sending` violation, so it
/// travels in this box. WidgetKit already invokes these off the main actor
/// and calls the continuation exactly once.
private struct SendableBox<T>: @unchecked Sendable {
    let value: T
}

struct TbraProvider: TimelineProvider {
    func placeholder(in context: Context) -> TbraEntry {
        TbraEntry(date: Date(), snapshot: .sample)
    }

    /// The widget gallery preview. Real data when we have it, sample art
    /// otherwise — never an empty box, which reads as "broken" in the picker.
    func getSnapshot(in context: Context, completion: @escaping (TbraEntry) -> Void) {
        let snap: WidgetSnapshot = context.isPreview ? .sample : (WidgetStore.load() ?? .sample)
        let box = SendableBox(value: completion)
        Task {
            await CoverCache.warm(snap.books)
            box.value(TbraEntry(date: Date(), snapshot: snap))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TbraEntry>) -> Void) {
        let snap = WidgetStore.load() ?? .signedOut
        // One entry, refreshed hourly. The app pushes a reload on every home
        // load and reading-state change, so this is only the backstop for a
        // reader who hasn't opened the app — WidgetKit budgets refreshes, and
        // asking more often just gets throttled.
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date())
            ?? Date().addingTimeInterval(3600)
        let box = SendableBox(value: completion)
        Task {
            // Pull any cover we don't have yet BEFORE handing back the entry,
            // so the view body stays pure disk I/O. Missing art degrades to
            // the gradient placeholder rather than blocking the timeline.
            await CoverCache.warm(snap.books)
            box.value(Timeline(entries: [TbraEntry(date: Date(), snapshot: snap)], policy: .after(next)))
        }
    }
}

// MARK: - Widget definitions

struct TbraReadingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: TbraShared.widgetKind, provider: TbraProvider()) { entry in
            TbraWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    // The app's neon-mesh glow, not a flat fill — the widgets
                    // should read as part of the same surface as the app.
                    WidgetAmbientBackground()
                }
        }
        .configurationDisplayName("Reading Now")
        .description("Your current book, its progress, your streak and reading goal.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct TbraWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TbraEntry

    var body: some View {
        // systemSmall supports exactly ONE tap target, so it opens the book on
        // top of the stack. On medium/large this is only the fallback for
        // blank space — the covers, goal ring and stat tiles carry their own
        // `Link`s, and the nearest enclosing Link wins.
        let target: URL = {
            guard family == .systemSmall, let book = entry.snapshot.books.first else {
                return WidgetLink.home
            }
            return WidgetLink.book(book)
        }()

        Group {
            switch family {
            case .systemSmall:          SmallView(snapshot: entry.snapshot)
            case .systemMedium:         MediumView(snapshot: entry.snapshot)
            case .systemLarge:          LargeView(snapshot: entry.snapshot)
            case .accessoryCircular:    AccessoryCircularView(snapshot: entry.snapshot)
            case .accessoryRectangular: AccessoryRectangularView(snapshot: entry.snapshot)
            case .accessoryInline:      AccessoryInlineView(snapshot: entry.snapshot)
            default:                    SmallView(snapshot: entry.snapshot)
            }
        }
        .widgetURL(target)
    }
}

@main
struct TbraWidgetBundle: WidgetBundle {
    var body: some Widget {
        TbraReadingWidget()
    }
}
