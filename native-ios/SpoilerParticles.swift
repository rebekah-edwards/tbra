import SwiftUI

// Native port of the web's spoiler sparkle
// (src/components/review/spoiler-particles.tsx).
//
// The web draws a <canvas> of independently twinkling particles over every
// unrevealed `.spoiler-tag`, using getClientRects() so a spoiler that wraps
// across lines gets one rect per line. iOS previously rendered only the chip
// — transparent text on a surface-alt block — so the text greyed out with no
// sparkle at all.
//
// The equivalent here is a custom TextRenderer: it hands us each layout run's
// typographic bounds, which is the same per-line-fragment geometry
// getClientRects() gives the web.
//
// Every constant below is taken from the web implementation, not re-tuned:
//   DENSITY 0.025 particles/px²   SPEED 0.35 px/frame   PAD 2px
//   size    0.4 + rand*0.7        opacity 0.2 + rand*0.5
//   flicker sin(t*speed + phase) * 0.3 + 0.7, speed 2 + rand*4
//   colour  white on dark, black on light
//
// One deliberate difference in MECHANISM (not appearance): the web mutates
// particle positions each frame and reflects them off the rect edges. A
// TextRenderer redraws from scratch every frame and holds no state, so the
// same motion is reproduced analytically — constant-velocity travel reflected
// inside a box IS a triangle wave, so `bounce()` below gives pixel-equivalent
// paths without needing to keep state between frames.

/// Marks the runs the renderer should sparkle over.
struct SpoilerAttribute: TextAttribute {}

struct SpoilerParticleRenderer: TextRenderer {
    /// Seconds; drives both motion and flicker.
    var time: Double
    var dark: Bool

    // Web constants.
    private let density: Double = 0.025
    private let speed: Double = 0.35
    private let pad: Double = 2

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            for run in line {
                // Draw the text itself exactly as SwiftUI would; the chip
                // background and transparent fill still come from the
                // AttributedString attributes.
                context.draw(run)

                guard run[SpoilerAttribute.self] != nil else { continue }
                let r = run.typographicBounds.rect
                let box = CGRect(x: r.minX - pad, y: r.minY - pad,
                                 width: r.width + pad * 2, height: r.height + pad * 2)
                guard box.width > 1, box.height > 1 else { continue }
                drawParticles(in: box, context: &context)
            }
        }
    }

    private func drawParticles(in box: CGRect, context: inout GraphicsContext) {
        let count = Int(box.width * box.height * density)
        guard count > 0 else { return }

        // Seed from the run's own geometry so a given spoiler keeps the same
        // particle field frame to frame (and across scrolls), the way the web
        // keeps its particle array per element.
        var rng = SeededRNG(seed: UInt64(abs(Int(box.minX * 31 + box.minY * 131 + box.width * 7))) &+ 1)
        let colour = dark ? Color.white : Color.black

        for _ in 0..<count {
            let x0 = rng.next() * box.width
            let y0 = rng.next() * box.height
            let vx = (rng.next() - 0.5) * speed * 2 * 60   // px/sec (web: per 60fps frame)
            let vy = (rng.next() - 0.5) * speed * 2 * 60
            let size = 0.4 + rng.next() * 0.7
            let baseOpacity = 0.2 + rng.next() * 0.5
            let flickerSpeed = 2 + rng.next() * 4
            let flickerPhase = rng.next() * .pi * 2

            let x = box.minX + bounce(x0 + vx * time, box.width)
            let y = box.minY + bounce(y0 + vy * time, box.height)

            let flicker = sin(time * flickerSpeed + flickerPhase) * 0.3 + 0.7
            let alpha = baseOpacity * flicker
            guard alpha > 0.01 else { continue }

            context.fill(
                Path(ellipseIn: CGRect(x: x - size, y: y - size,
                                       width: size * 2, height: size * 2)),
                with: .color(colour.opacity(alpha))
            )
        }
    }

    /// Reflects a freely-travelling coordinate back and forth inside [0, span]
    /// — the closed form of the web's per-frame edge bounce.
    private func bounce(_ value: Double, _ span: Double) -> Double {
        guard span > 0 else { return 0 }
        let period = span * 2
        var t = value.truncatingRemainder(dividingBy: period)
        if t < 0 { t += period }
        return t <= span ? t : period - t
    }
}

/// Tiny deterministic RNG so a spoiler's particle field is stable between
/// frames. Same generator shape as any LCG; values in 0..<1.
private struct SeededRNG {
    var state: UInt64
    init(seed: UInt64) { state = seed == 0 ? 0x9E3779B9 : seed }
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double((state >> 11) & 0x1F_FFFF_FFFF_FFFF) / Double(0x20_0000_0000_0000)
    }
}
