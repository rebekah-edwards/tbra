import SwiftUI

// The full friends activity list — the endless screen behind the home rail's
// "See more" (web: /activity, friends-activity-feed.tsx). Same two tiers as
// the rail, stacked: written reviews are full-width cards, everything else is
// a one-line row. More loads as the reader nears the bottom.

struct FriendsFeedRoute: Hashable {}

@MainActor
@Observable
final class FriendsFeedModel {
    private(set) var items: [ActivityItem] = []
    private(set) var nextOffset: Int? = 0
    private(set) var loading = false
    private(set) var loadedOnce = false
    private(set) var failed = false

    private let pageSize = 20
    private var seen = Set<String>()

    var reachedEnd: Bool { loadedOnce && nextOffset == nil }

    func loadFirstIfNeeded() async {
        if !loadedOnce { await loadMore() }
    }

    func reload() async {
        // Keep the current list on screen until the fresh first page lands.
        guard let page = try? await APIClient.shared.friendsActivity(offset: 0, limit: pageSize) else { return }
        seen = []
        items = []
        append(page)
        failed = false
    }

    func loadMore() async {
        guard !loading, let offset = nextOffset else { return }
        loading = true
        defer { loading = false }
        do {
            append(try await APIClient.shared.friendsActivity(offset: offset, limit: pageSize))
            failed = false
        } catch {
            // Stops the auto-load so a dead connection cannot retry in a loop;
            // the "Try again" button calls loadMore() again.
            failed = true
        }
        loadedOnce = true
    }

    private func append(_ page: FriendsActivityPage) {
        for item in page.items where item.isFeedVisible && seen.insert(item.feedKey).inserted {
            items.append(item)
        }
        nextOffset = page.nextOffset
        loadedOnce = true
    }

    /// Called as rows appear: start the next page a few rows before the end.
    func rowAppeared(_ item: ActivityItem) {
        guard !failed, !loading, nextOffset != nil else { return }
        let tail = items.suffix(5)
        if tail.contains(where: { $0.feedKey == item.feedKey }) {
            Task { await loadMore() }
        }
    }
}

struct FriendsFeedView: View {
    /// Row tap → book page (written reviews → the review itself); HomeView
    /// pushes onto its own path.
    var onOpen: (ActivityItem) -> Void = { _ in }
    @State private var model = FriendsFeedModel()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                // Large and left-aligned, on its own line under the floating
                // back chevron (Rebekah, 2026-11-16: the inset title sitting
                // below the chevron looked off, and beside the chevron it
                // would run into the top-right actions pill).
                Text("Friends Activity")
                    .font(Theme.heading(30, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 10)
                    .padding(.bottom, 8)

                ForEach(model.items, id: \.feedKey) { item in
                    Group {
                        if item.isWrittenReview {
                            FriendsReviewCard(item: item, fullWidth: true, onOpen: { onOpen(item) })
                        } else {
                            FriendsActivityListRow(item: item, onOpen: { onOpen(item) })
                        }
                    }
                    .onAppear { model.rowAppeared(item) }
                }

                footer
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .floatingBack()
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.loadFirstIfNeeded() }
        .refreshable { await model.reload() }
    }

    @ViewBuilder
    private var footer: some View {
        if model.failed {
            VStack(spacing: 6) {
                Text(model.items.isEmpty ? "Couldn't load friends activity." : "Couldn't load more activity.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                Button("Try again") { Task { await model.loadMore() } }
                    .font(Theme.body(14, .semibold))
                    .foregroundStyle(Theme.neonBlue)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        } else if !model.loadedOnce || model.loading {
            ProgressView()
                .tint(Theme.accent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
        } else if model.items.isEmpty {
            Text("Nothing yet. Follow readers to see what they are reading.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
        } else if model.reachedEnd {
            Text("You're all caught up.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
        }
    }
}

// ── Tier 2 in the list: one line per small thing ──
private struct FriendsActivityListRow: View {
    let item: ActivityItem
    var onOpen: () -> Void = {}

    var body: some View {
        let caption = item.feedCaption
        // Plain Button, not NavigationLink(value:) — value links misfire in
        // runs of sibling cards on iOS 27 (see FriendsReviewCard).
        Button(action: onOpen) {
            HStack(spacing: 12) {
                FriendsAvatar(user: item.user, size: 32)

                VStack(alignment: .leading, spacing: 3) {
                    Text("\(Text(item.user.feedName).fontWeight(.semibold).foregroundStyle(Theme.foreground)) \(caption.spoken) \(Text(item.book.title).fontWeight(.semibold).foregroundStyle(Theme.foreground))")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.foreground.opacity(0.8))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 4) {
                        Image(systemName: caption.icon)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(caption.tint)
                        Text(friendsTimeAgo(item.timestamp))
                            .font(Theme.body(11))
                            .foregroundStyle(Theme.muted)
                    }
                }

                Spacer(minLength: 4)

                CoverThumb(url: item.book.coverImageUrl, width: 32, height: 48, radius: 4, title: item.book.title)
                    .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
            .overlay(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner).stroke(Theme.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: FriendsFeedMetrics.corner))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.user.feedName) \(caption.spoken) \(item.book.title)")
        .accessibilityAddTraits(.isButton)
    }
}
