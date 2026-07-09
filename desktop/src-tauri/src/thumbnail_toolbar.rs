use std::f32::consts::PI;
use std::mem::size_of;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use image::{imageops::FilterType, Rgba, RgbaImage};
use tauri::{Emitter, Manager};

#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

#[cfg(target_os = "windows")]
use windows::core::{w, HRESULT};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    BI_BITFIELDS, BITMAPINFO, BITMAPV5HEADER, CreateBitmap, CreateDIBSection, DIB_RGB_COLORS,
    DeleteObject, GetDC, ReleaseDC,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, TaskbarList,
    THBF_DISABLED, THBF_HIDDEN, THBF_NOBACKGROUND, THBF_NONINTERACTIVE, THBN_CLICKED,
    THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON, THUMBBUTTONFLAGS,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, DestroyIcon, GetSystemMetrics, RegisterWindowMessageW, HICON, ICONINFO,
    SM_CXICON, WM_COMMAND, WM_NCDESTROY,
};

const DESKTOP_THUMBNAIL_TOOLBAR_ACTION_EVENT: &str = "desktop-thumbnail-toolbar-action";

#[cfg(target_os = "windows")]
const CAMERA_OFF_ICON_BYTES: &[u8] =
    include_bytes!("../resources/thumbnail-toolbar/camera-off.png");
#[cfg(target_os = "windows")]
const CAMERA_ON_ICON_BYTES: &[u8] =
    include_bytes!("../resources/thumbnail-toolbar/camera-on.png");
#[cfg(target_os = "windows")]
const DEAFEN_OFF_ICON_BYTES: &[u8] =
    include_bytes!("../resources/thumbnail-toolbar/deafen-off.png");
#[cfg(target_os = "windows")]
const DEAFEN_ON_ICON_BYTES: &[u8] =
    include_bytes!("../resources/thumbnail-toolbar/deafen-on.png");
#[cfg(target_os = "windows")]
const DISCONNECT_ICON_BYTES: &[u8] =
    include_bytes!("../resources/thumbnail-toolbar/disconnect.png");
#[cfg(target_os = "windows")]
const MICROPHONE_OFF_ICON_BYTES: &[u8] =
    include_bytes!("../resources/thumbnail-toolbar/mic-off.png");
#[cfg(target_os = "windows")]
const MICROPHONE_ON_ICON_BYTES: &[u8] =
    include_bytes!("../resources/thumbnail-toolbar/mic-on.png");

#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailToolbarState {
    pub visible: bool,
    pub has_camera: bool,
    pub is_camera_on: bool,
    pub has_microphone: bool,
    pub is_muted: bool,
    pub is_deafened: bool,
    pub has_media_controls: bool,
    pub is_media_paused: bool,
}

#[derive(Clone, serde::Serialize)]
struct ThumbnailToolbarActionEvent {
    action: &'static str,
}

#[cfg(target_os = "windows")]
const THUMBNAIL_TOOLBAR_SUBCLASS_ID: usize = 0x524D5448;
#[cfg(target_os = "windows")]
const BUTTON_ID_CAMERA: u32 = 0x4400;
#[cfg(target_os = "windows")]
const BUTTON_ID_MICROPHONE: u32 = 0x4401;
#[cfg(target_os = "windows")]
const BUTTON_ID_DEAFEN: u32 = 0x4402;
#[cfg(target_os = "windows")]
const BUTTON_ID_DISCONNECT: u32 = 0x4403;
#[cfg(target_os = "windows")]
const BUTTON_ID_SEPARATOR: u32 = 0x4404;
#[cfg(target_os = "windows")]
const BUTTON_ID_MEDIA_TOGGLE: u32 = 0x4405;
#[cfg(target_os = "windows")]
const BUTTON_ID_MEDIA_SKIP: u32 = 0x4406;

#[cfg(target_os = "windows")]
static THUMBNAIL_TOOLBAR_MANAGER: OnceLock<Arc<ThumbnailToolbarManager>> = OnceLock::new();

