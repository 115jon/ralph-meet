// ── Per-window application icon extraction ─────────────────────────────────
//
// The screen picker shows a real application icon next to each window source
// (instead of a generic placeholder glyph). On Windows, Chromium/CEF-based
// apps often expose the host window's class icon first, which makes wrappers
// like RalphMeet appear as plain Chromium. To match the behaviour users expect
// from apps like Discord, we prefer the owning executable's icon first and
// fall back to the live window icon only when the process icon is unavailable.
//
//   1. Executable icon via `SHGetFileInfoW(process.exe)` — app-level identity.
//   2. `GetClassLongPtrW(GCLP_HICON)` / `GCLP_HICONSM` — reads the window
//      class's registered icon directly from class memory. This does NOT send a
//      message to the target window, so it never stalls a busy game's message
//      loop (the whole reason we avoid GDI capture for thumbnails).
//   3. Fallback: `SendMessageTimeoutW(WM_GETICON, …)` with a short
//      `SMTO_ABORTIFHUNG` timeout — some apps expose their icon only via
//      `WM_GETICON`. The timeout guarantees a hung target can never block us.
//
// The resulting `HICON` is rendered to a 32-bit top-down BGRA DIB via GDI
// `GetDIBits`, premultiplied alpha is undone where needed, and the pixels are
// PNG-encoded (to preserve transparency) and returned as a base64 data URL.

use base64::Engine;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetClassLongPtrW, GetIconInfo, GetWindowThreadProcessId, SendMessageTimeoutW,
    GCLP_HICON, GCLP_HICONSM, HICON, ICONINFO, ICON_BIG, ICON_SMALL2, SMTO_ABORTIFHUNG, WM_GETICON,
};

/// Encode RGBA pixels as a base64 PNG data URL.
fn rgba_icon_data_url(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    use std::io::Cursor;

    let img: image::RgbaImage = image::ImageBuffer::from_raw(width, height, rgba.to_vec())?;
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Some(format!("data:image/png;base64,{}", b64))
}

/// Encode a Tauri app icon as a base64 PNG data URL.
pub fn tauri_icon_data_url(icon: &tauri::image::Image<'_>) -> Option<String> {
    rgba_icon_data_url(icon.rgba(), icon.width(), icon.height())
}

/// Extract the best available application icon for `hwnd` as a base64 PNG data
/// URL, or `None` if no usable icon can be resolved.
///
/// Prefers the owning executable's icon so Chromium/CEF wrappers show their
/// branded app icon. Falls back to the live window icon when the process icon
/// is unavailable. Runs entirely off any GPU/composition path and never blocks
/// on a hung target window (class reads are message-free; the `WM_GETICON`
/// fallback is time-bounded).
pub fn window_icon_data_url(hwnd: isize) -> Option<String> {
    let hwnd = HWND(hwnd as *mut _);
    process_icon_data_url(hwnd).or_else(|| raw_window_icon_data_url(hwnd))
}

fn raw_window_icon_data_url(hwnd: HWND) -> Option<String> {
    let hicon = resolve_window_hicon(hwnd)?;
    // `GetClassLongPtr` icons are owned by the class and must NOT be destroyed;
    // `WM_GETICON` icons are also owned by the window. We never call CopyIcon,
    // so we must not DestroyIcon here — rendering only reads the icon.
    hicon_to_png_data_url(hicon)
}

fn process_icon_data_url(hwnd: HWND) -> Option<String> {
    let image_path = process_image_path_from_hwnd(hwnd)?;
    cached_executable_icon_data_url(&image_path)
}

fn cached_executable_icon_data_url(path: &str) -> Option<String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Ok(guard) = cache.lock() {
        if let Some(cached) = guard.get(path) {
            return cached.clone();
        }
    }

    let resolved = executable_icon_data_url(path);

    if let Ok(mut guard) = cache.lock() {
        guard.insert(path.to_string(), resolved.clone());
    }

    resolved
}

fn executable_icon_data_url(path: &str) -> Option<String> {
    let wide_path = wide_null(path);
    let mut info = SHFILEINFOW::default();
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if result == 0 || info.hIcon.is_invalid() {
        return None;
    }

    let rendered = hicon_to_png_data_url(info.hIcon);
    unsafe {
        let _ = DestroyIcon(info.hIcon);
    }
    rendered
}

fn process_image_path_from_hwnd(hwnd: HWND) -> Option<String> {
    let pid = window_process_id(hwnd)?;
    process_image_path(pid)
}

fn window_process_id(hwnd: HWND) -> Option<u32> {
    let mut pid: u32 = 0;
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if thread_id == 0 || pid == 0 {
        None
    } else {
        Some(pid)
    }
}

fn process_image_path(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false.into(), pid).ok()?;
        let mut buf = vec![0u16; 32768];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        Some(String::from_utf16_lossy(&buf[..size as usize]))
    }
}

fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn hicon_to_png_data_url(hicon: HICON) -> Option<String> {
    let (width, height, bgra) = render_hicon_bgra(hicon)?;
    let png = bgra_to_png(width, height, &bgra)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    Some(format!("data:image/png;base64,{}", b64))
}

/// Resolve the best available `HICON` for a window without blocking on a hung
/// target: class icon first (message-free), then a time-bounded `WM_GETICON`.
fn resolve_window_hicon(hwnd: HWND) -> Option<HICON> {
    unsafe {
        // 1. Class big icon (message-free read of class memory).
        let big = GetClassLongPtrW(hwnd, GCLP_HICON);
        if big != 0 {
            return Some(HICON(big as *mut _));
        }
        // 2. Class small icon.
        let small = GetClassLongPtrW(hwnd, GCLP_HICONSM);
        if small != 0 {
            return Some(HICON(small as *mut _));
        }
        // 3. Time-bounded WM_GETICON (some apps only answer here). 100 ms with
        //    SMTO_ABORTIFHUNG so a wedged target window can never block us.
        for icon_kind in [ICON_BIG, ICON_SMALL2] {
            let mut result: usize = 0;
            let _ = SendMessageTimeoutW(
                hwnd,
                WM_GETICON,
                WPARAM(icon_kind as usize),
                LPARAM(0),
                SMTO_ABORTIFHUNG,
                100,
                Some(&mut result as *mut usize as *mut _),
            );
            if result != 0 {
                return Some(HICON(result as *mut _));
            }
        }
        None
    }
}

/// Render an `HICON` to top-down 32-bit BGRA pixels via GDI `GetDIBits`.
/// Returns `(width, height, bgra)` with stride == width*4.
fn render_hicon_bgra(hicon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut info = ICONINFO::default();
        GetIconInfo(hicon, &mut info).ok()?;

        // Ensure the bitmaps GetIconInfo created are freed on every exit path.
        let color = info.hbmColor;
        let mask = info.hbmMask;
        let _guard = GdiObjGuard(vec![HGDIOBJ(color.0), HGDIOBJ(mask.0)]);

        // The color bitmap carries the dimensions (mask-only cursors are not
        // expected for app icons; bail if there is no color bitmap).
        if color.is_invalid() {
            return None;
        }
        let mut bmp = BITMAP::default();
        let got = GetObjectW(
            HGDIOBJ(color.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        );
        if got == 0 {
            return None;
        }
        let width = bmp.bmWidth.max(0) as u32;
        let height = bmp.bmHeight.abs().max(0) as u32;
        if width == 0 || height == 0 {
            return None;
        }

        // Request a top-down (negative height) 32bpp BGRA DIB.
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let screen_dc = GetDC(None);
        if screen_dc.is_invalid() {
            return None;
        }
        let mut bgra = vec![0u8; (width as usize) * (height as usize) * 4];
        let scanlines = GetDIBits(
            screen_dc,
            color,
            0,
            height,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, screen_dc);
        if scanlines == 0 {
            return None;
        }

        // Some icons report no alpha (all-zero alpha channel after GetDIBits).
        // If every alpha byte is 0 the icon is effectively opaque, so force
        // alpha to 255 to avoid a fully-transparent PNG.
        if bgra.chunks_exact(4).all(|px| px[3] == 0) {
            for px in bgra.chunks_exact_mut(4) {
                px[3] = 255;
            }
        }

        Some((width, height, bgra))
    }
}

/// Encode top-down BGRA pixels as PNG bytes (RGBA8), preserving alpha.
fn bgra_to_png(width: u32, height: u32, bgra: &[u8]) -> Option<Vec<u8>> {
    use std::io::Cursor;
    // Swizzle BGRA → RGBA for the `image` crate.
    let mut rgba = Vec::with_capacity(bgra.len());
    for px in bgra.chunks_exact(4) {
        rgba.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
    }
    let img: image::RgbaImage = image::ImageBuffer::from_raw(width, height, rgba)?;
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .ok()?;
    Some(buf.into_inner())
}

/// RAII guard that deletes a set of GDI objects on drop (the color/mask bitmaps
/// `GetIconInfo` allocates must be freed by the caller).
struct GdiObjGuard(Vec<HGDIOBJ>);

impl Drop for GdiObjGuard {
    fn drop(&mut self) {
        for obj in &self.0 {
            if !obj.is_invalid() {
                unsafe {
                    let _ = DeleteObject(*obj);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgba_icon_data_url_encodes_png_data_url() {
        let rgba = [0x12, 0x34, 0x56, 0xff];
        let data_url = rgba_icon_data_url(&rgba, 1, 1).expect("expected png data url");
        assert!(data_url.starts_with("data:image/png;base64,"));
    }
}
