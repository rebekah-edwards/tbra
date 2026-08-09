//
//  ReviewEditor.swift
//  Rich-text review editor — parity with the web review wizard's
//  step-review-text.tsx (bold / italic / underline / bullets / spoilers).
//
//  Reviews are stored as sanitized HTML (the subset in src/lib/sanitize.ts:
//  p/br/div/b/i/strong/em/u/s/span/ul/ol/li/blockquote/a). Before this the
//  native wizard posted a bare String, so anything a reader typed on iOS
//  arrived unformatted and had no way to hide spoilers — the web reader saw
//  a wall of plain text next to formatted web reviews.
//
//  Round-tripping reuses ReviewHTML.parse (ReviewsListView.swift) so the
//  editor and the reader agree on exactly one HTML dialect.
//

import SwiftUI
import UIKit

// Marks a run as spoiler text. UIKit ignores unknown attribute keys, so this
// rides along on the attributed string and is read back at serialization.
extension NSAttributedString.Key {
    static let tbraSpoiler = NSAttributedString.Key("tbraSpoiler")
}

enum ReviewMarkup {
    /// Attributed string → the sanitizer's HTML subset.
    ///
    /// Paragraphs: a blank line starts a new <p>; single newlines are <br>.
    /// Lines beginning with the bullet marker collect into one <ul>.
    static func toHTML(_ attributed: NSAttributedString) -> String {
        let full = attributed.string as NSString
        var blocks: [String] = []
        var listBuffer: [String] = []

        func flushList() {
            guard !listBuffer.isEmpty else { return }
            blocks.append("<ul>" + listBuffer.map { "<li>\($0)</li>" }.joined() + "</ul>")
            listBuffer = []
        }

        // Split into paragraphs on blank lines, preserving single breaks.
        var paragraph: [String] = []
        func flushParagraph() {
            let joined = paragraph.joined(separator: "<br>")
            paragraph = []
            let stripped = joined.replacingOccurrences(of: "<br>", with: "")
            guard !stripped.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            blocks.append("<p>\(joined)</p>")
        }

        var lineStart = 0
        while lineStart <= full.length {
            let lineRange = full.lineRange(for: NSRange(location: min(lineStart, full.length), length: 0))
            let raw = full.substring(with: lineRange)
            let contentLength = raw.hasSuffix("\n") ? lineRange.length - 1 : lineRange.length
            let contentRange = NSRange(location: lineRange.location, length: max(0, contentLength))
            let plain = full.substring(with: contentRange)

            if plain.hasPrefix(bulletMarker) {
                flushParagraph()
                let after = NSRange(location: contentRange.location + (bulletMarker as NSString).length,
                                    length: max(0, contentRange.length - (bulletMarker as NSString).length))
                listBuffer.append(inlineHTML(attributed, range: after))
            } else if plain.trimmingCharacters(in: .whitespaces).isEmpty {
                flushList()
                flushParagraph()
            } else {
                flushList()
                paragraph.append(inlineHTML(attributed, range: contentRange))
            }

            if lineRange.length == 0 { break }
            lineStart = lineRange.location + lineRange.length
            if lineStart >= full.length { break }
        }
        flushList()
        flushParagraph()

        return blocks.joined()
    }