#[cfg(target_os = "windows")]
struct ThumbnailToolbarIcons {
    camera_off: HICON,
    camera_on: HICON,
    deafen_off: HICON,
    deafen_on: HICON,
    disconnect: HICON,
    media_pause: HICON,
    media_play: HICON,
    media_skip: HICON,
    microphone_off: HICON,
    microphone_on: HICON,
    separator: HICON,
}

#[cfg(target_os = "windows")]
impl ThumbnailToolbarIcons {
    fn new(icon_size: u32) -> windows::core::Result<Self> {
        Ok(Self {
            camera_off: create_toolbar_icon_from_png_bytes(icon_size, CAMERA_OFF_ICON_BYTES)?,
            camera_on: create_toolbar_icon_from_png_bytes(icon_size, CAMERA_ON_ICON_BYTES)?,
            deafen_off: create_toolbar_icon_from_png_bytes(icon_size, DEAFEN_OFF_ICON_BYTES)?,
            deafen_on: create_toolbar_icon_from_png_bytes(icon_size, DEAFEN_ON_ICON_BYTES)?,
            disconnect: create_toolbar_icon_from_png_bytes(icon_size, DISCONNECT_ICON_BYTES)?,
            media_pause: create_toolbar_icon(icon_size, ThumbnailIconKind::Pause)?,
            media_play: create_toolbar_icon(icon_size, ThumbnailIconKind::Play)?,
            media_skip: create_toolbar_icon(icon_size, ThumbnailIconKind::Skip)?,
            microphone_off: create_toolbar_icon_from_png_bytes(
                icon_size,
                MICROPHONE_OFF_ICON_BYTES,
            )?,
            microphone_on: create_toolbar_icon_from_png_bytes(
                icon_size,
                MICROPHONE_ON_ICON_BYTES,
            )?,
            separator: create_toolbar_icon(icon_size, ThumbnailIconKind::Separator)?,
        })
    }
}

#[cfg(target_os = "windows")]
impl Drop for ThumbnailToolbarIcons {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.camera_off);
            let _ = DestroyIcon(self.camera_on);
            let _ = DestroyIcon(self.deafen_off);
            let _ = DestroyIcon(self.deafen_on);
            let _ = DestroyIcon(self.disconnect);
            let _ = DestroyIcon(self.media_pause);
            let _ = DestroyIcon(self.media_play);
            let _ = DestroyIcon(self.media_skip);
            let _ = DestroyIcon(self.microphone_off);
            let _ = DestroyIcon(self.microphone_on);
            let _ = DestroyIcon(self.separator);
        }
    }
}

#[cfg(target_os = "windows")]
struct ThumbnailToolbarManager {
    app: tauri::AppHandle<TauriRuntime>,
    buttons_added: AtomicBool,
    hwnd: HWND,
    icons: ThumbnailToolbarIcons,
    state: Mutex<ThumbnailToolbarState>,
    taskbar_button_created_message: u32,
}

#[cfg(target_os = "windows")]
unsafe impl Send for ThumbnailToolbarManager {}
#[cfg(target_os = "windows")]
unsafe impl Sync for ThumbnailToolbarManager {}

