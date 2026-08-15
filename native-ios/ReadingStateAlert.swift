import SwiftUI

/// Surfaces reading-state failures instead of dropping them.
///
/// Every `setReadingState` call site used `try?`, so a failed POST — 500,
/// expired token, timeout, offline — was swallowed, the view immediately
/// re-read the server, and the UNCHANGED state rendered. That is exactly what
/// the 2026-08-04 TestFlight report described: "going elsewhere and back it
/// just goes back to the old status." The reader saw nothing, and we got no
/// signal from the field either.
///
/// One shared box rather than per-view @State: these call sites live across
/// four files inside sheets, covers and nav stacks, and an alert bound at the
/// shell root fires from all of them.
@MainActor
@Observable
final class ReadingStateAlert {
    static let shared = ReadingStateAlert()
    private init() {}

    var message: String?

    /// Records a failure for display. Returns nothing — callers that need to
    /// know whether to re-read the server should use `perform` below.
    func report(_ error: Error) {
        message = (error as? APIError)?.errorDescription
            ?? "Couldn't update this book. Check your connection and try again."
    }

    /// Runs a reading-state mutation, surfacing any failure. Returns true when
    /// the write actually landed, so callers can skip the reload that would
    /// otherwise repaint the stale value over the user's action.
    @discardableResult
    func perform(_ work: () async throws -> Void) async -> Bool {
        do {
            try await work()
            return true
        } catch {
            report(error)
            return false
        }
    }
}

private struct ReadingStateErrorAlert: ViewModifier {
    @Bindable private var box = ReadingStateAlert.shared

    func body(content: Content) -> some View {
        content.alert(
            "Couldn't save that",
            isPresented: Binding(
                get: { box.message != nil },
                set: { if !$0 { box.message = nil } }
            )
        ) {
            Button("OK", role: .cancel) { box.message = nil }
        } message: {
            Text(box.message ?? "")
        }
    }
}

extension View {
    /// Attach once per presentation context (shell root + each full-screen
    /// cover) so a failure raised inside a sheet still has a presenter.
    func readingStateErrorAlert() -> some View {
        modifier(ReadingStateErrorAlert())
    }
}