    /// One line's runs → inline HTML, innermost-first so tags nest correctly.
    private static func inlineHTML(_ attributed: NSAttributedString, range: NSRange) -> String {
        guard range.length > 0 else { return "" }
        var out = ""
        attributed.enumerateAttributes(in: range, options: []) { attrs, runRange, _ in
            let text = (attributed.string as NSString).substring(with: runRange)
            guard !text.isEmpty else { return }
            var html = escape(text)

            let traits = (attrs[.font] as? UIFont)?.fontDescriptor.symbolicTraits ?? []
            if traits.contains(.traitBold) { html = "<strong>\(html)</strong>" }
            if traits.contains(.traitItalic) { html = "<em>\(html)</em>" }
            if let style = attrs[.underlineStyle] as? Int, style != 0 { html = "<u>\(html)</u>" }
            if attrs[.tbraSpoiler] != nil {
                html = "<span class=\"spoiler-tag\" data-spoiler=\"true\">\(html)</span>"
            }
            out += html
        }
        return out
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    /// Stored HTML → attributed string, for editing an existing review.
    /// Reuses the reader's parser so both sides read the same dialect.
    static func toAttributed(_ html: String, baseFont: UIFont, color: UIColor) -> NSMutableAttributedString {
        let result = NSMutableAttributedString()
        for segment in ReviewHTML.parse(html) {
            var attrs: [NSAttributedString.Key: Any] = [
                .font: font(baseFont, bold: segment.bold, italic: segment.italic),
                .foregroundColor: color,
            ]
            if segment.underline { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
            if segment.strike { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if segment.spoilerIndex != nil {
                attrs[.tbraSpoiler] = true
                attrs[.backgroundColor] = UIColor.systemGray.withAlphaComponent(0.35)
            }
            result.append(NSAttributedString(string: segment.text, attributes: attrs))
        }
        return result
    }

    static let bulletMarker = "•  "

    static func font(_ base: UIFont, bold: Bool, italic: Bool) -> UIFont {
        var traits: UIFontDescriptor.SymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        guard let descriptor = base.fontDescriptor.withSymbolicTraits(traits) else { return base }
        return UIFont(descriptor: descriptor, size: base.pointSize)
    }
}

/// UITextView wrapper that keeps an HTML binding in sync and exposes the
/// formatting commands the toolbar drives.
struct RichReviewTextView: UIViewRepresentable {
    @Binding var html: String
    var placeholder: String
    @Binding var charCount: Int
    /// Set by the view so the toolbar can call into the live text view.
    var commandSink: (RichTextCommands) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = Self.baseFont
        view.textColor = Self.textColor
        view.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        view.autocorrectionType = .yes
        view.allowsEditingTextAttributes = true

        if !html.isEmpty {
            view.attributedText = ReviewMarkup.toAttributed(html, baseFont: Self.baseFont, color: Self.textColor)
        }
        view.typingAttributes = [.font: Self.baseFont, .foregroundColor: Self.textColor]

        context.coordinator.textView = view
        context.coordinator.placeholderLabel = Self.attachPlaceholder(to: view, text: placeholder)
        context.coordinator.syncPlaceholder()
        // Seed the counter from the loaded review — it otherwise sat at 0
        // until the first keystroke when editing an existing review.
        if !view.text.isEmpty {
            let initial = view.text.count
            DispatchQueue.main.async { charCount = initial }
        }
        commandSink(RichTextCommands(coordinator: context.coordinator))
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.placeholderLabel?.text = placeholder
        context.coordinator.syncPlaceholder()
    }

    static let baseFont = UIFont.systemFont(ofSize: 16)
    static var textColor: UIColor { UIColor.label }

    private static func attachPlaceholder(to view: UITextView, text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = baseFont
        label.textColor = .secondaryLabel
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: view.topAnchor, constant: 12),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 13),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -13),
        ])
        return label
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: RichReviewTextView
        weak var textView: UITextView?
        var placeholderLabel: UILabel?

        init(_ parent: RichReviewTextView) { self.parent = parent }

        func textViewDidChange(_ textView: UITextView) { push(textView) }

        func textViewDidChangeSelection(_ textView: UITextView) {
            // A collapsed caret inherits the run it sits in, so typing
            // continues the surrounding format rather than resetting to plain.
            guard textView.selectedRange.length == 0, textView.selectedRange.location > 0 else { return }
            let probe = textView.selectedRange.location - 1
            guard probe < textView.attributedText.length else { return }
            var attrs = textView.attributedText.attributes(at: probe, effectiveRange: nil)
            attrs[.foregroundColor] = RichReviewTextView.textColor
            textView.typingAttributes = attrs
        }

        func push(_ textView: UITextView) {
            parent.html = ReviewMarkup.toHTML(textView.attributedText)
            parent.charCount = textView.text.count
            syncPlaceholder()
        }

        func syncPlaceholder() {
            placeholderLabel?.isHidden = !(textView?.text.isEmpty ?? true)
        }
    }
}

/// Formatting commands the toolbar invokes on the live text view.
/// @MainActor because every member touches UIKit state — leaving it
/// nonisolated produced the same "main actor-isolated property referenced
/// from a nonisolated context" warnings that preceded the chromeCircle
/// crash, and UIKit mutation off the main thread is a real trap.
@MainActor
struct RichTextCommands {
    let coordinator: RichReviewTextView.Coordinator

    private var textView: UITextView? { coordinator.textView }

    /// Toggles a symbolic trait (bold/italic) across the selection, or arms it
    /// for the next keystroke when nothing is selected.
    func toggleTrait(_ trait: UIFontDescriptor.SymbolicTraits) {
        guard let view = textView else { return }
        let range = view.selectedRange

        if range.length == 0 {
            var attrs = view.typingAttributes
            let current = (attrs[.font] as? UIFont) ?? RichReviewTextView.baseFont
            attrs[.font] = flip(current, trait: trait)
            view.typingAttributes = attrs
            return
        }

        let mutable = NSMutableAttributedString(attributedString: view.attributedText)
        // Turn the whole selection ON unless every character already has it.
        let allSet = allCharacters(in: mutable, range: range) { attrs in
            ((attrs[.font] as? UIFont)?.fontDescriptor.symbolicTraits ?? []).contains(trait)
        }
        mutable.enumerateAttribute(.font, in: range, options: []) { value, subRange, _ in
            let font = (value as? UIFont) ?? RichReviewTextView.baseFont
            var traits = font.fontDescriptor.symbolicTraits
            if allSet { traits.remove(trait) } else { traits.insert(trait) }
            let descriptor = font.fontDescriptor.withSymbolicTraits(traits) ?? font.fontDescriptor
            mutable.addAttribute(.font, value: UIFont(descriptor: descriptor, size: font.pointSize), range: subRange)
        }
        apply(mutable, to: view, restoring: range)
    }

