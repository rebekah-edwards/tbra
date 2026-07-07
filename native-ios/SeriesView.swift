import SwiftUI

// Series page — recreates /series/[slug] (series-books-view.tsx):
// series name, Core/All/Sets segmented (counts derived exactly like the
// web: core = integer-positioned non-boxset, all = non-boxset,
// sets = boxsets), and book cards with cover, "Book N · YEAR", author,
// compact state pill + Owned pill.

struct SeriesRoute: Hashable { let slug: String }

/// One modifier carrying every app-wide navigation destination, so each
/// tab's NavigationStack registers the same routes without drift.
struct AppDestinations: ViewModifier {
    func body(content: Content) -> some View {
        content
            .navigationDestination(for: BookRoute.self) { route in
                BookDetailView(idOrSlug: route.idOrSlug)
            }
            .navigationDestination(for: SeriesRoute.self) { route in
                SeriesView(slug: route.slug)
            }
            .navigationDestination(for: AuthorRoute.self) { route in
                AuthorView(idOrSlug: route.idOrSlug)
            }
            .navigationDestination(for: UserRoute.self) { route in
                PublicProfileView(username: route.username)
            }
    }
}
extension View {
    func appDestinations() -> some View { modifier(AppDestinations()) }
}

struct SeriesBookRow: Codable, Hashable, Identifiable {
    let id: String
    let slug: String?
    let title: String
    let coverImageUrl: String?
    let position: Double?
    let publicationYear: Int?
    let isBoxSet: Bool
    let authors: [BookAuthor]
    let currentState: String?
    let ownedFormats: [String]
    let userRating: Double?
}

@MainActor
@Observable
final class SeriesModel {
    let slug: String
    var name = ""
    var books: [SeriesBookRow] = []
    var error: String?
    var loading = false

    init(slug: String) { self.slug = slug }

    func load() async {
        loading = true; defer { loading = false }
        struct Res: Codable { let ok: Bool; let name: String; let books: [SeriesBookRow] }
        do {
            let res: Res = try await APIClient.shared.get("/api/v1/series/\(slug)") as Res
            name = res.name
            books = res.books
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load this series."
        }
    }
}

struct SeriesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: SeriesModel
    @State private var tab: Tab = .core

    enum Tab: String, CaseIterable {
        case core = "Core", all = "All", sets = "Sets"
    }

    init(slug: String) {
        _model = State(initialValue: SeriesModel(slug: slug))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.foreground.opacity(0.9))
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.35), in: Circle())
                            .overlay(Circle().stroke(Theme.border, lineWidth: 1))
                    }
                    Text(model.name)
                        .font(Theme.heading(26, .bold))
                        .foregroundStyle(Theme.foreground)
                    Spacer()
                }
                .padding(.top, 14)

                segmented

                if tab == .core {
                    Text("Main series novels")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                }

                VStack(spacing: 14) {
                    ForEach(filtered) { book in
                        seriesCard(book)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(AmbientBackground())
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    // series-books-view.tsx filters, 1:1
    private var filtered: [SeriesBookRow] {
        switch tab {
        case .core:
            return model.books.filter { !$0.isBoxSet && $0.position != nil && ($0.position!).truncatingRemainder(dividingBy: 1) == 0 }
        case .all:
            return model.books.filter { !$0.isBoxSet }
        case .sets:
            return model.books.filter { $0.isBoxSet }
        }
    }

    private func count(_ t: Tab) -> Int {
        switch t {
        case .core: return model.books.filter { !$0.isBoxSet && $0.position != nil && ($0.position!).truncatingRemainder(dividingBy: 1) == 0 }.count
        case .all: return model.books.filter { !$0.isBoxSet }.count
        case .sets: return model.books.filter { $0.isBoxSet }.count
        }
    }

    private var segmented: some View {
        HStack(spacing: 4) {
            ForEach(Tab.allCases, id: \.self) { t in
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { tab = t }
                } label: {
                    HStack(spacing: 6) {
                        Text(t.rawValue)
                            .font(Theme.body(16, tab == t ? .bold : .medium))
                        Text("\(count(t))")
                            .font(Theme.body(13))
                            .opacity(0.7)
                    }
                    .foregroundStyle(tab == t ? .black : Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(tab == t ? Theme.accent : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(4)
        .background(Theme.surfaceAlt.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func seriesCard(_ book: SeriesBookRow) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: BookRoute(idOrSlug: book.slug ?? book.id)) {
                HStack(alignment: .top, spacing: 14) {
                    CoverThumb(url: book.coverImageUrl, width: 74, height: 111, radius: 8)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(book.title)
                            .font(Theme.body(18, .bold))
                            .foregroundStyle(Theme.foreground)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 4) {
                            if let pos = book.position {
                                Text(pos.truncatingRemainder(dividingBy: 1) == 0
                                     ? "Book \(Int(pos))" : "Book \(String(format: "%.1f", pos))")
                            }
                            if let year = book.publicationYear {
                                if book.position != nil { Text("·") }
                                Text(String(year))
                            }
                        }
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                        Text(book.authors.map(\.name).joined(separator: ", "))
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
            }
            .buttonStyle(TapScaleButtonStyle())

            HStack(spacing: 10) {
                CompactStatePill(bookId: book.id, state: book.currentState)
                OwnedPill(count: book.ownedFormats.filter { $0 != "unknown" }.count)
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
        .background(Theme.surface.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border, lineWidth: 1))
    }
}
