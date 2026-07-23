import SwiftUI

// ── Global report button — web global-report-button.tsx parity ──────────
// Floating yellow flag above the bottom bar on every screen, visible to
// super admins + beta testers (the web layout applies the same gate). Files
// a reported_issues row with the current screen's web-path equivalent via
// POST /api/v1/report; book/series slugs are parsed out of the path server-
// side compatible with the web's submitIssue flow.

struct GlobalReportButton: View {
    @Environment(AuthStore.self) private var auth
    @Environment(ChromeState.self) private var chrome: ChromeState?
    @State private var open = false

    private var canReport: Bool {
        if case .signedIn(let u) = auth.phase {
            return ["super_admin", "beta_tester"].contains(u.accountType)
        }
        return false
    }

    private let yellow = Color(hex: "eab308")

    var body: some View {
        if canReport {
            Button {
                open = true
            } label: {
                Image(systemName: "flag")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(yellow)
                    .frame(width: 44, height: 44)
                    .background(yellow.opacity(0.15), in: Circle())
                    .overlay(Circle().stroke(yellow.opacity(0.3), lineWidth: 1))
                    .shadow(color: .black.opacity(0.25), radius: 8, y: 2)
            }
            .sheet(isPresented: $open) {
                GlobalReportSheet(pageUrl: chrome?.currentPage ?? "/")
                    .presentationDetents([.medium])
                    .presentationBackground(Theme.surface)
            }
        }
    }
}

private struct GlobalReportSheet: View {
    let pageUrl: String
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Report an issue")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
            // Beta-tester framing (user request 2026-07-23) — mirrors the
            // book-page report sheet's explanatory line.
            Text("Spotted something off — a bug, a glitch, or info that isn't right? Describe it here and it goes straight to the tbr*a team with the page you're on.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            Text(pageUrl)
                .font(Theme.body(12))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Theme.surfaceAlt.opacity(0.6), in: Capsule())

            TextEditor(text: $text)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground)
                .scrollContentBackground(.hidden)
                .padding(10)
                .frame(minHeight: 110)
                .background(Theme.surfaceAlt.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("Describe the issue...")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted.opacity(0.6))
                            .padding(.top, 18).padding(.leading, 15)
                            .allowsHitTesting(false)
                    }
                }

            if failed {
                Text("Couldn't send — try again.")
                    .font(Theme.body(12)).foregroundStyle(Theme.destructive)
            }

            Button {
                sending = true
                failed = false
                Task {
                    struct Body: Codable, Sendable {
                        let pageUrl: String
                        let description: String
                        let bookSlug: String?
                        let seriesSlug: String?
                    }
                    struct Ok: Codable { let ok: Bool }
                    let bookSlug = Self.match(pageUrl, prefix: "/book/")
                    let seriesSlug = Self.match(pageUrl, prefix: "/series/")
                    let res: Ok? = try? await APIClient.shared.request(
                        "/api/v1/report", method: "POST",
                        json: Body(pageUrl: pageUrl, description: text,
                                   bookSlug: bookSlug, seriesSlug: seriesSlug))
                    sending = false
                    if res?.ok == true { dismiss() } else { failed = true }
                }
            } label: {
                if sending { ProgressView().tint(.black) } else { Text("Send report") }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Spacer(minLength: 0)
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bg)
    }

    private static func match(_ path: String, prefix: String) -> String? {
        guard path.hasPrefix(prefix) else { return nil }
        let rest = path.dropFirst(prefix.count)
        let slug = rest.split(separator: "/").first.map(String.init)
        return (slug?.isEmpty == false) ? slug : nil
    }
}

extension View {
    /// Stamp the screen's web-path equivalent for the global reporter.
    /// Fires on appear — including re-appear when a pushed screen pops back.
    func reportsPage(_ path: String) -> some View {
        modifier(ReportsPageModifier(path: path))
    }
}

private struct ReportsPageModifier: ViewModifier {
    let path: String
    @Environment(ChromeState.self) private var chrome: ChromeState?
    func body(content: Content) -> some View {
        content.onAppear { chrome?.currentPage = path }
    }
}
