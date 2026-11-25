import SwiftUI

// Buddy Reads — recreates /buddy-reads (list + join-by-code),
// /buddy-reads/[slug] (detail: book header, members, invite code,
// discussion thread + composer, leave), and the create flow the book
// page's "Buddy Read" row triggers.

struct BuddyReadRoute: Hashable { let slug: String }

struct BuddyReadSummaryRow: Codable, Hashable, Identifiable {
    struct BookRef: Codable, Hashable {
        let id: String
        let title: String
        let slug: String?
        let coverImageUrl: String?
    }
    let id: String
    let name: String
    let slug: String
    let description: String?
    let status: String
    let inviteCode: String
    let createdAt: String
    let book: BookRef
    let memberCount: Int
    /// Added to the API on 2026-11-19 — optional so an older server's
    /// response still decodes (the row then just omits "Hosted by").
    struct HostRef: Codable, Hashable {
        let userId: String
        let displayName: String?
        let username: String?
    }
    let host: HostRef?
    /// "active" | "invited" (2026-11-19; nil from an older server).
    let myStatus: String?
}

struct BuddyReadMemberRow: Codable, Hashable {
    let userId: String?
    let displayName: String?
    let username: String?
    let avatarUrl: String?
    let role: String?
    let status: String?
}

struct BuddyReadDetailRow: Codable, Hashable {
    struct BookRef: Codable, Hashable {
        let id: String
        let title: String
        let slug: String?
        let coverImageUrl: String?
        let pages: Int?
        let authors: [String]
    }
    let id: String
    let name: String
    let slug: String
    let description: String?
    let status: String
    let inviteCode: String
    let maxMembers: Int
    let createdAt: String
    let createdBy: String
    let book: BookRef
    let members: [BuddyReadMemberRow]
}

struct BuddyReadMessageRow: Codable, Hashable, Identifiable {
    struct UserRef: Codable, Hashable {
        let id: String
        let displayName: String?
        let username: String?
        let avatarUrl: String?
    }
    let id: String
    let message: String
    /// 'message' | 'progress' | 'status' (2026-11-25). Optional: older
    /// servers didn't send it.
    let kind: String?
    let createdAt: String
    let user: UserRef

    /// Reading updates are "Reading update (p. 120, 45%): note"; rows from
    /// before `kind` carried a "📖 " prefix instead.
    var progressParts: (progress: String?, note: String)? {
        let legacy = message.hasPrefix("📖")
        guard kind == "progress" || (legacy && message.contains("Reading update")) else { return nil }
        var text = message
        if legacy { text = String(text.drop(while: { $0 == "📖" || $0 == " " })) }
        guard text.hasPrefix("Reading update") else { return (nil, text) }
        var rest = String(text.dropFirst("Reading update".count)).trimmingCharacters(in: .whitespaces)
        var progress: String?
        if rest.hasPrefix("("), let close = rest.firstIndex(of: ")") {
            progress = String(rest[rest.index(after: rest.startIndex)..<close])
            rest = String(rest[rest.index(after: close)...])
        }
        if rest.hasPrefix(":") { rest.removeFirst() }
        return (progress, rest.trimmingCharacters(in: .whitespaces))
    }
}

// ── List ──

@MainActor
@Observable
final class BuddyReadsModel {
    var buddyReads: [BuddyReadSummaryRow] = []
    var loaded = false
    var joinError: String?

    func load() async {
        struct Res: Codable { let ok: Bool; let buddyReads: [BuddyReadSummaryRow] }
        if let res: Res = try? await APIClient.shared.get("/api/v1/buddy-reads") {
            buddyReads = res.buddyReads
            loaded = true
        }
    }

    /// Returns the joined buddy read's slug on success.
    func join(code: String) async -> String? {
        joinError = nil
        struct Body: Codable, Sendable { let joinCode: String }
        struct Ok: Codable { let ok: Bool; let slug: String? }
        do {
            let res: Ok = try await APIClient.shared.request("/api/v1/buddy-reads", method: "POST", json: Body(joinCode: code))
            await load()
            return res.slug
        } catch {
            joinError = (error as? APIError)?.errorDescription ?? "Couldn't join — check the code."
            return nil
        }
    }
}

