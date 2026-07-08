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
    let createdAt: String
    let user: UserRef
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
    @Environment(\.dismiss) private var dismiss
    @State private var model = BuddyReadsModel()
    @State private var joinCode = ""
    @State private var navigateTo: BuddyReadRoute?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Text("Buddy Reads")
                        .font(Theme.heading(26, .bold))
                        .foregroundStyle(Theme.foreground)
                }
                .padding(.top, 14)

                Text("Read together — same book, shared discussion.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)

                // Join by code
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
                if let err = model.joinError {
                    Text(err).font(Theme.body(13)).foregroundStyle(Theme.destructive)
                }

                if model.buddyReads.isEmpty && model.loaded {
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
                                CoverThumb(url: br.book.coverImageUrl, width: 52, height: 78, radius: 6)
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

    func leave() async -> Bool {
        struct Body: Codable, Sendable { let leave: Bool }
        struct Ok: Codable { let ok: Bool }
        let res: Ok? = try? await APIClient.shared.request("/api/v1/buddy-reads/\(slug)", method: "POST", json: Body(leave: true))
        return res?.ok == true
    }
}

struct BuddyReadDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: BuddyReadDetailModel
    @State private var composer = ""
    @State private var showLeaveConfirm = false

    init(slug: String) {
        _model = State(initialValue: BuddyReadDetailModel(slug: slug))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Color.clear.frame(width: 40, height: 40)
                    Text(model.detail?.name ?? "Buddy Read")
                        .font(Theme.heading(24, .bold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Spacer()
                }
                .padding(.top, 14)

                if let detail = model.detail {
                    // Book header
                    NavigationLink(value: BookRoute(idOrSlug: detail.book.slug ?? detail.book.id)) {
                        HStack(spacing: 12) {
                            CoverThumb(url: detail.book.coverImageUrl, width: 60, height: 90, radius: 7)
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
    }
}
