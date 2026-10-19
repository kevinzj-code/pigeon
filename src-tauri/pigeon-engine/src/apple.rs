//! Frames into the picture a playing Pigeon sees (E12), by the same Apple
//! calls the Pigeon app's capture helper makes (`eye/Eye.swift`): a frame is
//! cut with `CGImageCreateWithImageInRect`, frames are stacked in an RGB
//! bitmap context with 4 black pixels between, and the result is written as
//! JPEG at quality 0.85 by ImageIO. The same calls on the same frames give
//! the same bytes, which is what keeps the engine's picture the one Eye
//! makes today (tests/frames.rs holds the two to it).
//!
//! The second and last module with `unsafe` in it, after `llama.rs`; a test
//! per entry point is at the bottom.

use std::ffi::c_void;

type Ref = *const c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

const NONE_SKIP_LAST: u32 = 5;
const INTERPOLATION_HIGH: i32 = 3;
const CF_NUMBER_DOUBLE: isize = 13;
const UTF8: u32 = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: Ref);
    fn CFDataCreate(alloc: Ref, bytes: *const u8, len: isize) -> Ref;
    fn CFDataCreateMutable(alloc: Ref, cap: isize) -> Ref;
    fn CFDataGetLength(d: Ref) -> isize;
    fn CFDataGetBytePtr(d: Ref) -> *const u8;
    fn CFNumberCreate(alloc: Ref, kind: isize, value: *const c_void) -> Ref;
    fn CFStringCreateWithCString(alloc: Ref, s: *const std::ffi::c_char, encoding: u32) -> Ref;
    fn CFDictionaryCreate(alloc: Ref, keys: *const Ref, values: *const Ref, n: isize, key_cb: Ref, value_cb: Ref) -> Ref;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageSourceCreateWithData(data: Ref, options: Ref) -> Ref;
    fn CGImageSourceCreateImageAtIndex(src: Ref, index: usize, options: Ref) -> Ref;
    fn CGImageSourceGetCount(src: Ref) -> usize;
    fn CGImageDestinationCreateWithData(data: Ref, kind: Ref, count: usize, options: Ref) -> Ref;
    fn CGImageDestinationAddImage(dest: Ref, image: Ref, properties: Ref);
    fn CGImageDestinationFinalize(dest: Ref) -> bool;
    static kCGImageDestinationLossyCompressionQuality: Ref;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGImageGetWidth(image: Ref) -> usize;
    fn CGImageGetHeight(image: Ref) -> usize;
    fn CGImageCreateWithImageInRect(image: Ref, rect: CGRect) -> Ref;
    fn CGColorSpaceCreateDeviceRGB() -> Ref;
    fn CGColorSpaceCreateWithName(name: Ref) -> Ref;
    static kCGColorSpaceSRGB: Ref;
    fn CGBitmapContextCreate(data: *mut c_void, w: usize, h: usize, bpc: usize, bpr: usize, space: Ref, info: u32) -> Ref;
    fn CGBitmapContextCreateImage(ctx: Ref) -> Ref;
    fn CGContextSetGrayFillColor(ctx: Ref, gray: f64, alpha: f64);
    fn CGContextFillRect(ctx: Ref, rect: CGRect);
    fn CGContextDrawImage(ctx: Ref, rect: CGRect, image: Ref);
    fn CGContextSetInterpolationQuality(ctx: Ref, quality: i32);
    fn CGDataProviderCreateWithCFData(data: Ref) -> Ref;
    fn CGImageCreate(w: usize, h: usize, bpc: usize, bpp: usize, bpr: usize, space: Ref, info: u32, provider: Ref, decode: *const f64, interpolate: bool, intent: i32) -> Ref;
}

/// One CoreFoundation object, released when dropped.
struct Owned(Ref);

