// pigeon-eye — how a picture Pigeon sees the window it plays (docs/PLAY-LOOP.md).
//
// Pigeon starts this as a sidecar. It watches ONE window through
// ScreenCaptureKit — the only capture macOS 15 and later allow — keeping its
// last second or two, and when asked, writes the frame to show the Pigeon:
// the same shape it was trained on (the same number of frames side by side,
// the same gap, the same size cap; its actions.json says which). It presses
// nothing and listens to nothing: pressing keys is Pigeon's own (play.rs), in
// Pigeon's own process, where macOS attaches the permission.
//
// Built from Flight School's recorder (recorder/Recorder.swift), which made
// the frames this Pigeon learned from, so the two make pictures the same way.
//
// Subcommands, all printing JSON lines on stdout:
//   windows                      the windows that could be watched
//   watch  --window ID [shape]   watch; stdin lines {"cmd":"frame","out":PATH} | {"cmd":"stop"}
//   replay --dir DIR  [shape]    the same, from a folder of frames (tests; no permission)
//   activate --window PID        bring that app to the front (for the key test)
//   ocr                          the text in the image on stdin (Apple's Vision), as JSON
//   compose --out PATH [--crop x,y,w,h] FRAME…
//                                these frame files, oldest first, cut, stacked and written
//                                exactly as `watch` does it (tests; pigeon-engine is held to it)
//   selftest                     the frame-choosing and stacking code on drawn frames
// shape: --stack N --gap-ms G --max-side M [--crop x,y,w,h] [--whole 1]
//   --whole 1: capture at the same size, but keep whole frames and cut nothing;
//   stdin {"cmd":"frames","out":[PATH…]} writes the frames a picture is made of,
//   oldest first, as PNG, for pigeon-engine to cut and stack (E12)

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import AppKit
import ScreenCaptureKit
import Vision
import CoreMedia
import CoreImage

let out = FileHandle.standardOutput
let outLock = NSLock()
func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) else { return }
    outLock.lock(); defer { outLock.unlock() }
    out.write(data); out.write("\n".data(using: .utf8)!)
}
func nowMs() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }

struct Shape {
    var window: UInt32 = 0, dir = "", stack = 1, gapMs = 0.0, maxSide = 0
    var crop: Crop?
    /// Frames are handed over whole, for the engine to cut (E12).
    var whole = false
    /// What could not be followed. Never guessed past (spec §13.2, D66): a
    /// stack, a size or a crop this was not given exactly is not replaced by a
    /// default, a clamp or the whole window — `watch` and `replay` refuse.
    var bad: String?
    init(_ args: ArraySlice<String>) {
        var it = args.makeIterator()
        var gapGiven = false
        while let k = it.next() {
            let v = it.next() ?? ""
            switch k {
            case "--window": window = UInt32(v) ?? 0
            case "--dir": dir = v
            case "--stack":
                if let n = Int(v), (1...4).contains(n) { stack = n } else { bad = "--stack \(v) is not a whole number from 1 to 4" }
            case "--gap-ms":
                if let g = Double(v), g >= 0 { gapMs = g; gapGiven = true } else { bad = "--gap-ms \(v) is not a time" }
            case "--max-side":
                if let n = Int(v), n >= 64 { maxSide = n } else { bad = "--max-side \(v) is not a whole number of at least 64" }
            case "--crop":
                if let c = Crop(v) { crop = c } else { bad = "--crop \(v) is not a part of the window" }
            case "--whole": whole = v == "1"
            default: break
            }
        }
        if bad == nil && maxSide == 0 { bad = "no --max-side" }
        if bad == nil && stack > 1 && !gapGiven { bad = "--stack \(stack) needs --gap-ms" }
    }
    /// For `watch` and `replay`: say what cannot be followed, and stop.
    func orRefuse() -> Shape {
        if let bad { emit(["type": "error", "code": "bad-shape", "message": bad]); exit(2) }
        return self
    }
}

// MARK: - the part of the window kept

