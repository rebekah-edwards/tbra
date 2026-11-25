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
                    Color.clear.frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 1) {
                        Eyebrow("Community")
                        Text("Find Readers")
                            .font(Theme.heading(26, .bold))
                            .foregroundStyle(Theme.foreground)
                    }
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
                } else if model.query.trimmingCharacters(in: .whitespaces).count < 2 {
                    GlassEmptyState(systemName: "person.2",
                                    title: "Find your reading people",
                                    message: "Type at least two letters of a name or @username. Follow readers to see what they're reading.")
                        .padding(.top, 4)
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
            .duoReadable()
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { fieldFocused = true }
    }

    private func personRow(_ person: PersonRow) -> some View {
        let name = person.displayName ?? person.username ?? "Unknown"
        return HStack(spacing: 12) {
            NavigationLink(value: UserRoute(username: person.username ?? "")) {
                HStack(spacing: 12) {
                    RingedAvatar(avatarUrl: person.avatarUrl, name: name)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(name)
                            .font(Theme.heading(15, .bold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(1)
                        if let username = person.username {
                            Text("@\(username)")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted)
                        }
                        if let bio = person.bio, !bio.isEmpty {
                            Text(bio)
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted.opacity(0.85))
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(person.username == nil)

            QuietFollowPill(isFollowing: person.isFollowing) {
                Task { await model.toggleFollow(person) }
            }
        }
        .padding(12)
        .glassCard(radius: 18)
    }
}