impl Owned {
    fn new(r: Ref) -> Option<Owned> {
        (!r.is_null()).then_some(Owned(r))
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

/// A picture, held by CoreGraphics.
pub struct Image(Owned);

// SAFETY: a CGImage is immutable once made, and CoreGraphics documents it as
// safe to use from any thread.
unsafe impl Send for Image {}

impl Image {
    /// A PNG or JPEG.
    pub fn decode(bytes: &[u8]) -> Result<Image, String> {
        unsafe {
            let data = Owned::new(CFDataCreate(std::ptr::null(), bytes.as_ptr(), bytes.len() as isize)).ok_or("no memory")?;
            let src = Owned::new(CGImageSourceCreateWithData(data.0, std::ptr::null())).ok_or("not a picture this Mac can open")?;
            if CGImageSourceGetCount(src.0) == 0 {
                return Err("not a picture this Mac can open".into());
            }
            Owned::new(CGImageSourceCreateImageAtIndex(src.0, 0, std::ptr::null())).map(Image).ok_or_else(|| "not a picture this Mac can open".into())
        }
    }

    /// Raw pixels, 4 bytes each, rows top to bottom; the fourth byte is not read.
    pub fn from_rgba(width: usize, height: usize, rgba: &[u8]) -> Result<Image, String> {
        if width == 0 || height == 0 || rgba.len() != width * height * 4 {
            return Err("the raw frame is not width × height × 4 bytes".into());
        }
        unsafe {
            let data = Owned::new(CFDataCreate(std::ptr::null(), rgba.as_ptr(), rgba.len() as isize)).ok_or("no memory")?;
            let provider = Owned::new(CGDataProviderCreateWithCFData(data.0)).ok_or("no memory")?;
            let space = Owned::new(CGColorSpaceCreateWithName(kCGColorSpaceSRGB)).ok_or("no colour space")?;
            Owned::new(CGImageCreate(width, height, 8, 32, width * 4, space.0, NONE_SKIP_LAST, provider.0, std::ptr::null(), false, 0))
                .map(Image)
                .ok_or_else(|| "the raw frame could not be made a picture".into())
        }
    }

    pub fn width(&self) -> usize {
        unsafe { CGImageGetWidth(self.0 .0) }
    }

    pub fn height(&self) -> usize {
        unsafe { CGImageGetHeight(self.0 .0) }
    }

    /// The part from (x, y), top left, `w` × `h` pixels.
    pub fn crop(&self, x: u32, y: u32, w: u32, h: u32) -> Result<Image, String> {
        let r = CGRect { x: x as f64, y: y as f64, w: w as f64, h: h as f64 };
        unsafe { Owned::new(CGImageCreateWithImageInRect(self.0 .0, r)).map(Image).ok_or_else(|| "the crop is outside the frame".into()) }
    }

    /// The same picture with its longer side at most `max_side` pixels,
    /// drawn smaller with high-quality interpolation; None when it already
    /// fits, so nothing is redrawn that need not be.
    pub fn scaled(&self, max_side: usize) -> Result<Option<Image>, String> {
        let (w, h) = (self.width(), self.height());
        let side = w.max(h);
        if side <= max_side || side == 0 {
            return Ok(None);
        }
        let f = max_side as f64 / side as f64;
        let (nw, nh) = (((w as f64) * f).round().max(1.0) as usize, ((h as f64) * f).round().max(1.0) as usize);
        unsafe {
            let space = Owned::new(CGColorSpaceCreateDeviceRGB()).ok_or("no colour space")?;
            let ctx = Owned::new(CGBitmapContextCreate(std::ptr::null_mut(), nw, nh, 8, 0, space.0, NONE_SKIP_LAST)).ok_or("the picture could not be drawn smaller")?;
            CGContextSetInterpolationQuality(ctx.0, INTERPOLATION_HIGH);
            CGContextDrawImage(ctx.0, CGRect { x: 0.0, y: 0.0, w: nw as f64, h: nh as f64 }, self.0 .0);
            Owned::new(CGBitmapContextCreateImage(ctx.0)).map(|i| Some(Image(i))).ok_or_else(|| "the picture could not be drawn smaller".into())
        }
    }

    /// As JPEG at quality 0.85.
    pub fn jpeg(&self) -> Result<Vec<u8>, String> {
        unsafe {
            let out = Owned::new(CFDataCreateMutable(std::ptr::null(), 0)).ok_or("no memory")?;
            let kind = Owned::new(CFStringCreateWithCString(std::ptr::null(), c"public.jpeg".as_ptr(), UTF8)).ok_or("no memory")?;
            let dest = Owned::new(CGImageDestinationCreateWithData(out.0, kind.0, 1, std::ptr::null())).ok_or("JPEG cannot be written here")?;
            let q: f64 = 0.85;
            let quality = Owned::new(CFNumberCreate(std::ptr::null(), CF_NUMBER_DOUBLE, &q as *const f64 as *const c_void)).ok_or("no memory")?;
            let keys = [kCGImageDestinationLossyCompressionQuality];
            let values = [quality.0];
            let props = Owned::new(CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks as *const c_void,
                &kCFTypeDictionaryValueCallBacks as *const c_void,
            ))
            .ok_or("no memory")?;
            CGImageDestinationAddImage(dest.0, self.0 .0, props.0);
            if !CGImageDestinationFinalize(dest.0) {
                return Err("the JPEG could not be written".into());
            }
            Ok(std::slice::from_raw_parts(CFDataGetBytePtr(out.0), CFDataGetLength(out.0) as usize).to_vec())
        }
    }
}

/// Frames side by side, oldest first, 4 black pixels between, each drawn at
/// the newest one's height; one frame is itself. Eye's `sideBySide`.
pub fn side_by_side(parts: Vec<Image>) -> Result<Image, String> {
    let n = parts.len();
    let mut parts = parts;
    if n == 1 {
        return Ok(parts.remove(0));
    }
    let h = parts.last().ok_or("no frames")?.height();
    let widths: Vec<usize> = parts.iter().map(|p| ((p.width() as f64) * (h as f64) / (p.height() as f64)).round() as usize).collect();
    let w = widths.iter().sum::<usize>() + 4 * (n - 1);
    unsafe {
        let space = Owned::new(CGColorSpaceCreateDeviceRGB()).ok_or("no colour space")?;
        let ctx = Owned::new(CGBitmapContextCreate(std::ptr::null_mut(), w, h, 8, 0, space.0, NONE_SKIP_LAST)).ok_or("the stack could not be drawn")?;
        CGContextSetGrayFillColor(ctx.0, 0.0, 1.0);
        CGContextFillRect(ctx.0, CGRect { x: 0.0, y: 0.0, w: w as f64, h: h as f64 });
        let mut x = 0usize;
        for (p, pw) in parts.iter().zip(&widths) {
            CGContextDrawImage(ctx.0, CGRect { x: x as f64, y: 0.0, w: *pw as f64, h: h as f64 }, p.0 .0);
            x += pw + 4;
        }
        Owned::new(CGBitmapContextCreateImage(ctx.0)).map(Image).ok_or_else(|| "the stack could not be drawn".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: usize, h: usize, v: u8) -> Image {
        Image::from_rgba(w, h, &vec![v; w * h * 4]).unwrap()
    }

    #[test]
    fn from_rgba_refuses_the_wrong_length() {
        assert!(Image::from_rgba(2, 2, &[0; 15]).is_err());
        assert_eq!(frame(3, 2, 9).width(), 3);
        assert_eq!(frame(3, 2, 9).height(), 2);
    }

    #[test]
    fn jpeg_writes_a_jpeg_that_decodes_to_the_same_size() {
        let j = frame(40, 30, 200).jpeg().unwrap();
        assert_eq!(&j[..2], &[0xFF, 0xD8]);
        let back = Image::decode(&j).unwrap();
        assert_eq!((back.width(), back.height()), (40, 30));
        assert!(Image::decode(b"not a picture").is_err());
    }

    #[test]
    fn scaled_fits_the_longer_side_and_leaves_a_small_picture_alone() {
        let s = frame(400, 300, 7).scaled(100).unwrap().unwrap();
        assert_eq!((s.width(), s.height()), (100, 75));
        let tall = frame(30, 90, 7).scaled(45).unwrap().unwrap();
        assert_eq!((tall.width(), tall.height()), (15, 45));
        assert!(frame(40, 30, 7).scaled(40).unwrap().is_none(), "already fits");
        assert!(frame(40, 30, 7).scaled(100).unwrap().is_none(), "never enlarged");
    }

    #[test]
    fn crop_keeps_the_part_asked_for() {
        let c = frame(40, 30, 1).crop(5, 6, 10, 12).unwrap();
        assert_eq!((c.width(), c.height()), (10, 12));
    }

    #[test]
    fn side_by_side_puts_four_pixels_between() {
        assert_eq!(side_by_side(vec![frame(10, 8, 1)]).unwrap().width(), 10);
        let s = side_by_side(vec![frame(10, 8, 1), frame(10, 8, 2), frame(10, 8, 3)]).unwrap();
        assert_eq!((s.width(), s.height()), (38, 8));
        assert!(side_by_side(Vec::new()).is_err());
    }
}
