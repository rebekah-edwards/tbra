import SwiftUI

// The 5-step review wizard — recreates review-wizard.tsx + steps/*:
//  1 Overall rating (quarter-step stars, DNF toggle + how-far slider)
//  2 Mood (18-emoji grid, single select)
//  3 Dimensions (fiction: Characters/Plot/Setting/Prose · nonfiction:
//    Substance/Evidence/Clarity/Voice) — quarter-star per dimension +
//    descriptor tag chips + plot pacing
//  4 Review text + post-anonymously toggle
//  5 Content details (proposed intensity corrections against the book's
//    What's Inside grid + user-added trigger warnings + comments)

// ─── Constants (review-constants.ts, 1:1) ───

struct ReviewMood: Identifiable { let key: String; let label: String; let emoji: String; var id: String { key } }

let REVIEW_MOODS: [ReviewMood] = [
    .init(key: "inspired", label: "Inspired", emoji: "✨"), .init(key: "romantic", label: "Romantic", emoji: "🥰"),
    .init(key: "emotional", label: "Emotional", emoji: "😢"), .init(key: "contemplative", label: "Contemplative", emoji: "🤔"),
    .init(key: "mind-blown", label: "Mind-blown", emoji: "🤯"), .init(key: "devastated", label: "Devastated", emoji: "😭"),
    .init(key: "frightened", label: "Frightened", emoji: "😨"), .init(key: "angry", label: "Angry", emoji: "😡"),
    .init(key: "nostalgic", label: "Nostalgic", emoji: "🍃"), .init(key: "empty", label: "Empty", emoji: "🫥"),
    .init(key: "curious", label: "Curious", emoji: "🧐"), .init(key: "happy", label: "Happy", emoji: "😊"),
    .init(key: "silly", label: "Silly", emoji: "🤪"), .init(key: "shaken", label: "Shaken", emoji: "😳"),
    .init(key: "surprised", label: "Surprised", emoji: "😲"), .init(key: "informed", label: "Informed", emoji: "🤓"),
    .init(key: "confused", label: "Confused", emoji: "😕"), .init(key: "grateful", label: "Grateful", emoji: "🙏"),
]

let FICTION_DIMENSIONS: [(key: String, label: String)] = [
    ("characters", "Characters"), ("plot", "Plot"), ("setting", "Setting"), ("prose", "Prose"),
]
let NONFICTION_DIMENSIONS: [(key: String, label: String)] = [
    ("substance", "Substance"), ("evidence", "Evidence"), ("clarity", "Clarity"), ("voice", "Voice"),
]

let DIMENSION_TAGS: [String: [String]] = [
    "characters": ["Relatable", "Lovable", "Morally grey", "Predictable", "Inconsistent", "Well-developed",
                   "Compelling", "Complex", "Simple", "Realistic", "Flawed", "Annoying", "Memorable",
                   "Forgettable", "Flat", "Unlikable", "Under-developed", "Diverse", "Swoon-worthy"],
    "plot": ["Nonlinear", "Epic", "Intimate", "Cozy", "Predictable", "Satisfying", "Unrealistic",
             "Frustrating", "Confusing", "Poorly structured", "Shocking", "Slow-burn", "Gripping",
             "Twisty", "Emotional", "Immersive", "Layered", "Suspenseful", "Boring", "Rushed",
             "Repetitive", "Formulaic", "Original", "Dark", "Tropey"],
    "setting": ["Contemporary/modern", "Historical", "Fantastical", "Urban", "Rural", "Futuristic",
                "Utopian", "Dystopian", "Familiar", "Sparse", "Generic", "Under-developed", "Confined",
                "Expansive", "Vivid", "Haunting", "Magical", "Extraterrestrial", "Alternate Earth",
                "Gritty", "Inconsistent", "Atmospheric", "Immersive", "Richly detailed", "Small-town",
                "Cozy", "Bleak"],
    "prose": ["Complex", "Simple", "Lyrical / Poetic", "Dense", "Clunky", "Whimsical", "Humorous",
              "Flowery", "Poorly written", "Elegant", "Witty", "Flat", "Boring", "Dry", "Accessible",
              "Beautiful", "Choppy", "Over-written", "Punchy", "Repetitive"],
    "substance": ["Illuminating", "Surface-level", "Paradigm-shifting", "Repetitive", "Actionable",
                  "Dense", "Hand-wavy", "Thought-provoking", "Quotable", "Forgettable", "Life-changing",
                  "Boring", "Practical", "Inspiring", "Overhyped", "Well-argued", "Rambling"],
    "evidence": ["Well-sourced", "Cherry-picked", "Peer-reviewed", "Lived-experience", "Opinion-heavy",
                 "Balanced", "Inflammatory", "Data-driven", "Under-researched", "Primary sources",
                 "Credible", "Anecdotal", "Outdated", "Rigorous", "Transparent", "One-sided"],
    "clarity": ["Jargon-heavy", "Beginner-friendly", "Over-simplified", "Technical", "Plain-spoken",
                "Meandering", "Well-organized", "Circuitous", "Crystal clear", "Dense", "Confusing",
                "Repetitive", "Concise", "Bloated", "Easy to follow"],
    "voice": ["Academic", "Warm", "Urgent", "Dry", "Memoir-like", "Sermonizing", "Witty", "Self-indulgent",
              "Humble", "Confrontational", "Conversational", "Detached", "Boring", "Authoritative",
              "Compassionate", "Snarky", "Inspiring", "Preachy"],
]