/// The part of the window the Pigeon learned from, as fractions of the window
/// from its top left — actions.json `frames.crop`, "x,y,w,h" here. The same
/// code as Flight School's recorder, so both cut the same part away.
struct Crop {
    let x, y, w, h: Double
    /// Four numbers, trimmed to the window as the recorder does (format §13.2
    /// step 0, D70): x and y moved into 0 to 1, w and h cut to fit. Nothing
    /// when, trimmed, it keeps 1% or less either way — in plain double
    /// arithmetic, no tolerance, as the recorder decided what it kept (D75).
    init?(_ s: String) {
        let parts = s.split(separator: ",", omittingEmptySubsequences: false)
        let v = parts.compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count == 4, v.count == 4 else { return nil }
        x = min(max(v[0], 0), 1); y = min(max(v[1], 0), 1)
        w = min(v[2], 1 - x); h = min(v[3], 1 - y)
        guard w > 0.01, h > 0.01 else { return nil }
    }
    func rect(_ W: Int, _ H: Int) -> CGRect {
        CGRect(x: (x * Double(W)).rounded(), y: (y * Double(H)).rounded(),
               width: (w * Double(W)).rounded(), height: (h * Double(H)).rounded())
            .intersection(CGRect(x: 0, y: 0, width: W, height: H))
    }
}

/// The kept part of a frame, or nothing — never the whole frame in its
/// place (§13.2): `watch` refuses a crop that keeps under a pixel before
/// capture starts, so nothing here is reached for one.
func cropped(_ img: CGImage, _ c: Crop?) -> CGImage? {
    guard let c else { return img }
    let r = c.rect(img.width, img.height)
    guard r.width >= 1, r.height >= 1 else { return nil }
    return img.cropping(to: r)
}

/// How big to capture a window of `w` × `h` pixels so that the kept part's
/// longer side is at most `maxSide` — never larger than the window really is.
func captureSize(_ w: Double, _ h: Double, maxSide: Int, crop: Crop?) -> (Double, Double) {
    let kw = w * (crop?.w ?? 1), kh = h * (crop?.h ?? 1)
    let k = min(1, Double(maxSide) / max(kw, kh))
    return ((w * k).rounded(), (h * k).rounded())
}

// MARK: - frames

final class Ring {
    private var frames: [(t: Double, image: CGImage)] = []
    private let lock = NSLock()
    let keepMs: Double
    init(keepMs: Double) { self.keepMs = keepMs }
    func add(_ image: CGImage, at t: Double) {
        lock.lock(); defer { lock.unlock() }
        frames.append((t, image))
        while let first = frames.first, t - first.t > keepMs, frames.count > 1 { frames.removeFirst() }
    }
    func before(_ t: Double) -> (t: Double, image: CGImage)? {
        lock.lock(); defer { lock.unlock() }
        return frames.last(where: { $0.t <= t }) ?? frames.first
    }
}

/// The picture to show: `n` frames ending now, `gapMs` apart, side by side,
/// oldest on the left, 4 px between — exactly as the recorder stacked them.
func stacked(_ ring: Ring, n: Int, gapMs: Double) -> CGImage? {
    chosen(ring, n: n, gapMs: gapMs).flatMap(sideBySide)
}

/// The `n` frames a picture is made of, oldest first: the newest, and each
/// earlier one `gapMs` before the next.
func chosen(_ ring: Ring, n: Int, gapMs: Double) -> [CGImage]? {
    guard let last = ring.before(nowMs()) else { return nil }
    if n <= 1 { return [last.image] }
    var parts: [CGImage] = []
    for i in stride(from: n - 1, through: 1, by: -1) { if let f = ring.before(last.t - Double(i) * gapMs) { parts.append(f.image) } }
    parts.append(last.image)
    return parts
}

/// Lossless, for the engine to cut and stack exactly as `stacked` would.
func writePNG(_ image: CGImage, to url: URL) -> Bool {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return false }
    CGImageDestinationAddImage(dest, image, nil)
    return CGImageDestinationFinalize(dest)
}

/// Frames side by side, oldest on the left, 4 px of black between, each at
/// the newest one's height. One frame is itself.
func sideBySide(_ parts: [CGImage]) -> CGImage? {
    guard let last = parts.last else { return nil }
    if parts.count == 1 { return last }
    let h = last.height
    let widths = parts.map { Int((Double($0.width) * Double(h) / Double($0.height)).rounded()) }
    let w = widths.reduce(0, +) + 4 * (parts.count - 1)
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.setFillColor(CGColor(gray: 0, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    var x = 0
    for (p, pw) in zip(parts, widths) { ctx.draw(p, in: CGRect(x: x, y: 0, width: pw, height: h)); x += pw + 4 }
    return ctx.makeImage()
}

func writeJPEG(_ image: CGImage, to url: URL) -> Bool {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return false }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    return CGImageDestinationFinalize(dest)
}

func scaled(_ img: CGImage, maxSide: Int) -> CGImage {
    let k = min(1, Double(maxSide) / Double(max(img.width, img.height)))
    if k >= 1 { return img }
    let w = Int((Double(img.width) * k).rounded()), h = Int((Double(img.height) * k).rounded())
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return img }
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage() ?? img
}

