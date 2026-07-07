import SwiftUI

// Friends Who Read (friends-who-read.tsx): avatar row of followed users
// who have this book, with their state/rating. Plus the book footer
// actions: Hide from recommendations (hide-book-button.tsx) and Report
// an issue (report-issue-button.tsx bottom sheet → reported_issues).

struct FriendsWhoReadSection: View {
    let friends: [FriendWhoRead]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Friends Who Read It")
            VStack(spacing: 10) {
                ForEach(friends) { friend in
                    HStack(spacing: 12) {
                        avatar(friend)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(friend.displayName ?? friend.username ?? "Reader")
                                .font(Theme.body(15, .semibold))
                                .foregroundStyle(Theme.foreground)
                            Text(stateLabel(friend.state))
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        if let rating = friend.rating {
                            HStack(spacing: 3) {
                                Image(systemName: "star.fill")
                                    .font(.system(size: 11))
                                Text(String(format: "%.2g", rating))
                                    .font(Theme.body(13, .semibold))
                            }
                            .foregroundStyle(Theme.accent)
                        }
                    }
                    .padding(12)
                    .background(Theme.surface.opacity(0.55))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                }
            }
        }
    }

    private func avatar(_ friend: FriendWhoRead) -> some View {
        Group {
            if let avatarUrl = friend.avatarUrl, let url = URL(string: avatarUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.surfaceAlt }
            } else {
                ZStack {
                    Theme.neonPurple.opacity(0.3)
                    Text(String((friend.displayName ?? friend.username ?? "?").prefix(1)).uppercased())
                        .font(Theme.body(15, .bold))
                        .foregroundStyle(Theme.foreground)
                }
            }
        }
        .frame(width: 38, height: 38)
        .clipShape(Circle())
    }

    private func stateLabel(_ state: String?) -> String {
        switch state {
        case "completed": return "Finished it"
        case "currently_reading": return "Reading now"
        case "tbr": return "On their TBR"
        case "paused": return "Paused"
        case "dnf": return "Didn't finish"
        default: return "Read it"
        }
    }
}

// ── Hide + Report footer ──

struct BookFooterActions: View {
    let bookId: String
    let bookTitle: String
    let isHidden: Bool
    let onChanged: () -> Void

    @State private var reportOpen = false
    @State private var busy = false

    var body: some View {
        HStack(spacing: 14) {
            Button {
                busy = true
                Task {
                    struct Body: Codable, Sendable { let hide: Bool }
                    struct Ok: Codable { let ok: Bool }
                    let _: Ok? = try? await APIClient.shared.request(
                        "/api/v1/books/\(bookId)/flags", method: "POST", json: Body(hide: !isHidden))
                    busy = false
                    onChanged()
                }
            } label: {
                Label(isHidden ? "Hidden from recs" : "Hide from recs",
                      systemImage: isHidden ? "eye.slash.fill" : "eye.slash")
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(isHidden ? Theme.accent : Theme.muted)
            }
            .disabled(busy)

            Spacer()

            Button {
                reportOpen = true
            } label: {
                Label("Report an issue", systemImage: "flag")
                    .font(Theme.body(13, .medium))
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.top, 6)
        .sheet(isPresented: $reportOpen) {
            ReportIssueSheet(bookId: bookId, bookTitle: bookTitle)
                .presentationDetents([.medium])
                .presentationBackground(Theme.surface)
        }
    }
}

private struct ReportIssueSheet: View {
    let bookId: String
    let bookTitle: String
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var sent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Report an issue")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
            Text("Something wrong with \"\(bookTitle)\"? Wrong cover, duplicate entry, bad metadata, content-rating problem — tell us and we'll fix it.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)

            TextEditor(text: $text)
                .scrollContentBackground(.hidden)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground)
                .frame(minHeight: 100)
                .padding(10)
                .background(Theme.surfaceAlt.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))

            Button {
                sending = true
                Task {
                    struct Body: Codable, Sendable { let report: String }
                    struct Ok: Codable { let ok: Bool }
                    let _: Ok? = try? await APIClient.shared.request(
                        "/api/v1/books/\(bookId)/flags", method: "POST", json: Body(report: text))
                    sending = false
                    sent = true
                    try? await Task.sleep(for: .seconds(0.8))
                    dismiss()
                }
            } label: {
                if sending { ProgressView().tint(.black) }
                else if sent { Text("Thank you! 🙏") }
                else { Text("Send report") }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || sending || sent)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.surface)
    }
}