#[cfg(target_os = "windows")]
impl ThumbnailToolbarManager {
    fn new(app: tauri::AppHandle<TauriRuntime>, hwnd: HWND) -> windows::core::Result<Self> {
        let icon_size = unsafe { GetSystemMetrics(SM_CXICON) }.max(16) as u32;

        Ok(Self {
            app,
            buttons_added: AtomicBool::new(false),
            hwnd,
            icons: ThumbnailToolbarIcons::new(icon_size)?,
            state: Mutex::new(ThumbnailToolbarState::default()),
            taskbar_button_created_message: unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) },
        })
    }

    fn install_subclass(self: &Arc<Self>) -> windows::core::Result<()> {
        let installed = unsafe {
            SetWindowSubclass(
                self.hwnd,
                Some(thumbnail_toolbar_subclass_proc),
                THUMBNAIL_TOOLBAR_SUBCLASS_ID,
                0,
            )
        };

        if installed.as_bool() {
            Ok(())
        } else {
            Err(windows::core::Error::from_win32())
        }
    }

    fn update_state(&self, state: ThumbnailToolbarState) -> windows::core::Result<()> {
        *self.state.lock().expect("thumbnail toolbar state lock poisoned") = state;
        self.apply_current_state()
    }

    fn emit_action(&self, action: &'static str) {
        let _ = self
            .app
            .emit(DESKTOP_THUMBNAIL_TOOLBAR_ACTION_EVENT, ThumbnailToolbarActionEvent { action });
    }

    fn mark_taskbar_button_recreated(&self) {
        self.buttons_added.store(false, Ordering::Relaxed);
        let _ = self.apply_current_state();
    }

    fn apply_current_state(&self) -> windows::core::Result<()> {
        ensure_com_initialized();

        let taskbar: ITaskbarList3 = unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)? };
        unsafe {
            taskbar.HrInit()?;
        }

        let state = self
            .state
            .lock()
            .expect("thumbnail toolbar state lock poisoned")
            .clone();
        let buttons = self.build_buttons(&state);

        unsafe {
            if !self.buttons_added.load(Ordering::Relaxed) {
                taskbar.ThumbBarAddButtons(self.hwnd, &buttons)?;
                self.buttons_added.store(true, Ordering::Relaxed);
            } else {
                taskbar.ThumbBarUpdateButtons(self.hwnd, &buttons)?;
            }
        }

        Ok(())
    }

    fn build_buttons(&self, state: &ThumbnailToolbarState) -> [THUMBBUTTON; 7] {
        let all_hidden = !state.visible;
        let mic_is_muted = state.is_deafened || state.is_muted || !state.has_microphone;

        // Match the in-app voice controls: icon glyphs reflect current state,
        // while tooltips describe the next toggle action.
        [
            self.make_button(
                BUTTON_ID_CAMERA,
                if state.is_camera_on {
                    self.icons.camera_on
                } else {
                    self.icons.camera_off
                },
                Some(if !state.has_camera {
                    "No camera detected"
                } else if state.is_camera_on {
                    "Turn Off Camera"
                } else {
                    "Turn On Camera"
                }),
                visibility_flags(all_hidden, !state.has_camera),
            ),
            self.make_button(
                BUTTON_ID_MICROPHONE,
                if mic_is_muted {
                    self.icons.microphone_off
                } else {
                    self.icons.microphone_on
                },
                Some(if !state.has_microphone {
                    "No microphone detected"
                } else if mic_is_muted {
                    "Unmute Microphone"
                } else {
                    "Mute Microphone"
                }),
                visibility_flags(all_hidden, !state.has_microphone),
            ),
            self.make_button(
                BUTTON_ID_DEAFEN,
                if state.is_deafened {
                    self.icons.deafen_on
                } else {
                    self.icons.deafen_off
                },
                Some(if state.is_deafened { "Undeafen" } else { "Deafen" }),
                visibility_flags(all_hidden, false),
            ),
            self.make_button(
                BUTTON_ID_DISCONNECT,
                self.icons.disconnect,
                Some("Disconnect"),
                visibility_flags(all_hidden, false),
            ),
            self.make_button(
                BUTTON_ID_SEPARATOR,
                self.icons.separator,
                None,
                if all_hidden || !state.has_media_controls {
                    THBF_HIDDEN
                } else {
                    THBF_NONINTERACTIVE | THBF_NOBACKGROUND
                },
            ),
            self.make_button(
                BUTTON_ID_MEDIA_TOGGLE,
                if state.is_media_paused {
                    self.icons.media_play
                } else {
                    self.icons.media_pause
                },
                Some(if state.is_media_paused {
                    "Resume Shared Playback"
                } else {
                    "Pause Shared Playback"
                }),
                visibility_flags(all_hidden || !state.has_media_controls, false),
            ),
            self.make_button(
                BUTTON_ID_MEDIA_SKIP,
                self.icons.media_skip,
                Some("Skip Current Track"),
                visibility_flags(all_hidden || !state.has_media_controls, false),
            ),
        ]
    }

    fn make_button(
        &self,
        id: u32,
        icon: HICON,
        tooltip: Option<&str>,
        flags: THUMBBUTTONFLAGS,
    ) -> THUMBBUTTON {
        let mut mask = THB_FLAGS | THB_ICON;
        let sz_tip = if let Some(tooltip) = tooltip {
            mask |= THB_TOOLTIP;
            encode_wide_tooltip(tooltip)
        } else {
            [0u16; 260]
        };

        THUMBBUTTON {
            dwMask: mask,
            iId: id,
            hIcon: icon,
            szTip: sz_tip,
            dwFlags: flags,
            ..Default::default()
        }
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn thumbnail_toolbar_subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _refdata: usize,
) -> LRESULT {
    if let Some(manager) = THUMBNAIL_TOOLBAR_MANAGER.get() {
        if message == manager.taskbar_button_created_message {
            manager.mark_taskbar_button_recreated();
            return LRESULT(0);
        }

        if message == WM_COMMAND && hiword(wparam.0 as u32) == THBN_CLICKED as u16 {
            match loword(wparam.0 as u32) as u32 {
                BUTTON_ID_CAMERA => manager.emit_action("toggle-camera"),
                BUTTON_ID_MICROPHONE => manager.emit_action("toggle-mic"),
                BUTTON_ID_DEAFEN => manager.emit_action("toggle-deafen"),
                BUTTON_ID_DISCONNECT => manager.emit_action("disconnect"),
                BUTTON_ID_MEDIA_TOGGLE => manager.emit_action("toggle-media-playback"),
                BUTTON_ID_MEDIA_SKIP => manager.emit_action("skip-media"),
                _ => {}
            }
            return LRESULT(0);
        }

        if message == WM_NCDESTROY {
            manager.buttons_added.store(false, Ordering::Relaxed);
            let _ = RemoveWindowSubclass(
                hwnd,
                Some(thumbnail_toolbar_subclass_proc),
                THUMBNAIL_TOOLBAR_SUBCLASS_ID,
            );
        }
    }

    DefSubclassProc(hwnd, message, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn ensure_com_initialized() {
    unsafe {
        let _ = CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
    }
}

#[cfg(target_os = "windows")]
fn visibility_flags(hidden: bool, disabled: bool) -> THUMBBUTTONFLAGS {
    let mut flags = THUMBBUTTONFLAGS(0);
    if hidden {
        flags |= THBF_HIDDEN;
    }
    if disabled {
        flags |= THBF_DISABLED;
    }
    flags
}

#[cfg(target_os = "windows")]
fn loword(value: u32) -> u16 {
    (value & 0xFFFF) as u16
}

#[cfg(target_os = "windows")]
fn hiword(value: u32) -> u16 {
    ((value >> 16) & 0xFFFF) as u16
}

#[cfg(target_os = "windows")]
fn encode_wide_tooltip(text: &str) -> [u16; 260] {
    let mut tooltip = [0u16; 260];
    for (index, code_unit) in text.encode_utf16().take(tooltip.len().saturating_sub(1)).enumerate() {
        tooltip[index] = code_unit;
    }
    tooltip
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
enum ThumbnailIconKind {
    CameraOff,
    CameraOn,
    Disconnect,
    HeadphonesOff,
    HeadphonesOn,
    MicOff,
    MicOn,
    Pause,
    Play,
    Separator,
    Skip,
}

#[cfg(target_os = "windows")]
fn create_toolbar_icon(icon_size: u32, kind: ThumbnailIconKind) -> windows::core::Result<HICON> {
    let draw_size = (icon_size.max(16)) * 4;
    let mut canvas = RgbaImage::from_pixel(draw_size, draw_size, Rgba([0, 0, 0, 0]));
    draw_icon(&mut canvas, kind);
    canvas_to_icon(canvas, icon_size.max(16))
}

#[cfg(target_os = "windows")]
fn create_toolbar_icon_from_png_bytes(
    icon_size: u32,
    bytes: &[u8],
) -> windows::core::Result<HICON> {
    let image = image::load_from_memory(bytes).map_err(|error| {
        windows::core::Error::new(
            HRESULT(0x80004005u32 as i32),
            format!("failed to decode thumbnail toolbar icon asset: {error}"),
        )
    })?;

    canvas_to_icon(image.to_rgba8(), icon_size.max(16))
}

#[cfg(target_os = "windows")]
fn draw_icon(canvas: &mut RgbaImage, kind: ThumbnailIconKind) {
    let foreground = Rgba([255, 255, 255, 245]);
    let separator = Rgba([255, 255, 255, 110]);

    match kind {
        ThumbnailIconKind::CameraOn | ThumbnailIconKind::CameraOff => {
            draw_camera_icon(canvas, foreground);
            if matches!(kind, ThumbnailIconKind::CameraOff) {
                draw_slash(canvas, foreground);
            }
        }
        ThumbnailIconKind::Disconnect => draw_disconnect_icon(canvas, foreground),
        ThumbnailIconKind::HeadphonesOn | ThumbnailIconKind::HeadphonesOff => {
            draw_headphones_icon(canvas, foreground);
            if matches!(kind, ThumbnailIconKind::HeadphonesOff) {
                draw_slash(canvas, foreground);
            }
        }
        ThumbnailIconKind::MicOn | ThumbnailIconKind::MicOff => {
            draw_microphone_icon(canvas, foreground);
            if matches!(kind, ThumbnailIconKind::MicOff) {
                draw_slash(canvas, foreground);
            }
        }
        ThumbnailIconKind::Pause => draw_pause_icon(canvas, foreground),
        ThumbnailIconKind::Play => draw_play_icon(canvas, foreground),
        ThumbnailIconKind::Separator => draw_separator_icon(canvas, separator),
        ThumbnailIconKind::Skip => draw_skip_icon(canvas, foreground),
    }
}

#[cfg(target_os = "windows")]
fn draw_camera_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    fill_rounded_rect(canvas, 0.17 * s, 0.30 * s, 0.43 * s, 0.28 * s, 0.06 * s, color);
    fill_triangle(
        canvas,
        (0.58 * s, 0.36 * s),
        (0.82 * s, 0.24 * s),
        (0.82 * s, 0.64 * s),
        color,
    );
}

#[cfg(target_os = "windows")]
fn draw_microphone_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    fill_rounded_rect(canvas, 0.37 * s, 0.16 * s, 0.18 * s, 0.30 * s, 0.09 * s, color);
    draw_line(
        canvas,
        0.46 * s,
        0.47 * s,
        0.46 * s,
        0.66 * s,
        0.07 * s,
        color,
    );
    draw_line(
        canvas,
        0.33 * s,
        0.77 * s,
        0.59 * s,
        0.77 * s,
        0.07 * s,
        color,
    );
}

#[cfg(target_os = "windows")]
fn draw_headphones_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    stroke_arc(canvas, 0.5 * s, 0.5 * s, 0.23 * s, 0.08 * s, PI, 2.0 * PI, color);
    fill_rounded_rect(canvas, 0.18 * s, 0.42 * s, 0.11 * s, 0.24 * s, 0.05 * s, color);
    fill_rounded_rect(canvas, 0.71 * s, 0.42 * s, 0.11 * s, 0.24 * s, 0.05 * s, color);
}

