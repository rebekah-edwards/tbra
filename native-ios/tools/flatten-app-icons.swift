// Flatten app-icon PNGs so they carry no alpha channel. See the note at the
// bottom for why this exists — it stalled builds 8-11 in Processing.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Flatten an icon PNG: composite onto an opaque background and write with NO
// alpha channel. Apple rejects an App Store icon that has one, but only
// during processing, by email — so this must be fixed at the source .png.
func flatten(_ path: String) {
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        print("  ✗ could not read \(path)"); return
    }
    let w = img.width, h = img.height

    // Sample the corner to pick a background — these icons are a mark on a
    // solid field, so the corner IS the field colour.
    var bg = (r: 1.0, g: 1.0, b: 1.0)
    if let data = img.dataProvider?.data, let ptr = CFDataGetBytePtr(data) {
        let bpp = img.bitsPerPixel / 8
        if bpp >= 3 {
            let alphaInfo = img.alphaInfo
            let premultiplied = alphaInfo == .premultipliedFirst || alphaInfo == .premultipliedLast
            let off = (alphaInfo == .first || alphaInfo == .premultipliedFirst) ? 1 : 0
            let a = bpp == 4 ? Double(ptr[(alphaInfo == .first || alphaInfo == .premultipliedFirst) ? 0 : 3]) / 255.0 : 1.0
            var r = Double(ptr[off]) / 255.0, g = Double(ptr[off+1]) / 255.0, b = Double(ptr[off+2]) / 255.0
            if premultiplied && a > 0 { r /= a; g /= a; b /= a }
            if a > 0.9 { bg = (r, g, b) }
        }
    }

    let cs = CGColorSpaceCreateDeviceRGB()
    // noneSkipLast => 32bpp with the alpha byte IGNORED, i.e. opaque output.
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
        print("  ✗ context failed for \(path)"); return
    }
    ctx.setFillColor(red: bg.r, green: bg.g, blue: bg.b, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))

    guard let out = ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        print("  ✗ write failed for \(path)"); return
    }
    CGImageDestinationAddImage(dest, out, nil)
    CGImageDestinationFinalize(dest)
    print("  ✓ flattened \((path as NSString).lastPathComponent) (bg r\(String(format: "%.2f", bg.r)) g\(String(format: "%.2f", bg.g)) b\(String(format: "%.2f", bg.b)))")
}

for arg in CommandLine.arguments.dropFirst() { flatten(arg) }

// Run after replacing any app icon:
//   swift native-ios/tools/flatten-app-icons.swift native-ios/Assets.xcassets/AppIcon.appiconset/*.png
//
// Apple rejects an App Store icon carrying an alpha channel, but ONLY during
// processing and ONLY by email — the API shows the build stuck in
// "Processing" with no error. actool strips alpha from the small device
// icons, so the built .app looks fine and nothing catches it downstream.
// preflight-archive.sh checks the SOURCE pngs for exactly this reason.
