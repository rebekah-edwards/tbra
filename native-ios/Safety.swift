import SwiftUI

// ── Report and Block ────────────────────────────────────────────────────
// App Review guideline 1.2: an app with user-generated content must let a
// reader report objectionable content and block an abusive user. These are
// the native twins of the web's SafetyMenu (src/components/safety/) and talk
// to the same server code:
//   POST   /api/v1/report/content          report a review or profile
//   POST   /api/v1/users/<username>/block  block
//   DELETE /api/v1/users/<username>/block  unblock
//   GET    /api/v1/blocks                  the Settings list
// Blocking hides each reader from the other (reviews, profile, search,
// buddy-read messages) and ends any follow between them. The blocked reader
// is not told.

enum SafetyAPI {
    private struct Ok: Codable { let ok: Bool }

    static func block(_ username: String) async throws {
        let _: Ok = try await APIClient.shared.request("/api/v1/users/\(username)/block", method: "POST")
    }

    static func unblock(_ username: String) async throws {
        let _: Ok = try await APIClient.shared.request("/api/v1/users/\(username)/block", method: "DELETE")
    }

    struct ReportBody: Codable, Sendable {
        let kind: String        // "review" | "profile"
        let username: String
        let reason: String
        let details: String?
        let reviewId: String?
        let bookSlug: String?
    }

    static func report(_ body: ReportBody) async throws {
        let _: Ok = try await APIClient.shared.request("/api/v1/report/content", method: "POST", json: body)
    }

    struct BlockedReader: Codable, Identifiable, Hashable {
        let id: String
        let username: String?
        let displayName: String?
        let avatarUrl: String?
        let blockedAt: String
    }

    static func blockedReaders() async -> [BlockedReader] {
        struct Res: Codable { let ok: Bool; let blocked: [BlockedReader] }
        let res: Res? = try? await APIClient.shared.get("/api/v1/blocks")
        return res?.blocked ?? []
    }
}

/// What a report is about. `username` is the reader who wrote the review or
/// owns the profile.
struct SafetyTarget: Hashable {
    enum Kind: String { case review, profile }
    let kind: Kind
    let username: String
    var reviewId: String? = nil
    var bookSlug: String? = nil
    /// False for an anonymous review: it can be reported, but offering to
    /// block would reveal who wrote it.
    var canBlock = true
}

/// The "⋯" button on another reader's review or profile. A system `Menu`,
/// so it gets native hit-testing and Liquid Glass for free.
struct SafetyMenuButton: View {
    let target: SafetyTarget
    /// Called after a successful block so the screen can drop the content.
    var onBlocked: () -> Void = {}

    @State private var reporting = false
    @State private var confirmingBlock = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Menu {
            Button {
                reporting = true
            } label: {
                Label(target.kind == .review ? "Report this review" : "Report this profile", systemImage: "flag")
            }
            if target.canBlock {
                Button(role: .destructive) {
                    confirmingBlock = true
                } label: {
                    Label("Block @\(target.username)", systemImage: "nosign")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(target.kind == .review ? "Report or block" : "Report or block this reader")
        .opacity(busy ? 0.5 : 1)
        .sheet(isPresented: $reporting) {
            ReportSheet(target: target, onBlock: target.canBlock ? { confirmingBlock = true } : nil)
                .presentationDetents([.large])
                .presentationBackground(Theme.surface)
        }
        .confirmationDialog("Block @\(target.username)?", isPresented: $confirmingBlock, titleVisibility: .visible) {
            Button("Block", role: .destructive) { Task { await block() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You won't see each other's reviews, profiles or buddy-read messages, and you'll stop following each other. They won't be told. You can unblock them in Settings.")
        }
        .alert("Couldn't block this reader", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: { Text(error ?? "") }
    }

    private func block() async {
        busy = true; defer { busy = false }
        do {
            try await SafetyAPI.block(target.username)
            onBlocked()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Try again in a moment."
        }
    }
}

/// Pick a reason, add an optional note, send. Mirrors the web panel; the
/// reason keys match REPORT_REASONS in src/lib/actions/blocks.ts.
struct ReportSheet: View {
    let target: SafetyTarget
    /// Offered on the confirmation screen when the reader can be blocked.
    var onBlock: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    private static let reasons: [(key: String, label: String)] = [
        ("spam", "Spam or advertising"),
        ("harassment", "Harassment or bullying"),
        ("hate", "Hate speech"),
        ("sexual", "Sexual or explicit content"),
        ("spoilers", "Spoilers without a warning"),
        ("other", "Something else"),
    ]

    @State private var reason: String?
    @State private var details = ""
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if sent { confirmation } else { form }
            }
            .padding(20)
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(target.kind == .review ? "Report this review" : "Report this profile")
                    .font(Theme.heading(22, .bold))
                    .foregroundStyle(Theme.foreground)
                Text("Why are you reporting this?")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }

            VStack(spacing: 8) {
                ForEach(Self.reasons, id: \.key) { item in
                    let picked = reason == item.key
                    Button { reason = item.key } label: {
                        HStack(spacing: 12) {
                            Image(systemName: picked ? "largecircle.fill.circle" : "circle")
                                .font(.system(size: 18))
                                .foregroundStyle(picked ? Theme.accentText : Theme.muted)
                            Text(item.label)
                                .font(Theme.body(15, picked ? .semibold : .regular))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .background(Theme.surfaceAlt.opacity(picked ? 1 : 0.5), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14)
                            .stroke(picked ? Theme.accent.opacity(0.7) : Theme.border, lineWidth: 1))
                        .contentShape(RoundedRectangle(cornerRadius: 14))
                    }
                }
            }

            TextField("Anything else we should know? (optional)", text: $details, axis: .vertical)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground)
                .lineLimit(3...6)
                .padding(12)
                .background(Theme.surfaceAlt.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))

            if let error {
                Text(error).font(Theme.body(13)).foregroundStyle(Theme.destructive)
            }

            HStack(spacing: 12) {
                Button("Cancel") { dismiss() }
                    .font(Theme.body(15, .medium))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                Button {
                    Task { await send() }
                } label: {
                    Text(sending ? "Sending…" : "Send report")
                        .font(Theme.body(15, .bold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Theme.accent, in: Capsule())
                }
                .disabled(reason == nil || sending)
                .opacity(reason == nil ? 0.5 : 1)
            }
        }
    }

