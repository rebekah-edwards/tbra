import SwiftUI

// Edition picker — recreates edition-picker.tsx: OpenLibrary editions of
// the book's work (the web's known OL-only limitation applies), with
// cover, title, year, publisher, pages, ISBN; select imports + marks the
// edition owned for the format; tapping the selected one removes it.
// Paginated 50 at a time with Load more.

struct OLEditionRow: Codable, Hashable {
    let key: String
    let title: String?
    let publish_date: String?
    let publishers: [String]?
    let isbn_13: [String]?
    let isbn_10: [String]?
    let number_of_pages: Int?
    let covers: [Int]?
    let physical_format: String?
}

struct EditionSelectionRow: Codable, Hashable {
    let editionId: String
    let format: String
    let openLibraryKey: String?
}

struct EditionPickerSheet: View {
    let bookId: String
    let format: String
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var entries: [OLEditionRow] = []
    @State private var total = 0
    @State private var selections: [EditionSelectionRow] = []
    @State private var loading = true
    @State private var busyKey: String?

    private var selectedKeyForFormat: String? {
        selections.first { $0.format == format }?.openLibraryKey
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Choose your \(formatLabel) edition")
                .font(Theme.heading(18, .bold))
                .foregroundStyle(Theme.foreground)
                .padding(20)

            if loading && entries.isEmpty {
                ProgressView().tint(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
                Spacer()
            } else if entries.isEmpty {
                Text("No editions found on OpenLibrary for this book yet.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 20)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(entries, id: \.key) { edition in
                            editionRow(edition)
                        }
                        if entries.count < total {
                            Button("Load more (\(entries.count)/\(total))") {
                                Task { await load(offset: entries.count) }
                            }
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(Theme.neonBlue)
                            .padding(.vertical, 10)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }
            }
        }
        .background(Theme.bg)
        .task { await load(offset: 0) }
    }

    private var formatLabel: String {
        ["hardcover": "hardcover", "paperback": "paperback", "ebook": "eBook", "audiobook": "audiobook"][format] ?? format
    }

    private func editionRow(_ edition: OLEditionRow) -> some View {
        let isSelected = edition.key == selectedKeyForFormat
        return Button {
            guard busyKey == nil else { return }
            busyKey = edition.key
            Task {
                if isSelected {
                    if let sel = selections.first(where: { $0.format == format }) {
                        struct Body: Codable, Sendable { let editionId: String; let format: String }
                        struct Ok: Codable { let ok: Bool }
                        let _: Ok? = try? await APIClient.shared.request(
                            "/api/v1/books/\(bookId)/editions", method: "DELETE",
                            json: Body(editionId: sel.editionId, format: format))
                    }
                } else {
                    struct Body: Codable, Sendable { let edition: OLEditionRow; let format: String }
                    struct Ok: Codable { let ok: Bool; let editionId: String }
                    let _: Ok? = try? await APIClient.shared.request(
                        "/api/v1/books/\(bookId)/editions", method: "POST",
                        json: Body(edition: edition, format: format))
                }
                await load(offset: 0, keepEntries: true)
                busyKey = nil
                onChanged()
            }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                if let coverId = edition.covers?.first {
                    CoverThumb(url: "https://covers.openlibrary.org/b/id/\(coverId)-M.jpg",
                               width: 46, height: 69, radius: 5)
                } else {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Theme.surfaceAlt)
                        .frame(width: 46, height: 69)
                        .overlay(Image(systemName: "book.closed").foregroundStyle(Theme.muted.opacity(0.5)))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(edition.title ?? "Untitled edition")
                        .font(Theme.body(14, .semibold))
                        .foregroundStyle(Theme.foreground)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    HStack(spacing: 4) {
                        if let date = edition.publish_date { Text(date) }
                        if let publisher = edition.publishers?.first {
                            Text("·"); Text(publisher).lineLimit(1)
                        }
                    }
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
                    HStack(spacing: 4) {
                        if let pages = edition.number_of_pages { Text("\(pages) pp") }
                        if let fmt = edition.physical_format { Text("·"); Text(fmt) }
                        if let isbn = edition.isbn_13?.first ?? edition.isbn_10?.first {
                            Text("·"); Text(isbn)
                        }
                    }
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.muted.opacity(0.8))
                    .lineLimit(1)
                }
                Spacer()
                if busyKey == edition.key {
                    ProgressView().tint(Theme.accent)
                } else if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Theme.accent)
                }
            }
            .padding(12)
            .background(isSelected ? Theme.accent.opacity(0.08) : Theme.surface.opacity(0.55))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1))
        }
    }

    private func load(offset: Int, keepEntries: Bool = false) async {
        if offset == 0 && !keepEntries { loading = true }
        struct Res: Codable {
            let ok: Bool
            let entries: [OLEditionRow]
            let size: Int
            let selections: [EditionSelectionRow]
        }
        if let res: Res = try? await APIClient.shared.get(
            "/api/v1/books/\(bookId)/editions",
            query: [URLQueryItem(name: "offset", value: String(offset))]) {
            if offset == 0 {
                if !keepEntries { entries = res.entries }
                selections = res.selections
            } else {
                entries.append(contentsOf: res.entries)
            }
            total = res.size
            if keepEntries { selections = res.selections }
        }
        loading = false
    }
}