/// The app being played, when watching a real window: a frame says whether it
/// is in front, because a key is only ever pressed into the app it is for.
var targetPid: pid_t = 0

func isFront() -> Bool {
    targetPid == 0 || NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPid
}

/// The stdin loop both `watch` and `replay` answer: a frame on request, stop.
func serve(_ ring: Ring, _ shape: Shape) {
    // A request can arrive in pieces; only a whole line is read.
    var pending = ""
    FileHandle.standardInput.readabilityHandler = { h in
        let data = h.availableData
        if data.isEmpty { exit(0) }
        pending += String(decoding: data, as: UTF8.self)
        guard let cut = pending.lastIndex(of: "\n") else { return }
        let whole = String(pending[..<cut])
        pending = String(pending[pending.index(after: cut)...])
        for line in whole.split(separator: "\n") {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any], let cmd = obj["cmd"] as? String else { continue }
            if cmd == "stop" { emit(["type": "stopped"]); exit(0) }
            if cmd == "frames", let paths = obj["out"] as? [String] {
                guard let parts = chosen(ring, n: shape.stack, gapMs: shape.gapMs) else { emit(["type": "error", "code": "no-frame-yet"]); continue }
                guard parts.count == paths.count else { emit(["type": "error", "code": "frames-count", "message": "\(parts.count) frames, \(paths.count) paths"]); continue }
                if zip(parts, paths).allSatisfy({ writePNG($0, to: URL(fileURLWithPath: $1)) }) {
                    emit(["type": "frames", "paths": paths, "w": parts.last!.width, "h": parts.last!.height, "front": isFront()])
                } else { emit(["type": "error", "code": "write-failed"]) }
                continue
            }
            if cmd == "frame", let path = obj["out"] as? String {
                let t0 = nowMs()
                guard let img = stacked(ring, n: shape.stack, gapMs: shape.gapMs) else { emit(["type": "error", "code": "no-frame-yet"]); continue }
                if writeJPEG(img, to: URL(fileURLWithPath: path)) {
                    emit(["type": "frame", "path": path, "w": img.width, "h": img.height, "ms": Int(nowMs() - t0), "front": isFront()])
                } else { emit(["type": "error", "code": "write-failed"]) }
            }
        }
    }
}

// MARK: - watching a window

func shareable() -> (SCShareableContent?, Error?) {
    let sem = DispatchSemaphore(value: 0)
    var content: SCShareableContent?, err: Error?
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { c, e in content = c; err = e; sem.signal() }
    sem.wait()
    return (content, err)
}

func listWindows() {
    let (content, err) = shareable()
    guard let content else { emit(["type": "error", "code": err == nil ? "no-windows" : "no-screen-permission", "message": err?.localizedDescription ?? ""]); return }
    let mine = ProcessInfo.processInfo.processIdentifier, parent = getppid()
    var list: [[String: Any]] = []
    for w in content.windows where w.windowLayer == 0 && w.frame.width >= 64 && w.frame.height >= 64 {
        guard let app = w.owningApplication, app.processID != mine, app.processID != parent else { continue }
        list.append(["id": w.windowID, "app": app.applicationName, "title": w.title ?? "", "pid": app.processID,
                     "w": Int(w.frame.width), "h": Int(w.frame.height)])
    }
    emit(["type": "windows", "windows": list])
}

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    let ring: Ring
    let crop: Crop?
    let ci = CIContext()
    init(_ r: Ring, crop: Crop?) { ring = r; self.crop = crop }
    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let pb = CMSampleBufferGetImageBuffer(sb) else { return }
        if let info = (CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
           let raw = info[.status] as? Int, let status = SCFrameStatus(rawValue: raw), status != .complete { return }
        let img = CIImage(cvPixelBuffer: pb)
        guard let cg = ci.createCGImage(img, from: img.extent) else { return }
        guard let kept = cropped(cg, crop) else { return }
        ring.add(kept, at: nowMs())
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit(["type": "error", "code": "window-gone", "message": error.localizedDescription]); exit(3)
    }
}