    private var confirmation: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 40))
                .foregroundStyle(Theme.accentText)
            Text("Thanks — we've got it")
                .font(Theme.heading(22, .bold))
                .foregroundStyle(Theme.foreground)
            Text("We review reports within 24 hours and remove anything that breaks our terms.")
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
            if let onBlock {
                Text("You can also block @\(target.username) so you stop seeing each other.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)
                Button {
                    dismiss()
                    onBlock()
                } label: {
                    Text("Block @\(target.username)")
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.destructive)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Theme.destructive.opacity(0.08), in: Capsule())
                }
            }
            Button { dismiss() } label: {
                Text("Done")
                    .font(Theme.body(15, .bold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Theme.accent, in: Capsule())
            }
        }
        .padding(.top, 20)
    }

    private func send() async {
        guard let reason else { return }
        sending = true; defer { sending = false }
        error = nil
        do {
            let note = details.trimmingCharacters(in: .whitespacesAndNewlines)
            try await SafetyAPI.report(.init(
                kind: target.kind.rawValue, username: target.username, reason: reason,
                details: note.isEmpty ? nil : note,
                reviewId: target.reviewId, bookSlug: target.bookSlug))
            sent = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't send the report. Try again."
        }
    }
}

/// Settings → Blocked Readers. Loads itself; unblocking does not restore the
/// follows the block removed.
struct BlockedReadersSection: View {
    @Binding var openSection: String?
    @State private var blocked: [SafetyAPI.BlockedReader] = []
    @State private var busyId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) {
                    openSection = openSection == "blocked" ? nil : "blocked"
                }
            } label: {
                HStack {
                    SectionHeading(blocked.isEmpty ? "Blocked Readers" : "Blocked Readers (\(blocked.count))")
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(openSection == "blocked" ? 180 : 0))
                }
            }
            if openSection == "blocked" {
                VStack(alignment: .leading, spacing: 12) {
                    Text(blocked.isEmpty
                         ? "You haven't blocked anyone. Use the ⋯ menu on a review or profile to block a reader."
                         : "You don't see each other's reviews, profiles or buddy-read messages.")
                        .font(Theme.body(13)).foregroundStyle(Theme.muted)
                    ForEach(blocked) { reader in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(reader.displayName ?? reader.username.map { "@\($0)" } ?? "Reader")
                                    .font(Theme.body(14, .medium))
                                    .foregroundStyle(Theme.foreground)
                                    .lineLimit(1)
                                if reader.displayName != nil, let username = reader.username {
                                    Text("@\(username)")
                                        .font(Theme.body(12)).foregroundStyle(Theme.muted)
                                }
                            }
                            Spacer()
                            if let username = reader.username {
                                Button(busyId == reader.id ? "Unblocking…" : "Unblock") {
                                    Task { await unblock(reader, username: username) }
                                }
                                .font(Theme.body(13, .medium))
                                .foregroundStyle(Theme.neonBlue)
                                .disabled(busyId == reader.id)
                            }
                        }
                    }
                }
                .padding(.top, 12)
            }
        }
        .task { blocked = await SafetyAPI.blockedReaders() }
    }

    private func unblock(_ reader: SafetyAPI.BlockedReader, username: String) async {
        busyId = reader.id; defer { busyId = nil }
        if (try? await SafetyAPI.unblock(username)) != nil {
            blocked.removeAll { $0.id == reader.id }
        }
    }
}

// ── Terms agreement ─────────────────────────────────────────────────────
// App Review 1.2 also requires that users agree to terms with zero
// tolerance for objectionable content. Shown wherever an account can be
// created (the signup sheet, and the login screen, because "Continue with
// Apple / Google" creates one too) and linked from Settings.
struct LegalAgreementText: View {
    /// "creating an account" on the signup sheet, "continuing" on login.
    var action = "creating an account"

    var body: some View {
        Text("By \(action) you agree to the [Terms of Use](https://thebasedreader.app/terms) and [Privacy Policy](https://thebasedreader.app/privacy).")
            .font(Theme.body(12))
            .foregroundStyle(Theme.muted)
            .tint(Theme.neonBlue)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
    }
}

