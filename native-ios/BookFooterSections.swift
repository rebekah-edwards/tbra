import SwiftUI

// Friends Who Read (friends-who-read.tsx): avatar row of followed users
// who have this book, with their state/rating. Plus the book footer
// actions: Hide from recommendations (hide-book-button.tsx) and Report
// an issue (report-issue-button.tsx bottom sheet → reported_issues).

struct FriendsWhoReadSection: View {
    let friends: [FriendWhoRead]
    /// For routing a friend's card to THEIR review of this book.
    var bookIdOrSlug: String = ""
    var bookTitle: String = ""

    /// The list ran to full length, so a popular book buried everything below
    /// it under dozens of rows (punch list #2, 2026-08-08).
    @State private var expanded = false
    private static let collapsedCount = 3

    /// Friends who shared a note on this book lead the list, so the note is
    /// visible without expanding it; everyone else keeps the server's order.
    private var ordered: [FriendWhoRead] {
        let hasNote: (FriendWhoRead) -> Bool = { !($0.sharedNote ?? "").isEmpty }
        return friends.filter(hasNote) + friends.filter { !hasNote($0) }
    }

    private var visible: [FriendWhoRead] {
        expanded ? ordered : Array(ordered.prefix(Self.collapsedCount))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Friends Who Read It")
            VStack(spacing: 10) {
                ForEach(visible) { friend in
                    // Reviewed → jump to their review (web: reviews#review-id);
                    // otherwise → their profile.
                    Group {
                        if let reviewId = friend.reviewId {
                            NavigationLink(value: ReviewsRoute(
                                bookIdOrSlug: bookIdOrSlug,
                                bookTitle: bookTitle,
                                scrollToReviewId: reviewId)) {
                                row(friend)
                            }
                        } else {
                            NavigationLink(value: UserRoute(username: friend.username ?? "")) {
                                row(friend)
                            }
                            .disabled(friend.username == nil)
                        }
                    }
                }
            }
            if friends.count > Self.collapsedCount {
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
                } label: {
                    HStack(spacing: 5) {
                        Text(expanded
                             ? "Show fewer"
                             : "Show all \(friends.count) readers")
                            .font(Theme.body(13, .medium))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .rotationEffect(.degrees(expanded ? 180 : 0))
                    }
                    .foregroundStyle(Theme.neonBlue)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
            }
        }
    }

    private func row(_ friend: FriendWhoRead) -> some View {
        HStack(spacing: 12) {
            avatar(friend)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.displayName ?? friend.username ?? "Reader")
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(Theme.foreground)
                Text(friend.reviewId != nil ? "\(stateLabel(friend.state)) · reviewed it" : stateLabel(friend.state))
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                // A note they marked shared. The server never sends a private one.
                if let note = friend.sharedNote, !note.isEmpty {
                    Text("\u{201C}\(note)\u{201D}")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.foreground.opacity(0.8))
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .padding(.top, 2)
                }
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
            if friend.reviewId != nil {
                Image(systemName: "text.quote")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.neonBlue)
            }
        }
        .padding(12)
        .background(Theme.surface.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
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
            .coachAnchor("tour-report")
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

// ── What Readers Think — web review-summary.tsx ──
// Readers' reviews ON the book page (Rebekah, 2026-11-25: they weren't
// visible on iOS at all, only behind the "N reviews" link). Top five by
// helpful votes, each tapping through to that review in the full list.
struct WhatReadersThinkSection: View {
    let summary: BookReviewSummary
    let bookIdOrSlug: String
    let bookTitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("What Readers Think")
            VStack(spacing: 10) {
                ForEach(summary.topReviews) { review in
                    NavigationLink(value: ReviewsRoute(
                        bookIdOrSlug: bookIdOrSlug,
                        bookTitle: bookTitle,
                        scrollToReviewId: review.id)) {
                        card(review)
                    }
                    .buttonStyle(.plain)
                }
            }
            NavigationLink(value: ReviewsRoute(bookIdOrSlug: bookIdOrSlug, bookTitle: bookTitle)) {
                HStack(spacing: 4) {
                    Text(summary.totalReviewCount > 1
                         ? "View all \(summary.totalReviewCount) reviews"
                         : "View review")
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                }
                .font(Theme.body(14, .semibold))
                .foregroundStyle(Theme.neonBlue)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
        }
    }

    private func name(_ r: CompactReview) -> String {
        if r.isAnonymous { return "Anonymous" }
        if let d = r.displayName, !d.isEmpty { return d }
        if let u = r.username, !u.isEmpty { return "@\(u)" }
        return "tbr*a reader"
    }

    private func card(_ r: CompactReview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                avatar(r)
                Text(name(r))
                    .font(Theme.body(14, .semibold))
                    .italic(r.isAnonymous)
                    .foregroundStyle(r.isAnonymous ? Theme.muted : Theme.foreground)
                    .lineLimit(1)
                Spacer(minLength: 6)
                if let rating = r.overallRating {
                    HStack(spacing: 5) {
                        StarRow(rating: rating, size: 11)
                        Text(friendsRatingText(rating))
                            .font(Theme.body(12, .semibold))
                            .foregroundStyle(Theme.foreground)
                    }
                }
            }
            Text(r.reviewTextPlain)
                .font(Theme.body(14))
                .foregroundStyle(Theme.foreground.opacity(0.8))
                .lineSpacing(2)
                .lineLimit(6)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.foreground.opacity(0.1), lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 18))
    }

    @ViewBuilder private func avatar(_ r: CompactReview) -> some View {
        Group {
            if !r.isAnonymous, let avatarUrl = r.avatarUrl,
               let url = avatarUrl.hasPrefix("/")
                   ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
                   : URL(string: avatarUrl) {
                CachedCoverImage(url: url) { Theme.accent }
            } else {
                ZStack {
                    r.isAnonymous ? Theme.surfaceAlt : Theme.accent
                    Text(r.isAnonymous ? "?" : String(name(r).replacingOccurrences(of: "@", with: "").prefix(1)).uppercased())
                        .font(Theme.body(12, .bold))
                        .foregroundStyle(r.isAnonymous ? Theme.muted : Color.black)
                }
            }
        }
        .frame(width: 28, height: 28)
        .clipShape(Circle())
    }
}

