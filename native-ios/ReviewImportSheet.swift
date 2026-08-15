import SwiftUI
import PhotosUI
import Vision

// Import a review from a Goodreads / Fable / StoryGraph screenshot.
//
// The book is ALREADY known — this sheet only ever opens from the review
// wizard, which is opened for one specific book. So there is no title
// matching, no "is this the right book?" step, and no ambiguity UI.
//
// Pipeline: PhotosPicker → on-device Vision OCR → POST the TEXT to
// /api/v1/reviews/parse-import → show what was found → the reader taps Use,
// and the values pre-fill the wizard. Nothing is ever saved from here.
//
// Text, not the image: Vision is free, fast, private and works offline, and
// sending extracted text costs a fraction of the tokens an image upload would.

struct ImportedReview: Codable, Sendable {
    let source: String
    let overallRating: Double?
    let ratingSource: String
    let reviewText: String?
    let reviewTextTruncated: Bool
    let mood: String?
    let plotPacing: String?
    let dimensionRatings: [String: Double]
    let dimensionTags: [String: [String]]
    let unmapped: [String]

    var sourceLabel: String {
        switch source {
        case "goodreads": return "Goodreads"
        case "fable": return "Fable"
        case "storygraph": return "StoryGraph"
        default: return "that screenshot"
        }
    }
}

@MainActor
@Observable
final class ReviewImportModel {
    let bookId: String
    let bookTitle: String
    let authors: [String]
    let isFiction: Bool

    /// Up to 3 screenshots. Reviews routinely span more than one screen —
    /// Fable puts the per-dimension ratings well below the review text — and
    /// a single shot silently loses whatever was scrolled off.
    static let maxImages = 3
    var picked: [PhotosPickerItem] = []
    var stage: Stage = .idle
    /// How many images the current run is chewing through, for the spinner copy.
    var imageCount = 1
    var result: ImportedReview?
    var error: String?

    enum Stage { case idle, reading, parsing, done }

    init(bookId: String, bookTitle: String, authors: [String], isFiction: Bool) {
        self.bookId = bookId
        self.bookTitle = bookTitle
        self.authors = authors
        self.isFiction = isFiction
    }

    func handlePick(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        error = nil
        result = nil
        stage = .reading
        imageCount = items.count
        defer { if stage != .done { stage = .idle } }

        // OCR every image, then parse the COMBINED text in one request: the
        // shots are pages of one review, and parsing them separately would
        // produce competing partial results the user would have to reconcile.
        var chunks: [String] = []
        for item in items.prefix(Self.maxImages) {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data), let cg = image.cgImage else { continue }
            let chunk = await Self.recognizeText(in: cg)
            if !chunk.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                chunks.append(chunk)
            }
        }
        guard !chunks.isEmpty else {
            error = items.count == 1
                ? "No text found in that screenshot."
                : "No text found in those screenshots."
            return
        }
        let text = chunks.joined(separator: "\n")

        stage = .parsing
        struct Body: Codable, Sendable {
            let text: String; let isFiction: Bool
            let title: String; let authors: [String]
        }
        struct Res: Codable { let ok: Bool; let parsed: ImportedReview }
        do {
            let res: Res = try await APIClient.shared.request(
                "/api/v1/reviews/parse-import", method: "POST",
                json: Body(text: text, isFiction: isFiction, title: bookTitle, authors: authors)
            )
            result = res.parsed
            stage = .done
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't read that screenshot."
        }
    }

    /// On-device OCR. `.accurate` with language correction — these are dense
    /// UI screenshots, and the fast path drops punctuation and merges the
    /// pill rows, which is exactly the structure the parser keys on.
    ///
    /// `nonisolated` is REQUIRED, not stylistic: this type is @MainActor, so
    /// without it the VNRecognizeTextRequest completion closure inherits main-
    /// actor isolation — but Vision invokes it on its own background queue,
    /// and resuming the continuation there trips
    /// `_dispatch_assert_queue_fail` and kills the app with SIGTRAP. (Crashed
    /// on the first real photo pick, 2026-08-13.) Same family of bug as the
    /// chromeCircle trap noted in Theme.swift.
    private nonisolated static func recognizeText(in image: CGImage) async -> String {
        await withCheckedContinuation { continuation in
            let request = VNRecognizeTextRequest { request, _ in
                let lines = (request.results as? [VNRecognizedTextObservation] ?? [])
                    .compactMap { $0.topCandidates(1).first?.string }
                continuation.resume(returning: lines.joined(separator: "\n"))
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            DispatchQueue.global(qos: .userInitiated).async {
                do { try handler.perform([request]) }
                catch { continuation.resume(returning: "") }
            }
        }
    }
}