    func toggleUnderline() {
        guard let view = textView else { return }
        let range = view.selectedRange

        if range.length == 0 {
            var attrs = view.typingAttributes
            let on = (attrs[.underlineStyle] as? Int ?? 0) != 0
            attrs[.underlineStyle] = on ? 0 : NSUnderlineStyle.single.rawValue
            view.typingAttributes = attrs
            return
        }

        let mutable = NSMutableAttributedString(attributedString: view.attributedText)
        let allSet = allCharacters(in: mutable, range: range) { ($0[.underlineStyle] as? Int ?? 0) != 0 }
        if allSet {
            mutable.removeAttribute(.underlineStyle, range: range)
        } else {
            mutable.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
        }
        apply(mutable, to: view, restoring: range)
    }

    /// Mirrors the web spoiler button: needs a selection, and toggles off when
    /// the selection is already hidden.
    func toggleSpoiler() {
        guard let view = textView else { return }
        let range = view.selectedRange
        guard range.length > 0 else { return }

        let mutable = NSMutableAttributedString(attributedString: view.attributedText)
        let allSet = allCharacters(in: mutable, range: range) { $0[.tbraSpoiler] != nil }
        if allSet {
            mutable.removeAttribute(.tbraSpoiler, range: range)
            mutable.removeAttribute(.backgroundColor, range: range)
        } else {
            mutable.addAttribute(.tbraSpoiler, value: true, range: range)
            mutable.addAttribute(.backgroundColor, value: UIColor.systemGray.withAlphaComponent(0.35), range: range)
        }
        apply(mutable, to: view, restoring: range)
    }

    /// Adds or strips the bullet marker on every line the selection touches.
    func toggleBulletList() {
        guard let view = textView else { return }
        let text = view.attributedText.string as NSString
        let lineRange = text.lineRange(for: view.selectedRange)
        let mutable = NSMutableAttributedString(attributedString: view.attributedText)

        var lines: [String] = []
        text.substring(with: lineRange).enumerateLines { line, _ in lines.append(line) }
        if lines.isEmpty { lines = [""] }

        let marker = ReviewMarkup.bulletMarker
        let allBulleted = lines.allSatisfy { $0.hasPrefix(marker) }
        let rebuilt = lines
            .map { allBulleted ? String($0.dropFirst(marker.count)) : marker + $0 }
            .joined(separator: "\n")

        let attrs: [NSAttributedString.Key: Any] = [
            .font: RichReviewTextView.baseFont,
            .foregroundColor: RichReviewTextView.textColor,
        ]
        let trailingNewline = text.substring(with: lineRange).hasSuffix("\n") ? "\n" : ""
        mutable.replaceCharacters(in: lineRange,
                                  with: NSAttributedString(string: rebuilt + trailingNewline, attributes: attrs))

        let caret = NSRange(location: min(lineRange.location + (rebuilt as NSString).length, mutable.length), length: 0)
        apply(mutable, to: view, restoring: caret)
    }

    /// True only when every character in the range satisfies the predicate —
    /// a partly-formatted selection reads as OFF so the button turns it all on.
    private func allCharacters(
        in string: NSAttributedString,
        range: NSRange,
        where predicate: ([NSAttributedString.Key: Any]) -> Bool
    ) -> Bool {
        var all = true
        string.enumerateAttributes(in: range, options: []) { attrs, _, stop in
            if !predicate(attrs) { all = false; stop.pointee = true }
        }
        return all
    }

    private func apply(_ text: NSAttributedString, to view: UITextView, restoring range: NSRange) {
        let typing = view.typingAttributes
        view.attributedText = text
        view.selectedRange = NSRange(location: min(range.location, text.length),
                                     length: min(range.length, text.length - min(range.location, text.length)))
        view.typingAttributes = typing
        coordinator.push(view)
    }

    private func flip(_ font: UIFont, trait: UIFontDescriptor.SymbolicTraits) -> UIFont {
        var traits = font.fontDescriptor.symbolicTraits
        if traits.contains(trait) { traits.remove(trait) } else { traits.insert(trait) }
        guard let descriptor = font.fontDescriptor.withSymbolicTraits(traits) else { return font }
        return UIFont(descriptor: descriptor, size: font.pointSize)
    }
}