// ── Author tools — web components/author/author-tools-card.tsx ──
// Only for the book's verified author: replace the description (applies at
// once; staff are notified and can revert). Ratings are confirmed/corrected
// with the pencil in What's Inside.
struct AuthorToolsCard: View {
    let bookId: String
    let description: String?
    let onSaved: () -> Void
    @State private var editing = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "pencil.line")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.accentText)
                .frame(width: 32, height: 32)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
            VStack(alignment: .leading, spacing: 4) {
                Text("AUTHOR TOOLS")
                    .font(Theme.body(11, .semibold)).tracking(1.1)
                    .foregroundStyle(Theme.muted)
                Text("You're this book's verified author.")
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.foreground)
                Text("Update the description, and tap the pencil on any rating in What's Inside to confirm it or correct it.")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button { editing = true } label: {
                    Text("Edit description")
                        .font(Theme.body(13, .semibold))
                        .foregroundStyle(Theme.foreground)
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(.ultraThinMaterial, in: Capsule())
                        .overlay(Capsule().stroke(Theme.foreground.opacity(0.14), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(LinearGradient(colors: [Theme.accent.opacity(0.55), Color(hex: "38bdf8").opacity(0.35), Color(hex: "c084fc").opacity(0.45)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
        )
        .sheet(isPresented: $editing) {
            AuthorDescriptionSheet(bookId: bookId, initial: description ?? "", onSaved: onSaved)
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
        }
    }
}

private struct AuthorDescriptionSheet: View {
    @Environment(\.dismiss) private var dismiss
    let bookId: String
    let onSaved: () -> Void
    @State private var text: String
    @State private var saving = false
    @State private var error: String?

    init(bookId: String, initial: String, onSaved: @escaping () -> Void) {
        self.bookId = bookId
        self.onSaved = onSaved
        _text = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Book description")
                    .font(Theme.heading(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                }
            }
            .padding(.top, 18)
            TextEditor(text: $text)
                .scrollContentBackground(.hidden)
                .font(Theme.body(14))
                .foregroundStyle(Theme.foreground)
                .padding(10)
                .background(Theme.surfaceAlt.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
                .onChange(of: text) { if text.count > 6000 { text = String(text.prefix(6000)) } }
            Text("Blank lines start a new paragraph; **bold** and *italic* work. No spoilers past the setup, please. Our team is notified of every change.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            if let error {
                Text(error).font(Theme.body(12)).foregroundStyle(Theme.destructive)
            }
            Button { save() } label: {
                Text(saving ? "Saving…" : "Save description")
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Theme.accent, in: Capsule())
            }
            .disabled(saving)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
        .background(Theme.bg)
    }

    private func save() {
        saving = true; error = nil
        Task {
            defer { saving = false }
            struct Ok: Codable { let ok: Bool }
            do {
                let _: Ok = try await APIClient.shared.request(
                    "/api/v1/books/\(bookId)/author-edit", method: "POST", body: ["description": text])
                onSaved()
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Couldn't save the description."
            }
        }
    }
}