struct BuddyReadsView: View {
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.shellRailWidth) private var rail
    @Environment(\.dismiss) private var dismiss
    @State private var model = BuddyReadsModel()
    @State private var joinCode = ""
    @State private var navigateTo: BuddyReadRoute?

    var body: some View {
        ScrollView {
            // iPhone Duo open: header on the left, the buddy-read cards flow
            // into both columns.
            DuoColumns(spacing: 16) {
                HStack(spacing: 12) {
                    if rail == 0 { Color.clear.frame(width: 40, height: 40) }
                    Text("Buddy Reads")
                        .font(Theme.heading(26, .bold))
                        .foregroundStyle(Theme.foreground)
                }
                .padding(.top, 14)
                .duoColumn(.full)

                Text("Read together — same book, shared discussion.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)
                    .duoColumn(.full)

                // Join by code
                if DesignPreview.on {
                    joinRowV2.duoColumn(.full)
                } else {
                HStack(spacing: 10) {
                    TextField("Invite code", text: $joinCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .brandedField()
                    Button {
                        Task {
                            if let slug = await model.join(code: joinCode) {
                                joinCode = ""
                                navigateTo = BuddyReadRoute(slug: slug)
                            }
                        }
                    } label: {
                        Text("Join")
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 20).padding(.vertical, 12)
                            .background(Theme.accent, in: Capsule())
                    }
                    .disabled(joinCode.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                }
                if let err = model.joinError {
                    Text(err).font(Theme.body(13)).foregroundStyle(Theme.destructive).duoColumn(.full)
                }

                if DesignPreview.on {
                    if model.buddyReads.isEmpty && model.loaded {
                        emptyV2.duoColumn(.full)
                    } else {
                        if !model.buddyReads.isEmpty {
                            Text("YOUR BUDDY READS")
                                .font(Theme.body(11, .bold)).tracking(0.8)
                                .foregroundStyle(Theme.muted)
                                .padding(.top, 4)
                                .duoColumn(.full)
                        }
                        ForEach(model.buddyReads) { br in
                            NavigationLink(value: BuddyReadRoute(slug: br.slug)) {
                                BuddyReadListRowV2(br: br)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else if model.buddyReads.isEmpty && model.loaded {
                    VStack(spacing: 6) {
                        Text("No buddy reads yet")
                            .font(Theme.body(16, .medium))
                            .foregroundStyle(Theme.muted)
                        Text("Start one from any book page — the Buddy Read option in the reading-state menu.")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted.opacity(0.8))
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                } else {
                    ForEach(model.buddyReads) { br in
                        NavigationLink(value: BuddyReadRoute(slug: br.slug)) {
                            HStack(spacing: 12) {
                                CoverThumb(url: br.book.coverImageUrl, width: 52, height: 78, radius: 6, title: br.book.title)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(br.name)
                                        .font(Theme.body(16, .semibold))
                                        .foregroundStyle(Theme.foreground)
                                        .multilineTextAlignment(.leading)
                                    Text("\(br.memberCount) reader\(br.memberCount == 1 ? "" : "s")")
                                        .font(Theme.body(13))
                                        .foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Text(br.status == "active" ? "Active" : br.status.capitalized)
                                    .font(Theme.body(11, .medium))
                                    .foregroundStyle(br.status == "active" ? Theme.accent : Theme.muted)
                                    .padding(.horizontal, 9).padding(.vertical, 4)
                                    .background((br.status == "active" ? Theme.accent : Theme.muted).opacity(0.1), in: Capsule())
                            }
                            .padding(12)
                            .background(Theme.surface.opacity(0.55))
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .refreshable { await model.load() }
        .navigationDestination(item: $navigateTo) { route in
            BuddyReadDetailView(slug: route.slug)
        }
    }

    // ── Refreshed list pieces (2026-11) ──

    private var joinCodeEmpty: Bool { joinCode.trimmingCharacters(in: .whitespaces).isEmpty }

    /// Glass code field + Join, the screen's one lime pill. Like
    /// AccentButtonStyle, a disabled Join reads neutral, never dimmed lime.
    private var joinRowV2: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "ticket")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.neonBlue)
                TextField("Invite code", text: $joinCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            }
            .brandedField()
            Button {
                Task {
                    if let slug = await model.join(code: joinCode) {
                        joinCode = ""
                        navigateTo = BuddyReadRoute(slug: slug)
                    }
                }
            } label: {
                Text("Join")
                    .font(Theme.body(15, .bold))
                    .foregroundStyle(joinCodeEmpty ? Theme.muted : Theme.onAccent)
                    .padding(.horizontal, 22)
                    .frame(height: 50)
                    .background(joinCodeEmpty ? Theme.surfaceAlt : Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(joinCodeEmpty)
        }
    }

    private var emptyV2: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.2")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.neonBlue)
                .frame(width: 56, height: 56)
                .glassEffect(.regular, in: Circle())
            Text("No buddy reads yet")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)
            Text("Start one from any book page — the Buddy Read option in the reading-state menu.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
        .background(Theme.surface.opacity(0.92))
        .heroHairline()
        .padding(.top, 8)
    }
}

/// One buddy read in the list: tipped cover, status badge, name, the real
/// host ("You" only when it is you) and the reader count.
private struct BuddyReadListRowV2: View {
    @Environment(AuthStore.self) private var auth
    let br: BuddyReadSummaryRow

    private var hostLabel: String? {
        guard let host = br.host else { return nil }
        if case .signedIn(let me) = auth.phase, me.id == host.userId { return "You" }
        return host.displayName ?? host.username.map { "@\($0)" } ?? "Reader"
    }

    var body: some View {
        HStack(spacing: 14) {
            CoverThumb(url: br.book.coverImageUrl, width: 56, height: 84, radius: 7, title: br.book.title)
                .shadow(color: .black.opacity(0.35), radius: 8, y: 5)
                .rotationEffect(.degrees(-2))
            VStack(alignment: .leading, spacing: 5) {
                BuddyReadStatusBadge(status: br.status, invited: br.myStatus == "invited")
                Text(br.name)
                    .font(Theme.heading(17, .bold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let hostLabel {
                    Text("Hosted by \(hostLabel)")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                Label("\(br.memberCount) reader\(br.memberCount == 1 ? "" : "s")", systemImage: "person.2")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.muted)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .profileRowChrome()
    }
}

/// Active (lime dot) / Completed (muted dot) / Invited (blue dot), as glass.
struct BuddyReadStatusBadge: View {
    let status: String
    var invited = false
    var body: some View {
        if invited {
            DotBadge(text: "Invited", dot: Theme.neonBlue)
        } else if status == "active" {
            DotBadge(text: "Active", dot: Theme.accent)
        } else if status == "completed" {
            DotBadge(text: "Finished", dot: Theme.neonBlue)
        } else if status == "archived" {
            DotBadge(text: "Cancelled", dot: Theme.muted)
        } else {
            DotBadge(text: status.capitalized, dot: Theme.muted)
        }
    }
}

// ── Detail ──

@MainActor
@Observable
final class BuddyReadDetailModel {
    let slug: String
    var detail: BuddyReadDetailRow?
    var messages: [BuddyReadMessageRow] = []
    var membership: BuddyReadMemberRow?
    var loaded = false

    init(slug: String) { self.slug = slug }

    struct Res: Codable {
        let ok: Bool
        let detail: BuddyReadDetailRow
        let messages: [BuddyReadMessageRow]
        let membership: BuddyReadMemberRow?
    }

    func load() async {
        if let res: Res = try? await APIClient.shared.get("/api/v1/buddy-reads/\(slug)") {
            detail = res.detail
            messages = res.messages
            membership = res.membership
            loaded = true
        }
    }

    func post(_ text: String) async {
        struct Body: Codable, Sendable { let message: String }
        struct Ok: Codable { let ok: Bool }
        let _: Ok? = try? await APIClient.shared.request("/api/v1/buddy-reads/\(slug)", method: "POST", json: Body(message: text))
        await load()
    }

    /// Host only: "completed" (finished), "active" (reopen), "archived" (cancel).
    func setStatus(_ status: String) async -> String? {
        struct Body: Codable, Sendable { let status: String }
        struct Ok: Codable { let ok: Bool }
        do {
            let _: Ok = try await APIClient.shared.request("/api/v1/buddy-reads/\(slug)", method: "POST", json: Body(status: status))
            await load()
            return nil
        } catch {
            return (error as? APIError)?.errorDescription ?? "Couldn't update the buddy read."
        }
    }

    func leave() async -> Bool {
        struct Body: Codable, Sendable { let leave: Bool }
        struct Ok: Codable { let ok: Bool }
        let res: Ok? = try? await APIClient.shared.request("/api/v1/buddy-reads/\(slug)", method: "POST", json: Body(leave: true))
        return res?.ok == true
    }
}

struct BuddyReadDetailView: View {
    @Environment(\.shellBarInsets) private var bars
    @Environment(\.shellRailWidth) private var rail
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var model: BuddyReadDetailModel
    @State private var composer = ""
    @State private var showLeaveConfirm = false
    @State private var showFinishConfirm = false
    @State private var showCancelConfirm = false
    @State private var statusError: String?
    @State private var codeCopied = false

    init(slug: String) {
        _model = State(initialValue: BuddyReadDetailModel(slug: slug))
    }

    var body: some View {
        ScrollView {
            DuoColumns(spacing: 18, rightLift: duoRightColumnLift(barTop: bars.top, rail: rail)) {
                if DesignPreview.on {
                    // The back chevron's row; the name lives in the hero card.
                    // (None on the Duo: back lives in the side column.)
                    if rail == 0 {
                        Color.clear.frame(height: 40)
                            .padding(.top, 14)
                            .padding(.bottom, -8)
                    }
                } else {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Text(model.detail?.name ?? "Buddy Read")
                        .font(Theme.heading(24, .bold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Spacer()
                }
                .padding(.top, 14)
                }

                if let detail = model.detail, DesignPreview.on {
                    detailV2(detail)
                } else if let detail = model.detail {
                    // Book header
                    NavigationLink(value: BookRoute(idOrSlug: detail.book.slug ?? detail.book.id)) {
                        HStack(spacing: 12) {
                            CoverThumb(url: detail.book.coverImageUrl, width: 60, height: 90, radius: 7, title: detail.book.title)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(detail.book.title)
                                    .font(Theme.body(16, .semibold))
                                    .foregroundStyle(Theme.foreground)
                                Text(detail.book.authors.joined(separator: ", "))
                                    .font(Theme.body(13))
                                    .foregroundStyle(Theme.muted)
                                if let desc = detail.description, !desc.isEmpty {
                                    Text(desc)
                                        .font(Theme.body(12))
                                        .foregroundStyle(Theme.muted.opacity(0.85))
                                        .lineLimit(2)
                                }
                            }
                            Spacer()
                        }
                        .padding(12)
                        .background(Theme.surface.opacity(0.55))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
                    }

                    // Invite code (host share)
                    HStack(spacing: 8) {
                        Text("Invite code:")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                        Text(detail.inviteCode)
                            .font(.system(size: 15, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.accent)
                        Button {
                            UIPasteboard.general.string = detail.inviteCode
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.neonBlue)
                        }
                        Spacer()
                        Text("\(detail.members.count)/\(detail.maxMembers) readers")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                    }

                    // Members
                    SectionHeading("Readers")
                    FlowLayout(spacing: 10) {
                        ForEach(detail.members, id: \.userId) { member in
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(Theme.neonPurple.opacity(0.3))
                                    .frame(width: 22, height: 22)
                                    .overlay(
                                        Text(String((member.displayName ?? member.username ?? "?").prefix(1)).uppercased())
                                            .font(Theme.body(10, .bold))
                                            .foregroundStyle(Theme.foreground)
                                    )
                                Text(member.displayName ?? member.username ?? "Reader")
                                    .font(Theme.body(13, .medium))
                                    .foregroundStyle(Theme.foreground)
                                if member.role == "host" {
                                    Text("HOST")
                                        .font(Theme.body(9, .bold)).tracking(0.5)
                                        .foregroundStyle(Theme.accent)
                                }
                            }
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Theme.surfaceAlt.opacity(0.5), in: Capsule())
                        }
                    }

                    // Discussion
                    SectionHeading("Discussion")
                    if model.messages.isEmpty {
                        Text("No messages yet — say hi!")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                    ForEach(model.messages) { msg in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Text(msg.user.displayName ?? msg.user.username ?? "Reader")
                                    .font(Theme.body(13, .semibold))
                                    .foregroundStyle(Theme.foreground)
                                Text(DateFmt.display(msg.createdAt, precision: nil))
                                    .font(Theme.body(11))
                                    .foregroundStyle(Theme.muted.opacity(0.7))
                            }
                            Text(msg.message)
                                .font(Theme.body(15))
                                .foregroundStyle(Theme.foreground.opacity(0.9))
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface.opacity(0.5))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border.opacity(0.7), lineWidth: 1))
                    }

                    if model.membership?.status == "active" {
                        HStack(spacing: 10) {
                            TextField("Message the group…", text: $composer, axis: .vertical)
                                .lineLimit(1...4)
                                .brandedField()
                            Button {
                                let text = composer
                                composer = ""
                                Task { await model.post(text) }
                            } label: {
                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.system(size: 30))
                                    .foregroundStyle(Theme.accent)
                            }
                            .disabled(composer.trimmingCharacters(in: .whitespaces).isEmpty)
                        }

                        if model.membership?.role != "host" {
                            Button("Leave this buddy read") { showLeaveConfirm = true }
                                .font(Theme.body(13, .medium))
                                .foregroundStyle(Theme.destructive)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 6)
                        }
                    }
                } else if !model.loaded {
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .refreshable { await model.load() }
        .confirmationDialog("Leave this buddy read?", isPresented: $showLeaveConfirm, titleVisibility: .visible) {
            Button("Leave", role: .destructive) {
                Task { if await model.leave() { dismiss() } }
            }
        }
        .confirmationDialog("Mark this buddy read as finished?", isPresented: $showFinishConfirm, titleVisibility: .visible) {
            Button("Mark as finished") {
                Task { statusError = await model.setStatus("completed") }
            }
        } message: {
            Text("It ends for everyone and the discussion closes. Nobody's own reading progress changes.")
        }
        .confirmationDialog("Cancel this buddy read?", isPresented: $showCancelConfirm, titleVisibility: .visible) {
            Button("Cancel buddy read", role: .destructive) {
                Task {
                    statusError = await model.setStatus("archived")
                    if statusError == nil { dismiss() }
                }
            }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("It disappears from everyone's buddy reads. This can't be undone.")
        }
    }

    // ── Refreshed detail (2026-11) ──
    // Designed, not just matched: the book is the subject, so the hero sits on
    // its own blurred cover art inside the wordmark hairline with the cover
    // tipped, like Pick From Your Shelf. Readers are glass chips, messages are
    // glass cards, and Send is the screen's one solid-lime control.

    private var myId: String? {
        if case .signedIn(let me) = auth.phase { return me.id }
        return nil
    }

    @ViewBuilder
    private func detailV2(_ detail: BuddyReadDetailRow) -> some View {
        // iPhone Duo open (DuoColumns in body): the book, invite and readers
        // on the left; the discussion on the right, level with the logo.
        heroV2(detail).duoColumn(.left)
        inviteTileV2(detail).duoColumn(.left)

        SectionHeading("Readers").duoColumn(.left)
        FlowLayout(spacing: 8) {
            ForEach(detail.members, id: \.userId) { member in
                memberChipV2(member)
            }
        }
        .duoColumn(.left)

        SectionHeading("Discussion").duoColumn(.right)
        if model.messages.isEmpty {
            HStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .foregroundStyle(Theme.neonBlue)
                Text("No messages yet — say hi!")
                    .foregroundStyle(Theme.muted)
            }
            .font(Theme.body(14))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .profileRowChrome()
            .duoColumn(.right)
        }
        ForEach(model.messages) { msg in
            messageV2(msg).duoColumn(.right)
        }

        if model.membership?.status == "active" {
            if detail.status == "active" {
                composerV2.duoColumn(.right)
            } else {
                Text("This buddy read has ended, so the discussion is closed.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .duoColumn(.right)
            }

            if model.membership?.role != "host" {
                Button { showLeaveConfirm = true } label: {
                    ShelfPill(kind: .destructive) {
                        Label("Leave this buddy read", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .padding(.top, 6)
                .duoColumn(.left)
            }
        }

        // Host controls (web buddy-read-detail-client.tsx parity).
        if model.membership?.role == "host" && detail.status != "archived" {
            VStack(spacing: 10) {
                if let statusError {
                    Text(statusError).font(Theme.body(12)).foregroundStyle(Theme.destructive)
                }
                HStack(spacing: 10) {
                    if detail.status == "active" {
                        Button { showFinishConfirm = true } label: {
                            ShelfPill(kind: .neutral) {
                                Label("Mark as finished", systemImage: "checkmark")
                            }
                        }
                        .buttonStyle(.plain)
                    } else if detail.status == "completed" {
                        Button {
                            Task { statusError = await model.setStatus("active") }
                        } label: {
                            ShelfPill(kind: .neutral) {
                                Label("Reopen", systemImage: "arrow.counterclockwise")
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    Button { showCancelConfirm = true } label: {
                        ShelfPill(kind: .destructive) {
                            Label("Cancel buddy read", systemImage: "xmark.circle")
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
            .duoColumn(.left)
        }
    }

    private func heroV2(_ detail: BuddyReadDetailRow) -> some View {
        let route = BookRoute(idOrSlug: detail.book.slug ?? detail.book.id)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 16) {
                NavigationLink(value: route) {
                    CoverThumb(url: detail.book.coverImageUrl, width: 86, height: 129, radius: 8, title: detail.book.title)
                        .shadow(color: .black.opacity(0.45), radius: 12, y: 8)
                        .rotationEffect(.degrees(-3))
                }
                .buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 7) {
                    BuddyReadStatusBadge(status: detail.status)
                    Text(detail.name)
                        .font(Theme.heading(21, .bold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                    NavigationLink(value: route) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(detail.book.title)
                                .font(Theme.body(14, .semibold))
                                .foregroundStyle(Theme.foreground.opacity(0.85))
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                            if !detail.book.authors.isEmpty {
                                Text(detail.book.authors.joined(separator: ", "))
                                    .font(Theme.body(13))
                                    .foregroundStyle(Theme.foreground.opacity(0.70))
                                    .lineLimit(1)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    Label("\(detail.members.count)/\(detail.maxMembers) readers", systemImage: "person.2")
                        .font(Theme.body(12, .medium))
                        .foregroundStyle(Theme.foreground.opacity(0.75))
                }
            }
            // The cover and text sit as one group in the middle of the card.
            .frame(maxWidth: .infinity, alignment: .center)

            if let desc = detail.description, !desc.isEmpty {
                Text(desc)
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.foreground.opacity(0.85))
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(
            ZStack {
                Theme.surfaceAlt
                if let cover = detail.book.coverImageUrl, let url = URL(string: cover) {
                    CoverBlurImage(url: url)
                    Theme.scrim
                }
            }
        )
        .heroHairline()
    }

    private func inviteTileV2(_ detail: BuddyReadDetailRow) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("INVITE CODE")
                    .font(Theme.body(11, .bold)).tracking(0.8)
                    .foregroundStyle(Theme.muted)
                Text(detail.inviteCode)
                    .font(.system(size: 18, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.foreground)
                    .textSelection(.enabled)
            }
            Spacer()
            Button {
                UIPasteboard.general.string = detail.inviteCode
                codeCopied = true
                Task {
                    try? await Task.sleep(for: .seconds(1.5))
                    codeCopied = false
                }
            } label: {
                ShelfIconCircle(systemName: codeCopied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.plain)
            .accessibilityLabel(codeCopied ? "Copied" : "Copy invite code")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .profileRowChrome()
    }

    private func initialAvatar(_ name: String, url: String?, size: CGFloat) -> some View {
        Group {
            if let url, let u = URL(string: url) {
                CachedCoverImage(url: u) { Theme.surfaceAlt }
            } else {
                ZStack {
                    LinearGradient(colors: [Theme.accent.opacity(0.28), Theme.neonPurple.opacity(0.28)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                    Text(String(name.prefix(1)).uppercased())
                        .font(Theme.body(size * 0.42, .bold))
                        .foregroundStyle(Theme.foreground)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private func memberChipV2(_ member: BuddyReadMemberRow) -> some View {
        let name = member.displayName ?? member.username ?? "Reader"
        return HStack(spacing: 7) {
            initialAvatar(name, url: member.avatarUrl, size: 24)
            Text(name)
                .font(Theme.body(13, .medium))
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
            if member.role == "host" {
                HStack(spacing: 4) {
                    Circle().fill(Theme.accent).frame(width: 5, height: 5)
                    Text("HOST")
                        .font(Theme.body(9, .bold)).tracking(0.6)
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(.leading, 5).padding(.trailing, 12).padding(.vertical, 5)
        .glassEffect(.regular, in: Capsule())
    }

    @ViewBuilder
    private func messageV2(_ msg: BuddyReadMessageRow) -> some View {
        if msg.kind == "status" {
            // Automatic event ("Rebekah finished the book"): a centred glass
            // one-liner, not a chat card.
            HStack(spacing: 6) {
                Circle().fill(Theme.neonBlue).frame(width: 6, height: 6)
                Text(msg.message)
                    .font(Theme.body(12, .semibold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                Text("· " + friendsTimeAgo(msg.createdAt))
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(Theme.foreground.opacity(0.1), lineWidth: 1))
            .frame(maxWidth: .infinity)
        } else {
            chatMessageV2(msg)
        }
    }

    private func chatMessageV2(_ msg: BuddyReadMessageRow) -> some View {
        let name = msg.user.displayName ?? msg.user.username ?? "Reader"
        let mine = msg.user.id == myId
        let progress = msg.progressParts
        return HStack(alignment: .top, spacing: 10) {
            initialAvatar(name, url: msg.user.avatarUrl, size: 30)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(name)
                        .font(Theme.body(13, .semibold))
                        .foregroundStyle(Theme.foreground)
                    Text(DateFmt.display(msg.createdAt, precision: nil))
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.muted)
                }
                if let progress {
                    HStack(spacing: 6) {
                        Image(systemName: "book")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.neonBlue)
                        Text("Reading update")
                            .font(Theme.body(12, .semibold))
                            .foregroundStyle(Theme.foreground)
                        if let p = progress.progress, !p.isEmpty {
                            Text(p)
                                .font(Theme.body(11, .medium))
                                .foregroundStyle(Theme.muted)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .overlay(Capsule().stroke(Theme.foreground.opacity(0.14), lineWidth: 1))
                        }
                    }
                    if !progress.note.isEmpty {
                        Text(progress.note)
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Text(msg.message)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.foreground.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .profileRowChrome()
        // Your own messages carry the thin lime ring of an "on" glass control.
        .overlay(RoundedRectangle(cornerRadius: 18)
            .stroke(Theme.accent.opacity(mine ? 0.45 : 0), lineWidth: 1))
    }

    private var composerEmpty: Bool { composer.trimmingCharacters(in: .whitespaces).isEmpty }

    private var composerV2: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message the group…", text: $composer, axis: .vertical)
                .lineLimit(1...4)
                .brandedField()
            Button {
                let text = composer
                composer = ""
                Task { await model.post(text) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(composerEmpty ? Theme.muted : Theme.onAccent)
                    .frame(width: 50, height: 50)
                    .background(composerEmpty ? Theme.surfaceAlt : Theme.accent, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(composerEmpty)
            .accessibilityLabel("Send message")
        }
    }
}