// ─── Model ───

struct ExistingReview: Codable {
    let overallRating: Double?
    let didNotFinish: Bool
    let dnfPercentComplete: Int?
    let reviewText: String?
    let mood: String?
    let isAnonymous: Bool
    let contentComments: String
    let customContentWarning: String
    let plotPacing: String?
    let dimensionRatings: [String: Double]
    let dimensionTags: [String: [String]]
}

@MainActor
@Observable
final class ReviewWizardModel {
    let bookId: String
    let isFiction: Bool?
    let ratings: [ContentRating]

    var step = 0
    var overallRating: Double? = nil
    var didNotFinish = false
    var dnfPercent: Double = 50
    var mood: String? = nil
    var dimensionRatings: [String: Double] = [:]
    var dimensionTags: [String: Set<String>] = [:]
    var plotPacing: String? = nil
    var reviewText = ""
    var isAnonymous = false
    var contentComments = ""
    var userAddedWarnings = ""
    /// categoryKey → the proposed intensity plus the proposed content note.
    /// The note is the PUBLIC copy for that category, seeded from what the
    /// book says now: the admin apply route writes proposed_notes straight
    /// into book_category_ratings.notes, so editing beats writing fresh.
    struct ProposedCorrection: Equatable { var intensity: Int; var note: String = "" }
    var proposedCorrections: [String: ProposedCorrection] = [:]

