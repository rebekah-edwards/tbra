import SwiftUI

// Find Readers — recreates /people: search by name or @username,
// result rows with avatar/bio + Follow pill, tap → public profile.

struct PersonRow: Codable, Hashable, Identifiable {
    let id: String
    let displayName: String?
    let username: String?
    let avatarUrl: String?
    let bio: String?
    var isFollowing: Bool
}

@MainActor
@Observable
final class FindReadersModel {
    var query = ""
    var results: [PersonRow] = []
    var searching = false
    private var task: Task<Void, Never>?

    func queryChanged() {
        task?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; searching = false; return }
        searching = true
        task = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            struct Res: Codable { let ok: Bool; let results: [PersonRow] }
            let res: Res? = try? await APIClient.shared.get(
                "/api/v1/users/search", query: [URLQueryItem(name: "q", value: q)])
            guard !Task.isCancelled else { return }
            results = res?.results ?? []
            searching = false
        }
    }

    func toggleFollow(_ person: PersonRow) async {
        guard let username = person.username else { return }
        guard let i = results.firstIndex(where: { $0.id == person.id }) else { return }
        let target = !results[i].isFollowing
        results[i].isFollowing = target
        struct Body: Codable, Sendable { let follow: Bool }
        struct Ok: Codable { let ok: Bool }
        do {
            let _: Ok = try await APIClient.shared.request("/api/v1/users/\(username)", method: "POST", json: Body(follow: target))
        } catch {
            results[i].isFollowing = !target
        }
    }
}

struct FindReadersView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = FindReadersModel()
    @FocusState private var fieldFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.35), in: Circle())
                            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                    }
                    Text("Find Readers")
                        .font(Theme.heading(26, .bold))
                        .foregroundStyle(Theme.foreground)
                }
                .padding(.top, 14)

                Text("Search by name or @username to follow other readers.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)

                TextField("Name or @username", text: Bindable(model).query)
                    .focused($fieldFocused)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .brandedField()
                    .onChange(of: model.query) { model.queryChanged() }

                if model.searching {
                    Text("Searching...")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                } else {
                    VStack(spacing: 10) {
                        ForEach(model.results) { person in
                            personRow(person)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { fieldFocused = true }
    }

    private func personRow(_ person: PersonRow) -> some View {
        HStack(spacing: 12) {
            NavigationLink(value: UserRoute(username: person.username ?? "")) {
                HStack(spacing: 12) {
                    Group {
                        if let avatarUrl = person.avatarUrl, let url = URL(string: avatarUrl) {
                            AsyncImage(url: url) { image in
                                image.resizable().aspectRatio(contentMode: .fill)
                            } placeholder: { Theme.surfaceAlt }
                        } else {
                            ZStack {
                                Theme.neonPurple.opacity(0.3)
                                Text(String((person.displayName ?? person.username ?? "?").prefix(1)).uppercased())
                                    .font(Theme.body(16, .bold))
                                    .foregroundStyle(Theme.foreground)
                            }
                        }
                    }
                    .frame(width: 44, height: 44)
                    .clipShape(Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text(person.displayName ?? person.username ?? "Unknown")
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(Theme.foreground)
                        if let username = person.username {
                            Text("@\(username)")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.muted)
                        }
                        if let bio = person.bio, !bio.isEmpty {
                            Text(bio)
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted.opacity(0.85))
                                .lineLimit(1)
                        }
                    }
                }
            }
            .disabled(person.username == nil)

            Spacer()

            Button {
                Task { await model.toggleFollow(person) }
            } label: {
                Text(person.isFollowing ? "Following" : "Follow")
                    .font(Theme.body(13, .semibold))
                    .foregroundStyle(person.isFollowing ? Theme.accentText : .black)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(person.isFollowing ? Theme.accent.opacity(0.12) : Theme.accent, in: Capsule())
                    .overlay(Capsule().stroke(Theme.accent.opacity(person.isFollowing ? 0.5 : 1), lineWidth: 1))
            }
        }
        .padding(12)
        .background(Theme.surface.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
    }
}