var keepAlive: [AnyObject] = []

func watch(_ shape: Shape) {
    let (content, err) = shareable()
    guard let window = content?.windows.first(where: { $0.windowID == shape.window }) else {
        emit(["type": "error", "code": content == nil ? "no-screen-permission" : "window-gone", "message": err?.localizedDescription ?? "that window is not on screen"]); exit(3)
    }
    // The first screen in the system's list the window touches, 2 when none
    // does — exactly the recorder's rule (format §13.2, D78).
    let scale = NSScreen.screens.first(where: { $0.frame.intersects(window.frame) })?.backingScaleFactor ?? 2
    let (w, h) = captureSize(window.frame.width * scale, window.frame.height * scale, maxSide: shape.maxSide, crop: shape.crop)
    let cut = shape.crop?.rect(Int(w), Int(h)).size ?? CGSize(width: w, height: h)
    guard cut.width >= 1, cut.height >= 1 else {
        emit(["type": "error", "code": "crop-under-a-pixel", "message": "its crop keeps under a pixel of this window (\(Int(w)) × \(Int(h)))"]); exit(2)
    }
    let config = SCStreamConfiguration()
    config.width = Int(w); config.height = Int(h)
    config.minimumFrameInterval = CMTime(value: 1, timescale: 10)
    config.showsCursor = false
    config.queueDepth = 5
    let ring = Ring(keepMs: Double(shape.stack) * shape.gapMs + 1500)
    // Whole frames go to the engine uncut; otherwise each is cut as it comes.
    let capture = Capture(ring, crop: shape.whole ? nil : shape.crop)
    let kept = shape.whole ? CGSize(width: w, height: h) : cut
    let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: capture)
    do { try stream.addStreamOutput(capture, type: .screen, sampleHandlerQueue: DispatchQueue(label: "frames")) }
    catch { emit(["type": "error", "code": "capture-failed", "message": error.localizedDescription]); exit(3) }
    let started = DispatchSemaphore(value: 0)
    var startErr: Error?
    stream.startCapture { e in startErr = e; started.signal() }
    started.wait()
    if let startErr { emit(["type": "error", "code": "capture-failed", "message": startErr.localizedDescription]); exit(3) }
    keepAlive += [stream, capture]
    targetPid = window.owningApplication?.processID ?? 0
    emit(["type": "ready", "window": ["id": window.windowID, "app": window.owningApplication?.applicationName ?? "",
                                     "pid": window.owningApplication?.processID ?? 0, "w": Int(kept.width), "h": Int(kept.height),
                                     "pixels": [window.frame.width * scale, window.frame.height * scale]]])
    serve(ring, shape)
    CFRunLoopRun()
}

/// A folder of frames, played round and round as if they were a window —
/// how the play loop is tested without a screen or a permission.
func replay(_ shape: Shape) {
    let files = ((try? FileManager.default.contentsOfDirectory(atPath: shape.dir)) ?? [])
        .filter { $0.hasSuffix(".jpg") || $0.hasSuffix(".png") }.sorted()
    let images = files.compactMap { f -> CGImage? in
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: shape.dir).appendingPathComponent(f) as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(src, 0, nil).map { scaled($0, maxSide: shape.maxSide) }
    }
    guard !images.isEmpty else { emit(["type": "error", "code": "no-frames", "message": "no .jpg or .png in \(shape.dir)"]); exit(3) }
    let ring = Ring(keepMs: Double(shape.stack) * shape.gapMs + 1500)
    var i = 0
    ring.add(images[0], at: nowMs())
    Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in i += 1; ring.add(images[(i / 5) % images.count], at: nowMs()) }
    emit(["type": "ready", "window": ["id": 0, "app": "Replay", "pid": 0, "w": images[0].width, "h": images[0].height, "frames": images.count]])
    serve(ring, shape)
    CFRunLoopRun()
}

func drawnFrame(_ i: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: 160, height: 144, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(CGColor(red: 0.1, green: 0.1, blue: 0.15, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: 160, height: 144))
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: (i * 8) % 152, y: 0, width: 8, height: 144))
    return ctx.makeImage()!
}