    /// Records a proposal for a category, or clears it when nothing differs
    /// from what the book already says. Either half can be the change — a
    /// different intensity, edited copy, or both. Mirrors buildProposal() in
    /// step-content-details.tsx.
    func setProposal(for rating: ContentRating, intensity: Int?, note: String) {
        let intensityChanged = intensity != nil && intensity != rating.intensity
        let noteChanged = note.trimmingCharacters(in: .whitespacesAndNewlines)
            != (rating.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard intensityChanged || noteChanged else {
            proposedCorrections.removeValue(forKey: rating.categoryKey)
            return
        }
        proposedCorrections[rating.categoryKey] =
            .init(intensity: intensity ?? rating.intensity, note: note)
    }
    /// Fills the wizard from a parsed screenshot import. ADDITIVE and
    /// non-destructive: anything the reader has already typed wins, because
    /// this can be run mid-wizard. Nothing here saves — the reader still walks
    /// the steps and confirms.
    func apply(_ imported: ImportedReview) {
        if overallRating == nil { overallRating = imported.overallRating }
        if mood == nil { mood = imported.mood }
        if plotPacing == nil { plotPacing = imported.plotPacing }
        if reviewText.isEmpty { reviewText = imported.reviewText ?? "" }
        for (key, value) in imported.dimensionRatings where dimensionRatings[key] == nil {
            dimensionRatings[key] = value
        }
        for (key, tags) in imported.dimensionTags {
            dimensionTags[key, default: []].formUnion(tags)
        }
        importedSource = imported.sourceLabel
    }
    /// Set once an import lands, so the steps can show where the values came
    /// from. The reader should never wonder why a chip is already selected.
    var importedSource: String?

    var isExisting = false
    var saving = false
    var loaded = false
    var error: String?

    var dimensions: [(key: String, label: String)] {
        isFiction == false ? NONFICTION_DIMENSIONS : FICTION_DIMENSIONS
    }

    init(bookId: String, isFiction: Bool?, ratings: [ContentRating], seedDnf: Bool = false) {
        self.bookId = bookId
        self.isFiction = isFiction
        self.ratings = ratings
        self.didNotFinish = seedDnf
    }

    func loadExisting() async {
        defer { loaded = true }
        struct Res: Codable { let ok: Bool; let review: ExistingReview? }
        guard let res: Res = try? await APIClient.shared.get("/api/v1/books/\(bookId)/review"),
              let r = res.review else { return }
        isExisting = true
        overallRating = r.overallRating
        didNotFinish = r.didNotFinish
        if let pct = r.dnfPercentComplete { dnfPercent = Double(pct) }
        mood = r.mood
        reviewText = r.reviewText ?? ""
        isAnonymous = r.isAnonymous
        contentComments = r.contentComments
        userAddedWarnings = ""
        plotPacing = r.plotPacing
        dimensionRatings = r.dimensionRatings
        dimensionTags = r.dimensionTags.mapValues(Set.init)
    }

    struct Correction: Codable, Sendable { let categoryKey: String; let intensity: Int; let note: String? }
    struct SavePayload: Codable, Sendable {
        let overallRating: Double?
        let didNotFinish: Bool
        let dnfPercentComplete: Int?
        let reviewText: String?
        let mood: String?
        let dimensionRatings: [String: Double]
        let dimensionTags: [String: [String]]
        let plotPacing: String?
        let contentComments: String?
        let isAnonymous: Bool
        let userAddedWarnings: [String]
        let proposedCorrections: [Correction]
    }

    func save() async -> Bool {
        saving = true; defer { saving = false }
        let warnings = userAddedWarnings.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let payload = SavePayload(
            overallRating: didNotFinish ? nil : overallRating,
            didNotFinish: didNotFinish,
            dnfPercentComplete: didNotFinish ? Int(dnfPercent) : nil,
            reviewText: reviewText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : reviewText,
            mood: mood,
            dimensionRatings: dimensionRatings,
            dimensionTags: dimensionTags.mapValues(Array.init),
            plotPacing: plotPacing,
            contentComments: contentComments.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : contentComments,
            isAnonymous: isAnonymous,
            userAddedWarnings: warnings,
            proposedCorrections: proposedCorrections.map {
                Correction(categoryKey: $0.key,
                           intensity: $0.value.intensity,
                           note: $0.value.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                 ? nil : $0.value.note)
            }
        )
        struct Ok: Codable { let ok: Bool; let saved: Bool }
        do {
            let _: Ok = try await APIClient.shared.request("/api/v1/books/\(bookId)/review", method: "PUT", json: payload)
            return true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't save your review."
            return false
        }
    }

    func delete() async -> Bool {
        struct Ok: Codable { let ok: Bool; let deleted: Bool }
        do {
            let _: Ok = try await APIClient.shared.request("/api/v1/books/\(bookId)/review", method: "DELETE")
            return true
        } catch {
            self.error = "Couldn't delete the review."
            return false
        }
    }
}

// ─── Quarter-step star control (rounded-star.tsx behavior) ───

struct QuarterStarControl: View {
    @Binding var rating: Double?
    var starSize: CGFloat = 36

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 6) {
                ForEach(0..<5, id: \.self) { i in
                    star(index: i)
                        .frame(width: starSize, height: starSize)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in update(x: value.location.x, width: geo.size.width) }
            )
        }
        .frame(width: starSize * 5 + 24, height: starSize)
    }

    private func update(x: CGFloat, width: CGFloat) {
        let raw = max(0.25, min(5, (x / width) * 5))
        rating = (raw * 4).rounded() / 4
    }

    private func star(index: Int) -> some View {
        let value = rating ?? 0
        let fill = max(0, min(1, value - Double(index)))
        return ZStack {
            // The empty star was Theme.surfaceAlt — #f0eff4 on the #f5f4f8
            // light background, i.e. all but invisible, so the control didn't
            // read as something you fill. A solid grey carries that on its
            // own; an outline on top just made the shape look doubled.
            Image(systemName: "star.fill")
                .resizable().scaledToFit()
                .foregroundStyle(Color(dark: "3d3d52", light: "cfced8"))
            Image(systemName: "star.fill")
                .resizable().scaledToFit()
                .foregroundStyle(Color(hex: "facc15"))  // yellow-400, like the web
                .mask(
                    GeometryReader { g in
                        Rectangle().frame(width: g.size.width * fill)
                    }
                )
        }
    }
}

