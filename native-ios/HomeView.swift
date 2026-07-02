import SwiftUI
import UniformTypeIdentifiers

// Home — recreates the mobile site's home page (src/app/page.tsx).
// Currently renders the sections the /api/v1 surface can power:
// the "Up Next" numbered 2-column card grid (BookCard style). The
// Reading Now / reading-goal / streak sections need new v1 endpoints
// and slot in above this grid later.

struct HomeView: View {
    @State private var model = UpNextModel()
    @State private var dragging: UpNextItem?

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Up Next")
                    .font(Theme.heading(26, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 22)

                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                        UpNextCard(item: item, number: index + 1)
                            .opacity(dragging?.id == item.id ? 0.4 : 1)
                            .onDrag {
                                dragging = item
                                return NSItemProvider(object: item.bookId as NSString)
                            }
                            .onDrop(of: [.text], delegate: GridReorderDelegate(
                                item: item,
                                items: $model.items,
                                dragging: $dragging,
                                commit: { model.persistOrder() }
                            ))
                    }
                }

                if model.items.isEmpty && !model.loading {
                    Text("Nothing queued yet")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}

// One Up Next card — matches the site's BookCard: blurred-cover-tinted
// dark card, cover with purple position badge, uppercase genre, bold
// title, page count, drag handle.
private struct UpNextCard: View {
    let item: UpNextItem
    let number: Int

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            CoverThumb(url: item.coverImageUrl, width: 52, height: 78, radius: 8)
                .overlay(alignment: .topLeading) {
                    Text("\(number)")
                        .font(Theme.body(12, .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Theme.neonPurple)
                        .clipShape(Circle())
                        .offset(x: -6, y: -6)
                }
                .padding(.top, 4)
                .padding(.leading, 4)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 4) {
                    Text((item.topLevelGenre ?? " ").uppercased())
                        .font(Theme.body(9, .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .padding(.top, 9)
                    Spacer(minLength: 2)
                    // Drag handle in a translucent dark circle (top-right).
                    DragHandleIcon()
                        .stroked(lineWidth: 2)
                        .frame(width: 11, height: 11)
                        .foregroundStyle(Theme.muted)
                        .frame(width: 28, height: 28)
                        .background(.black.opacity(0.30))
                        .clipShape(Circle())
                }
                Text(item.title)
                    .font(Theme.body(15, .bold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let pages = item.pages {
                    Text("\(pages)p")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
        .background(
            ZStack {
                Theme.surfaceAlt
                // The site's cards glow faintly with the cover's own colors —
                // blurred cover under a dark scrim so every card stays dark.
                if let cover = item.coverImageUrl, let url = URL(string: cover) {
                    AsyncImage(url: url) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                            .blur(radius: 22)
                            .opacity(0.30)
                    } placeholder: { Color.clear }
                    Color.black.opacity(0.30)
                }
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// Live-reordering drop delegate shared by the card grids: swaps items as
// the drag passes over them, persists once on drop (the API wants the
// complete final order).
struct GridReorderDelegate<Item: Identifiable & Equatable>: DropDelegate {
    let item: Item
    @Binding var items: [Item]
    @Binding var dragging: Item?
    let commit: () -> Void

    func dropEntered(info: DropInfo) {
        guard let dragging, dragging != item,
              let from = items.firstIndex(of: dragging),
              let to = items.firstIndex(of: item) else { return }
        withAnimation(.easeOut(duration: 0.15)) {
            items.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }

    func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        commit()
        return true
    }
}