/// One pixel's brightness, 0–255, from the top left — for selftest.
func brightness(_ img: CGImage, x: Int, y: Int) -> Int {
    var px = [UInt8](repeating: 0, count: 4)
    guard let ctx = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return -1 }
    ctx.draw(img, in: CGRect(x: -x, y: y - img.height + 1, width: img.width, height: img.height))
    return Int(px[0])
}

func selftest() {
    var ok: [String: Bool] = [:]
    let ring = Ring(keepMs: 5000)
    let t = nowMs()
    for i in 0..<10 { ring.add(drawnFrame(i), at: t - Double(9 - i) * 100) }
    ok["latest_is_now"] = ring.before(nowMs())?.t == t
    ok["stack_of_three_is_three_wide"] = stacked(ring, n: 3, gapMs: 250)?.width == 160 * 3 + 8
    ok["stack_of_one_is_the_frame"] = stacked(ring, n: 1, gapMs: 250)?.width == 160
    ok["scaled_down"] = scaled(drawnFrame(0), maxSide: 80).width == 80
    ok["scaled_never_up"] = scaled(drawnFrame(0), maxSide: 800).width == 160
    // Cut the same way as Flight School's recorder: from the top left.
    let tctx = CGContext(data: nil, width: 40, height: 40, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                         bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    tctx.setFillColor(CGColor(gray: 0, alpha: 1)); tctx.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
    tctx.setFillColor(CGColor(gray: 1, alpha: 1)); tctx.fill(CGRect(x: 0, y: 20, width: 20, height: 20))  // the top-left quarter
    let lit = tctx.makeImage()!
    let topLeft = cropped(lit, Crop("0,0,0.5,0.5"))!
    ok["crop_is_the_top_left"] = topLeft.width == 20 && brightness(topLeft, x: 10, y: 10) > 200 && brightness(cropped(lit, Crop("0.5,0.5,0.5,0.5"))!, x: 10, y: 10) < 60
    ok["capture_size_fits_the_kept_part"] = captureSize(3200, 2000, maxSide: 768, crop: Crop("0,0,0.5,0.5")).0 == 1536 && captureSize(3200, 2000, maxSide: 768, crop: nil).0 == 768
    ok["under_a_pixel_is_nothing"] = cropped(lit, Crop("0,0,1,0.012")).map { _ in false } ?? true
    // The conformance kit's `frames` cases (format §13.2 steps 0–3), so this
    // and pigeon-core's capture_plan are held to the same numbers.
    func plan(_ W0: Double, _ H0: Double, _ side: Int, _ c: String?) -> [Int]? {
        let crop = c.flatMap(Crop.init)
        if c != nil && crop == nil { return nil }
        let (w, h) = captureSize(W0, H0, maxSide: side, crop: crop)
        let r = crop?.rect(Int(w), Int(h)) ?? CGRect(x: 0, y: 0, width: w, height: h)
        return r.width < 1 || r.height < 1 ? nil : [Int(w), Int(h), Int(r.minX), Int(r.minY), Int(r.width), Int(r.height)]
    }
    let kit: [(String, [Int]?, [Int]?)] = [
        ("recorder-self-test", plan(3200, 2000, 768, "0,0,0.5,0.5"), [1536, 960, 0, 0, 768, 480]),
        ("no-crop", plan(3200, 2000, 768, nil), [768, 480, 0, 0, 768, 480]),
        ("never-enlarged", plan(1600, 1000, 768, "0,0,0.25,0.5"), [1600, 1000, 0, 0, 400, 500]),
        ("negative-x", plan(1000, 1000, 1000, "-0.1,0,0.5,1"), [1000, 1000, 0, 0, 500, 1000]),
        ("past-edge-clipped", plan(1000, 1000, 1000, "0.8,0,0.5,1"), [1000, 1000, 800, 0, 200, 1000]),
        ("past-edge-changes-k", plan(3200, 2000, 768, "0.9,0,0.5,0.1"), [3200, 2000, 2880, 0, 320, 200]),
        ("shorter-side-rounds", plan(1920, 1200, 160, "0.242,0.1509,0.5171,0.8228"), [309, 193, 75, 29, 160, 159]),
        ("exactly-one-percent", plan(1000, 1000, 768, "0.5,0,0.01,1"), nil),
        ("rounds-under-a-pixel", plan(6000, 300, 768, "0,0,1,0.012"), nil),
    ]
    for (name, got, want) in kit { ok["kit_" + name] = got == want }
    emit(["type": "selftest", "ok": ok.values.allSatisfy { $0 }, "checks": ok])
}

/// The picture `watch` would write for these frames, from files: each frame
/// cut as `Capture` cuts it, then stacked and written as `serve` does.
func compose(_ a: ArraySlice<String>) {
    var outPath = "", crop: Crop? = nil, files: [String] = []
    var it = a.makeIterator()
    while let k = it.next() {
        switch k {
        case "--out": outPath = it.next() ?? ""
        case "--crop":
            guard let c = it.next().flatMap(Crop.init) else { emit(["type": "error", "code": "usage", "message": "--crop x,y,w,h"]); exit(64) }
            crop = c
        default: files.append(k)
        }
    }
    let frames = files.compactMap { f -> CGImage? in
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: f) as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(src, 0, nil).flatMap { cropped($0, crop) }
    }
    guard !outPath.isEmpty, !frames.isEmpty, frames.count == files.count, let img = sideBySide(frames) else {
        emit(["type": "error", "code": "usage", "message": "compose --out PATH [--crop x,y,w,h] FRAME…"]); exit(64)
    }
    if writeJPEG(img, to: URL(fileURLWithPath: outPath)) {
        emit(["type": "frame", "path": outPath, "w": img.width, "h": img.height])
    } else { emit(["type": "error", "code": "write-failed"]); exit(3) }
}