// ─── The wizard sheet ───

struct ReviewWizardView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: ReviewWizardModel
    @State private var showDeleteConfirm = false
    @State private var showImport = false
    /// Live handle on the review text view, published by the editor so the
    /// toolbar can drive formatting commands.
    @State private var editorCommands: RichTextCommands?
    @State private var reviewCharCount = 0
    let onSaved: () -> Void
    /// Only used by the screenshot import, to strip the book's own name out of
    /// the "couldn't match these" list.
    private let bookTitle: String
    private let bookAuthors: [String]

    init(bookId: String, isFiction: Bool?, ratings: [ContentRating], seedDnf: Bool = false,
         bookTitle: String = "", bookAuthors: [String] = [],
         onSaved: @escaping () -> Void) {
        _model = State(initialValue: ReviewWizardModel(bookId: bookId, isFiction: isFiction, ratings: ratings, seedDnf: seedDnf))
        self.bookTitle = bookTitle
        self.bookAuthors = bookAuthors
        self.onSaved = onSaved
    }

    private let stepTitles = ["Overall", "Mood", "Details", "Review", "Content"]

    var body: some View {
        VStack(spacing: 0) {
            header
            progressDots
            if model.loaded {
                TabView(selection: Bindable(model).step) {
                    stepOverall.tag(0)
                    stepMood.tag(1)
                    stepDimensions.tag(2)
                    stepText.tag(3)
                    stepContent.tag(4)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            } else {
                Spacer()
                ProgressView().tint(Theme.accent)
                Spacer()
            }
            footer
        }
        .background(Theme.bg)
        .task {
            await model.loadExisting()
            #if DEBUG && targetEnvironment(simulator)
            if let s = ProcessInfo.processInfo.environment["TBRA_DEBUG_WIZARD_STEP"], let n = Int(s) {
                model.step = n
            }
            #endif
        }
        .alert("Error", isPresented: .constant(model.error != nil)) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .sheet(isPresented: $showImport) {
            ReviewImportSheet(
                model: ReviewImportModel(
                    bookId: model.bookId,
                    bookTitle: bookTitle,
                    authors: bookAuthors,
                    isFiction: model.isFiction ?? true
                ),
                onUse: { model.apply($0) }
            )
        }
        .confirmationDialog("Delete this review?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete review", role: .destructive) {
                Task { if await model.delete() { onSaved(); dismiss() } }
            }
        }
    }

    private var header: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
            Spacer()
            Text(model.isExisting ? "Edit Review" : "Review")
                .font(Theme.heading(17, .semibold))
                .foregroundStyle(Theme.foreground)
            Spacer()
            if model.isExisting {
                Button { showDeleteConfirm = true } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.destructive)
                }
            } else {
                Color.clear.frame(width: 20, height: 1)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    private var progressDots: some View {
        HStack(spacing: 6) {
            ForEach(0..<5, id: \.self) { i in
                Capsule()
                    .fill(i <= model.step ? Theme.accent : Theme.surfaceAlt)
                    .frame(width: i == model.step ? 22 : 8, height: 6)
                    .animation(.easeOut(duration: 0.15), value: model.step)
            }
        }
        .padding(.bottom, 8)
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if model.step > 0 {
                Button("Back") { withAnimation { model.step -= 1 } }
                    .font(Theme.body(16, .medium))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 20).padding(.vertical, 13)
                    .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
            }
            Button {
                if model.step < 4 {
                    withAnimation { model.step += 1 }
                } else {
                    Task { if await model.save() { onSaved(); dismiss() } }
                }
            } label: {
                HStack {
                    if model.saving { ProgressView().tint(.black) }
                    Text(model.step < 4 ? "Next" : (model.isExisting ? "Save Changes" : "Submit Review"))
                }
                .font(Theme.body(17, .bold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(Theme.accent, in: Capsule())
            }
            .disabled(model.saving)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    // ── Step 1: overall rating ──
    private var stepOverall: some View {
        ScrollView {
            VStack(spacing: 22) {
                Text("How was it overall?")
                    .font(Theme.heading(22, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 24)

                if !model.didNotFinish {
                    QuarterStarControl(rating: Bindable(model).overallRating, starSize: 44)
                    Text(model.overallRating.map { String(format: "%.2f", $0).replacingOccurrences(of: ".00", with: "") + " stars" } ?? "Drag across the stars")
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.muted)
                }

                Button {
                    withAnimation { model.didNotFinish.toggle() }
                    if model.didNotFinish { model.overallRating = nil }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: model.didNotFinish ? "checkmark.square.fill" : "square")
                            .foregroundStyle(model.didNotFinish ? Theme.accent : Theme.muted)
                        Text("I didn't finish this book")
                            .font(Theme.body(16, .medium))
                            .foregroundStyle(Theme.foreground)
                    }
                }
                .padding(.top, 6)

                if let source = model.importedSource {
                    Text("Filled in from your \(source) review — check it over.")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.accentText)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                } else if !model.isExisting {
                    // Only offered on a NEW review: re-importing over a review
                    // the reader already wrote would be a foot-gun.
                    Button { showImport = true } label: {
                        HStack(alignment: .top, spacing: 7) {
                            Image(systemName: "photo.on.rectangle.angled")
                                .font(Theme.body(14))
                            Text("Already reviewed this on another app? Tap here to import your review with a screenshot.")
                                .font(Theme.body(14, .medium))
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .foregroundStyle(Theme.neonBlue)
                        .padding(.horizontal, 26)
                    }
                    .padding(.top, 4)
                }

                if model.didNotFinish {
                    VStack(spacing: 8) {
                        Text("How far did you get? \(Int(model.dnfPercent))%")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                        Slider(value: Bindable(model).dnfPercent, in: 0...100, step: 5)
                            .tint(Theme.accent)
                            .padding(.horizontal, 30)
                    }
                }
            }
            .padding(.horizontal, 20)
        }
    }

    // ── Step 2: mood ──
    private var stepMood: some View {
        ScrollView {
            VStack(spacing: 18) {
                Text("How did it leave you feeling?")
                    .font(Theme.heading(22, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 24)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                    ForEach(REVIEW_MOODS) { m in
                        let selected = model.mood == m.key
                        Button {
                            model.mood = selected ? nil : m.key
                        } label: {
                            VStack(spacing: 5) {
                                Text(m.emoji).font(.system(size: 26))
                                Text(m.label)
                                    .font(Theme.body(12, .medium))
                                    .foregroundStyle(selected ? Theme.foreground : Theme.muted)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(selected ? Theme.accent.opacity(0.15) : Theme.surface.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12)
                                .stroke(selected ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: selected ? 1.5 : 1))
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    // ── Step 3: dimensions ──
    private var stepDimensions: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text("Rate the craft")
                    .font(Theme.heading(22, .bold))
                    .foregroundStyle(Theme.foreground)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 24)

                ForEach(model.dimensions, id: \.key) { dim in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(dim.label)
                                .font(Theme.body(17, .semibold))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                            if let r = model.dimensionRatings[dim.key] {
                                Text(String(format: "%.2f", r).replacingOccurrences(of: ".00", with: ""))
                                    .font(Theme.body(13, .medium))
                                    .foregroundStyle(Theme.accent)
                            }
                        }
                        QuarterStarControl(rating: Binding(
                            get: { model.dimensionRatings[dim.key] },
                            set: { model.dimensionRatings[dim.key] = $0 }
                        ), starSize: 28)

                        FlowLayout(spacing: 8) {
                            ForEach(DIMENSION_TAGS[dim.key] ?? [], id: \.self) { tag in
                                let selected = model.dimensionTags[dim.key]?.contains(tag) ?? false
                                Button {
                                    var set = model.dimensionTags[dim.key] ?? []
                                    if selected { set.remove(tag) } else { set.insert(tag) }
                                    model.dimensionTags[dim.key] = set
                                } label: {
                                    Text(tag)
                                        .font(Theme.body(12, .medium))
                                        .foregroundStyle(selected ? Theme.accentText : Theme.muted)
                                        .padding(.horizontal, 12).padding(.vertical, 6)
                                        .background(selected ? Theme.accent.opacity(0.12) : Theme.surfaceAlt.opacity(0.5), in: Capsule())
                                        .overlay(Capsule().stroke(selected ? Theme.accent.opacity(0.5) : Theme.border.opacity(0.6), lineWidth: 1))
                                }
                            }
                        }

                        if dim.key == "plot" {
                            HStack(spacing: 8) {
                                Text("Pacing:")
                                    .font(Theme.body(14))
                                    .foregroundStyle(Theme.muted)
                                ForEach(["slow", "medium", "fast"], id: \.self) { p in
                                    let selected = model.plotPacing == p
                                    Button {
                                        model.plotPacing = selected ? nil : p
                                    } label: {
                                        Text(p.capitalized)
                                            .font(Theme.body(13, .medium))
                                            .foregroundStyle(selected ? .black : Theme.muted)
                                            .padding(.horizontal, 14).padding(.vertical, 7)
                                            .background(selected ? Theme.accent : Theme.surfaceAlt.opacity(0.5), in: Capsule())
                                    }
                                }
                            }
                            .padding(.top, 2)
                        }
                    }
                    Divider().background(Theme.border.opacity(0.5))
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    // ── Step 4: review text ──
    // Mirrors the web step-review-text.tsx: same heading + framing copy, the
    // same formatting toolbar, spoiler tagging, and a 10,000-char ceiling.
    private var stepText: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text(model.didNotFinish ? "Why did you stop reading?" : "Share your thoughts")
                        .font(Theme.heading(22, .bold))
                        .foregroundStyle(Theme.foreground)
                        .multilineTextAlignment(.center)
                    Text("OPTIONAL")
                        .font(Theme.body(10, .medium))
                        .tracking(0.6)
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 20)

                Text(model.didNotFinish
                     ? "Help other readers understand what didn\u{2019}t work for you. Pacing? Content? Just not your thing? Your reasoning helps others decide."
                     : "Let other readers know how you felt about this book. What did you enjoy? What didn\u{2019}t you love? How did you feel when reading?")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)

                HStack(spacing: 5) {
                    Image(systemName: "eye.slash")
                        .font(.system(size: 11))
                    Text("Select text, then tap the eye to hide a spoiler.")
                        .font(Theme.body(11))
                }
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(Theme.surfaceAlt.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 10))

                VStack(spacing: 0) {
                    reviewToolbar
                    RichReviewTextView(
                        html: Bindable(model).reviewText,
                        placeholder: model.didNotFinish
                            ? "What made you put it down?"
                            : "Tap here and start typing.",
                        charCount: $reviewCharCount,
                        commandSink: { editorCommands = $0 }
                    )
                    .frame(minHeight: 220)
                }
                .background(Theme.surface.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))

                HStack {
                    Button {
                        model.isAnonymous.toggle()
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: model.isAnonymous ? "checkmark.square.fill" : "square")
                                .foregroundStyle(model.isAnonymous ? Theme.accent : Theme.muted)
                            Text("Post anonymously")
                                .font(Theme.body(15, .medium))
                                .foregroundStyle(Theme.foreground)
                        }
                    }
                    Spacer()
                    Text("\(reviewCharCount) / \(reviewCharLimit)")
                        .font(Theme.body(12))
                        .foregroundStyle(reviewCharCount > Int(Double(reviewCharLimit) * 0.9)
                                         ? Theme.destructive : Theme.muted)
                }
            }
            .padding(.horizontal, 20)
        }
    }


    /// One What's Inside category: current intensity, the 5 proposal chips,
    /// and (once a different level is picked) the rationale that ships to the
    /// admin queue. Extracted from stepContent because the inlined version
    /// blew the Swift type-checker's time budget.
    @ViewBuilder
    private func contentRatingCard(_ rating: ContentRating) -> some View {
        let proposed = model.proposedCorrections[rating.categoryKey]?.intensity
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(rating.categoryName)
                                .font(Theme.body(15, .semibold))
                                .foregroundStyle(Theme.foreground)
                            Spacer()
                            Text(intensityLabel(rating.intensity))
                                .font(Theme.body(12, .medium))
                                .foregroundStyle(intensityColor(rating.intensity))
                        }
                        HStack(spacing: 6) {
                            ForEach(0..<5, id: \.self) { level in
                                let isCurrent = level == rating.intensity && proposed == nil
                                let isProposed = proposed == level
                                Button {
                                    let note = model.proposedCorrections[rating.categoryKey]?.note
                                        ?? rating.notes ?? ""
                                    model.setProposal(for: rating, intensity: isProposed ? nil : level, note: note)
                                } label: {
                                    Text(intensityLabel(level))
                                        .font(Theme.body(11, .medium))
                                        .foregroundStyle(isProposed ? .black : (isCurrent ? Theme.foreground : Theme.muted))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 7)
                                        .background(isProposed ? Theme.accent : (isCurrent ? Theme.surfaceAlt : Theme.surfaceAlt.opacity(0.35)), in: Capsule())
                                }
                            }
                        }

                        // The editable copy for this category, seeded with
                        // what the book says now — tweaking existing wording
                        // beats writing from scratch. On accept the admin
                        // apply route writes this into
                        // book_category_ratings.notes, so it IS the public
                        // note, not a private rationale.
                        VStack(alignment: .leading, spacing: 5) {
                            Text("CONTENT NOTE")
                                .font(Theme.body(10, .semibold))
                                .tracking(0.6)
                                .foregroundStyle(Theme.muted)
                            TextField(
                                "Describe what\u{2019}s in the book for this category.",
                                text: Binding(
                                    get: {
                                        model.proposedCorrections[rating.categoryKey]?.note
                                            ?? rating.notes ?? ""
                                    },
                                    set: { newValue in
                                        model.setProposal(
                                            for: rating,
                                            intensity: model.proposedCorrections[rating.categoryKey]?.intensity,
                                            note: newValue
                                        )
                                    }
                                ),
                                axis: .vertical
                            )
                            .lineLimit(3...6)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.foreground)
                            .padding(10)
                            .background(Theme.bg.opacity(0.5))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))

                            if model.proposedCorrections[rating.categoryKey] != nil {
                                Button("Discard my changes") {
                                    model.proposedCorrections.removeValue(forKey: rating.categoryKey)
                                }
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.muted)
                            }
                        }
                        .padding(.top, 4)
                    }
                    .padding(12)
                    .background(Theme.surface.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(
                        proposed != nil ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1))
    }

    private var reviewCharLimit: Int { 10_000 }

    private var reviewToolbar: some View {
        HStack(spacing: 2) {
            toolbarButton("bold", label: "Bold") { editorCommands?.toggleTrait(.traitBold) }
            toolbarButton("italic", label: "Italic") { editorCommands?.toggleTrait(.traitItalic) }
            toolbarButton("underline", label: "Underline") { editorCommands?.toggleUnderline() }
            Divider().frame(height: 18).padding(.horizontal, 4)
            toolbarButton("list.bullet", label: "Bullet list") { editorCommands?.toggleBulletList() }
            Divider().frame(height: 18).padding(.horizontal, 4)
            toolbarButton("eye.slash", label: "Spoiler") { editorCommands?.toggleSpoiler() }
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Theme.surfaceAlt.opacity(0.5))
        .overlay(alignment: .bottom) { Divider() }
    }

    private func toolbarButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.foreground)
                .frame(width: 32, height: 28)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }

    // ── Step 5: content details ──
    private var stepContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("What's inside — anything off?")
                    .font(Theme.heading(22, .bold))
                    .foregroundStyle(Theme.foreground)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 24)
                Text("Propose a different intensity or edit the note for any category. Suggestions go to the admin review queue — they don't change the book immediately.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)

                ForEach(model.ratings) { rating in
                    contentRatingCard(rating)
                }

                Text("Add a trigger warning others should know about (one per line)")
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.foreground.opacity(0.85))
                TextEditor(text: Bindable(model).userAddedWarnings)
                    .scrollContentBackground(.hidden)
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.foreground)
                    .frame(minHeight: 60)
                    .padding(10)
                    .background(Theme.surface.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))

                Text("Anything else about the content? (private note to admins)")
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.foreground.opacity(0.85))
                TextEditor(text: Bindable(model).contentComments)
                    .scrollContentBackground(.hidden)
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.foreground)
                    .frame(minHeight: 60)
                    .padding(10)
                    .background(Theme.surface.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
    }

    private func intensityLabel(_ level: Int) -> String {
        ["None", "Mild", "Moderate", "Significant", "Extreme"][max(0, min(4, level))]
    }

    private func intensityColor(_ level: Int) -> Color {
        switch level {
        case 1: return Theme.neonBlue
        case 2: return .yellow
        case 3: return .orange
        case 4: return Theme.destructive
        default: return Theme.muted
        }
    }
}