#[cfg(target_os = "windows")]
fn draw_disconnect_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    stroke_arc(
        canvas,
        0.5 * s,
        0.80 * s,
        0.26 * s,
        0.10 * s,
        1.17 * PI,
        1.83 * PI,
        color,
    );
    fill_rounded_rect(canvas, 0.19 * s, 0.49 * s, 0.10 * s, 0.15 * s, 0.05 * s, color);
    fill_rounded_rect(canvas, 0.71 * s, 0.49 * s, 0.10 * s, 0.15 * s, 0.05 * s, color);
}

#[cfg(target_os = "windows")]
fn draw_pause_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    fill_rounded_rect(canvas, 0.28 * s, 0.20 * s, 0.13 * s, 0.60 * s, 0.04 * s, color);
    fill_rounded_rect(canvas, 0.59 * s, 0.20 * s, 0.13 * s, 0.60 * s, 0.04 * s, color);
}

#[cfg(target_os = "windows")]
fn draw_play_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    fill_triangle(
        canvas,
        (0.31 * s, 0.18 * s),
        (0.31 * s, 0.82 * s),
        (0.74 * s, 0.50 * s),
        color,
    );
}

#[cfg(target_os = "windows")]
fn draw_skip_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    fill_triangle(
        canvas,
        (0.18 * s, 0.20 * s),
        (0.18 * s, 0.80 * s),
        (0.56 * s, 0.50 * s),
        color,
    );
    fill_rounded_rect(canvas, 0.65 * s, 0.20 * s, 0.10 * s, 0.60 * s, 0.03 * s, color);
}