// MARK: - reading text (the text reader)

/// The text in an image, read by the OS's own recogniser. The bytes come on
/// stdin and go nowhere else; the lines come back top to bottom, with lines
/// that share a row joined by two spaces, the way a receipt or a table reads.
/// This is what the composer's image button uses: nothing to install, and it
/// reads what a screenshot says about as well as a person does.
func ocr() {
    let t0 = nowMs()
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { emit(["type": "error", "code": "empty", "message": "empty image"]); exit(2) }
    guard let src = CGImageSourceCreateWithData(data as CFData, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        emit(["type": "error", "code": "not-an-image", "message": "that is not an image this Mac can open"]); exit(2)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    do { try handler.perform([request]) } catch {
        emit(["type": "error", "code": "recognise-failed", "message": error.localizedDescription]); exit(3)
    }
    let seen = (request.results ?? []).compactMap { o -> (String, CGRect)? in
        guard let best = o.topCandidates(1).first else { return nil }
        return (best.string, o.boundingBox)
    }
    // Vision's boxes have their origin at the bottom left; a row is a band of
    // boxes whose centres sit within half a line of each other.
    let sorted = seen.sorted { a, b in
        let ay = a.1.midY, by = b.1.midY
        let tol = min(a.1.height, b.1.height) * 0.5
        if abs(ay - by) > tol { return ay > by }
        return a.1.minX < b.1.minX
    }
    var lines: [String] = []
    var rowY: CGFloat = -1, rowH: CGFloat = 0
    for (text, box) in sorted {
        if rowY >= 0 && abs(box.midY - rowY) <= min(rowH, box.height) * 0.5, !lines.isEmpty {
            lines[lines.count - 1] += "  " + text
        } else {
            lines.append(text); rowY = box.midY; rowH = box.height
        }
    }
    emit(["type": "text", "text": lines.joined(separator: "\n"), "lines": lines.count, "ms": Int(nowMs() - t0), "w": img.width, "h": img.height])
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "windows": listWindows()
case "watch": watch(Shape(args.dropFirst(2)).orRefuse())
case "replay": replay(Shape(args.dropFirst(2)).orRefuse())
case "selftest": selftest()
case "ocr": ocr()
case "compose": compose(args.dropFirst(2))
case "activate":
    // Brings the app to the front, for the key test: a key goes to the app in front.
    let pid = pid_t(Shape(args.dropFirst(2)).window)
    let ok = NSRunningApplication(processIdentifier: pid)?.activate() ?? false
    emit(["type": "activated", "ok": ok])
default: emit(["type": "error", "code": "usage", "message": "windows | watch | replay | activate | ocr | selftest | compose"]); exit(64)
}