struct ReviewImportSheet: View {
    @State var model: ReviewImportModel
    /// Handed the parsed review when the reader accepts it.
    let onUse: (ImportedReview) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let r = model.result {
                        summary(r)
                    } else {
                        intro
                    }
                    if let error = model.error {
                        Text(error)
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.destructive)
                    }
                }
                .padding(20)
            }
            .background(Theme.bg)
            .navigationTitle("Import a review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) { footer }
        }
        .onChange(of: model.picked) { _, items in
            Task { await model.handlePick(items) }
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(Theme.accent)
                Text("Bring your review over")
                    .font(Theme.heading(28))
                    .foregroundStyle(Theme.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Screenshot your review on Goodreads, Fable or StoryGraph and we'll fill in as much as we can.")
                    .font(Theme.body(17))
                    .foregroundStyle(Theme.foreground.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 12) {
                bullet("star.fill", "Your star rating and everything you wrote")
                bullet("tag.fill", "Ratings and tags for characters, plot, setting and more")
                bullet("checkmark.circle.fill", "You check it all before anything saves")
            }

            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "lock.fill")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                Text("Your screenshots never leave your phone — only the text we read from them is sent.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))

            Text("You can pick up to \(ReviewImportModel.maxImages) screenshots if your review runs past one screen.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: icon)
                .font(Theme.body(14))
                .foregroundStyle(Theme.accentText)
                .frame(width: 20)
            Text(text)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private func summary(_ r: ImportedReview) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Found in your \(r.sourceLabel) review")
                .font(Theme.heading(22))
                .foregroundStyle(Theme.foreground)

            if let rating = r.overallRating {
                row("Rating", String(format: "%.2f", rating)
                    .replacingOccurrences(of: ".00", with: "") + " stars"
                    + (r.ratingSource == "glyph" ? " (double-check this)" : ""))
            } else {
                row("Rating", "not found — you'll set it on the next screen")
            }
            if let mood = r.mood { row("Mood", mood.capitalized) }
            if let pacing = r.plotPacing { row("Pacing", pacing.capitalized) }
            // ForEach, not `for` — a ViewBuilder can't contain a for-in loop.
            ForEach(r.dimensionRatings.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                row(key.capitalized, String(format: "%.2f", value))
            }
            ForEach(r.dimensionTags.sorted(by: { $0.key < $1.key }).filter { !$0.value.isEmpty },
                    id: \.key) { key, tags in
                row("\(key.capitalized) tags", tags.joined(separator: ", "))
            }
            if let text = r.reviewText, !text.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("YOUR REVIEW")
                        .font(Theme.body(12, .semibold)).tracking(0.8)
                        .foregroundStyle(Theme.muted)
                    Text(text)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(8)
                    if r.reviewTextTruncated {
                        // Screenshots cut long reviews off at "…more"; saying so
                        // beats the reader discovering it after saving.
                        Text("The screenshot cut this off — you may want to finish it.")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
            if !r.unmapped.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("WE COULDN'T MATCH THESE")
                        .font(Theme.body(12, .semibold)).tracking(0.8)
                        .foregroundStyle(Theme.muted)
                    Text(r.unmapped.joined(separator: " · "))
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label)
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
                .frame(width: 124, alignment: .leading)
            Text(value)
                .font(Theme.body(15, .medium))
                .foregroundStyle(Theme.foreground)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private var footer: some View {
        VStack(spacing: 10) {
            switch model.stage {
            case .reading, .parsing:
                HStack(spacing: 8) {
                    ProgressView().tint(Theme.accent)
                    Text(model.stage == .reading
                         ? (model.imageCount > 1
                            ? "Reading \(model.imageCount) screenshots…"
                            : "Reading the screenshot…")
                         : "Matching it up…")
                        .font(Theme.body(13)).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            case .done:
                Button("Use this") {
                    if let r = model.result { onUse(r) }
                    dismiss()
                }
                .buttonStyle(AccentButtonStyle())
                PhotosPicker(selection: $model.picked,
                             maxSelectionCount: ReviewImportModel.maxImages,
                             matching: .images) {
                    Text("Pick different screenshots")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.neonBlue)
                }
            case .idle:
                PhotosPicker(selection: $model.picked,
                             maxSelectionCount: ReviewImportModel.maxImages,
                             matching: .images) {
                    Text("Choose screenshots")
                        .font(Theme.body(16, .bold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(.horizontal, 20)
        // Sat right on the home indicator, which made both controls awkward
        // to hit; this lifts the whole footer clear of the bottom edge.
        .padding(.bottom, 34)
        .padding(.top, 6)
        .background(Theme.bg)
    }
}