#[cfg(target_os = "windows")]
fn draw_separator_icon(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    fill_rounded_rect(canvas, 0.48 * s, 0.20 * s, 0.04 * s, 0.60 * s, 0.02 * s, color);
}

#[cfg(target_os = "windows")]
fn draw_slash(canvas: &mut RgbaImage, color: Rgba<u8>) {
    let s = canvas.width() as f32;
    draw_line(
        canvas,
        0.18 * s,
        0.18 * s,
        0.82 * s,
        0.82 * s,
        0.08 * s,
        color,
    );
}

#[cfg(target_os = "windows")]
fn fill_triangle(
    canvas: &mut RgbaImage,
    a: (f32, f32),
    b: (f32, f32),
    c: (f32, f32),
    color: Rgba<u8>,
) {
    let min_x = a.0.min(b.0).min(c.0).floor().max(0.0) as u32;
    let max_x = a.0.max(b.0).max(c.0).ceil().min(canvas.width() as f32) as u32;
    let min_y = a.1.min(b.1).min(c.1).floor().max(0.0) as u32;
    let max_y = a.1.max(b.1).max(c.1).ceil().min(canvas.height() as f32) as u32;

    for y in min_y..max_y {
        for x in min_x..max_x {
            let point = (x as f32 + 0.5, y as f32 + 0.5);
            if is_point_inside_triangle(point, a, b, c) {
                canvas.put_pixel(x, y, color);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn is_point_inside_triangle(
    point: (f32, f32),
    a: (f32, f32),
    b: (f32, f32),
    c: (f32, f32),
) -> bool {
    let denominator = (b.1 - c.1) * (a.0 - c.0) + (c.0 - b.0) * (a.1 - c.1);
    if denominator.abs() <= f32::EPSILON {
        return false;
    }

    let alpha =
        ((b.1 - c.1) * (point.0 - c.0) + (c.0 - b.0) * (point.1 - c.1)) / denominator;
    let beta =
        ((c.1 - a.1) * (point.0 - c.0) + (a.0 - c.0) * (point.1 - c.1)) / denominator;
    let gamma = 1.0 - alpha - beta;

    alpha >= 0.0 && beta >= 0.0 && gamma >= 0.0
}

#[cfg(target_os = "windows")]
fn fill_rounded_rect(
    canvas: &mut RgbaImage,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
    color: Rgba<u8>,
) {
    let min_x = x.floor().max(0.0) as u32;
    let max_x = (x + width).ceil().min(canvas.width() as f32) as u32;
    let min_y = y.floor().max(0.0) as u32;
    let max_y = (y + height).ceil().min(canvas.height() as f32) as u32;
    let radius = radius.max(0.0).min(width * 0.5).min(height * 0.5);
    let right = x + width;
    let bottom = y + height;
    let inner_min_x = x + radius;
    let inner_max_x = (right - radius).max(inner_min_x);
    let inner_min_y = y + radius;
    let inner_max_y = (bottom - radius).max(inner_min_y);

    for py in min_y..max_y {
        for px in min_x..max_x {
            let point_x = px as f32 + 0.5;
            let point_y = py as f32 + 0.5;
            let nearest_x = point_x.clamp(inner_min_x, inner_max_x);
            let nearest_y = point_y.clamp(inner_min_y, inner_max_y);
            let dx = point_x - nearest_x;
            let dy = point_y - nearest_y;

            if dx * dx + dy * dy <= radius * radius {
                canvas.put_pixel(px, py, color);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn draw_line(
    canvas: &mut RgbaImage,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
    thickness: f32,
    color: Rgba<u8>,
) {
    let min_x = start_x.min(end_x).floor().max(0.0) as u32;
    let max_x = (start_x.max(end_x) + thickness).ceil().min(canvas.width() as f32) as u32;
    let min_y = start_y.min(end_y).floor().max(0.0) as u32;
    let max_y = (start_y.max(end_y) + thickness).ceil().min(canvas.height() as f32) as u32;
    let radius = thickness / 2.0;

    for py in min_y..max_y {
        for px in min_x..max_x {
            let distance = distance_to_segment(
                px as f32 + 0.5,
                py as f32 + 0.5,
                start_x,
                start_y,
                end_x,
                end_y,
            );
            if distance <= radius {
                canvas.put_pixel(px, py, color);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn stroke_arc(
    canvas: &mut RgbaImage,
    center_x: f32,
    center_y: f32,
    radius: f32,
    thickness: f32,
    start_angle: f32,
    end_angle: f32,
    color: Rgba<u8>,
) {
    let min_x = (center_x - radius - thickness).floor().max(0.0) as u32;
    let max_x = (center_x + radius + thickness)
        .ceil()
        .min(canvas.width() as f32) as u32;
    let min_y = (center_y - radius - thickness).floor().max(0.0) as u32;
    let max_y = (center_y + radius + thickness)
        .ceil()
        .min(canvas.height() as f32) as u32;
    let inner_radius = (radius - (thickness / 2.0)).max(0.0);
    let outer_radius = radius + (thickness / 2.0);

    for py in min_y..max_y {
        for px in min_x..max_x {
            let dx = px as f32 + 0.5 - center_x;
            let dy = py as f32 + 0.5 - center_y;
            let distance = (dx * dx + dy * dy).sqrt();
            if distance < inner_radius || distance > outer_radius {
                continue;
            }

            let mut angle = dy.atan2(dx);
            if angle < 0.0 {
                angle += 2.0 * PI;
            }

            if is_angle_between(angle, start_angle, end_angle) {
                canvas.put_pixel(px, py, color);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn is_angle_between(angle: f32, start: f32, end: f32) -> bool {
    if start <= end {
        angle >= start && angle <= end
    } else {
        angle >= start || angle <= end
    }
}

#[cfg(target_os = "windows")]
fn distance_to_segment(px: f32, py: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let length_squared = dx * dx + dy * dy;

    if length_squared <= f32::EPSILON {
        return ((px - x1).powi(2) + (py - y1).powi(2)).sqrt();
    }

    let t = (((px - x1) * dx) + ((py - y1) * dy)) / length_squared;
    let clamped = t.clamp(0.0, 1.0);
    let nearest_x = x1 + clamped * dx;
    let nearest_y = y1 + clamped * dy;
    ((px - nearest_x).powi(2) + (py - nearest_y).powi(2)).sqrt()
}

#[cfg(target_os = "windows")]
fn canvas_to_icon(canvas: RgbaImage, icon_size: u32) -> windows::core::Result<HICON> {
    let resized = image::imageops::resize(&canvas, icon_size, icon_size, FilterType::Triangle);
    let mut bgra = Vec::with_capacity((icon_size * icon_size * 4) as usize);
    for pixel in resized.pixels() {
        let [red, green, blue, alpha] = pixel.0;
        bgra.extend([blue, green, red, alpha]);
    }

    unsafe {
        let mut bitmap_info = BITMAPV5HEADER::default();
        bitmap_info.bV5Size = size_of::<BITMAPV5HEADER>() as u32;
        bitmap_info.bV5Width = icon_size as i32;
        bitmap_info.bV5Height = -(icon_size as i32);
        bitmap_info.bV5Planes = 1;
        bitmap_info.bV5BitCount = 32;
        bitmap_info.bV5Compression = BI_BITFIELDS;
        bitmap_info.bV5RedMask = 0x00FF0000;
        bitmap_info.bV5GreenMask = 0x0000FF00;
        bitmap_info.bV5BlueMask = 0x000000FF;
        bitmap_info.bV5AlphaMask = 0xFF000000;

        let screen_dc = GetDC(None);
        let mut pixels = null_mut();
        let color_bitmap = CreateDIBSection(
            Some(screen_dc),
            &bitmap_info as *const BITMAPV5HEADER as *const BITMAPINFO,
            DIB_RGB_COLORS,
            &mut pixels,
            None,
            0,
        )?;
        let _ = ReleaseDC(None, screen_dc);

        std::ptr::copy_nonoverlapping(bgra.as_ptr(), pixels.cast::<u8>(), bgra.len());

        let mask_bitmap = CreateBitmap(icon_size as i32, icon_size as i32, 1, 1, None);
        let icon = CreateIconIndirect(&ICONINFO {
            fIcon: true.into(),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask_bitmap,
            hbmColor: color_bitmap,
        })?;

        let _ = DeleteObject(mask_bitmap.into());
        let _ = DeleteObject(color_bitmap.into());

        Ok(icon)
    }
}

pub fn setup_taskbar_thumbnail_toolbar(
    app: &tauri::App<TauriRuntime>,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };

        let hwnd = window.hwnd()?;
        let manager = THUMBNAIL_TOOLBAR_MANAGER
            .get_or_init(|| {
                Arc::new(
                    ThumbnailToolbarManager::new(
                        app.handle().clone(),
                        HWND(hwnd.0 as _),
                    )
                    .expect("failed to initialize thumbnail toolbar manager"),
                )
            })
            .clone();

        log::info!("[ThumbnailToolbar] Installing Windows taskbar thumbnail toolbar");
        manager.install_subclass()?;
        if let Err(error) = manager.apply_current_state() {
            log::warn!("[ThumbnailToolbar] Failed to apply initial toolbar state: {error}");
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn sync_taskbar_thumbnail_toolbar(state: ThumbnailToolbarState) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        log::info!(
            "[ThumbnailToolbar] Sync visible={} camera={} mic={} muted={} deafened={} media={} paused={}",
            state.visible,
            state.is_camera_on,
            state.has_microphone,
            state.is_muted,
            state.is_deafened,
            state.has_media_controls,
            state.is_media_paused
        );
        if let Some(manager) = THUMBNAIL_TOOLBAR_MANAGER.get() {
            manager.update_state(state).map_err(|error| error.to_string())?;
        } else {
            log::warn!("[ThumbnailToolbar] Ignoring sync because the toolbar manager is not ready");
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
    }

    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use image::RgbaImage;

    use super::fill_rounded_rect;

    #[test]
    fn fill_rounded_rect_handles_tiny_widths_without_panicking() {
        let mut canvas = RgbaImage::new(64, 64);

        fill_rounded_rect(
            &mut canvas,
            0.48 * 64.0,
            0.20 * 64.0,
            0.04 * 64.0,
            0.60 * 64.0,
            0.02 * 64.0,
            image::Rgba([255, 255, 255, 255]),
        );

        assert!(canvas.pixels().any(|pixel| pixel.0[3] > 0));
    }
}
