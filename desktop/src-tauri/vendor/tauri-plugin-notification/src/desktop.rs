// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use serde::de::DeserializeOwned;
use tauri::{
    ipc::Channel,
    plugin::{PermissionState, PluginApi},
    AppHandle, Manager, Runtime,
};

use crate::{
    ActionType, DeliveredNotification, NotificationBuilder, NotificationData, ReceivedNotification,
};

use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[cfg(windows)]
use tauri_winrt_notification::{Duration as WinDuration, Sound as WinSound, Toast};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Notification<R>> {
    Ok(Notification {
        app: app.clone(),
        desktop_state: Arc::default(),
    })
}

type DesktopListenerMap = HashMap<String, HashMap<u32, Channel<ReceivedNotification>>>;

#[derive(Default)]
struct DesktopState {
    action_types: Mutex<HashMap<String, ActionType>>,
    listeners: Mutex<DesktopListenerMap>,
}

/// Access to the notification APIs.
pub struct Notification<R: Runtime> {
    app: AppHandle<R>,
    desktop_state: Arc<DesktopState>,
}

impl<R: Runtime> crate::NotificationBuilder<R> {
    pub fn show(self) -> crate::Result<()> {
        let delivered = DeliveredNotification::from(&self.data);
        let mut notification = imp::Notification::new(
            self.app.config().identifier.clone(),
            self.app.clone(),
            self.data,
            delivered,
        );

        if let Some(title) = notification
            .data
            .title
            .clone()
            .or_else(|| self.app.config().product_name.clone())
        {
            notification = notification.title(title);
        }

        #[cfg(feature = "windows7-compat")]
        {
            notification.notify(&self.app)?;
        }
        #[cfg(not(feature = "windows7-compat"))]
        notification.show()?;

        Ok(())
    }
}

impl<R: Runtime> Notification<R> {
    pub fn builder(&self) -> NotificationBuilder<R> {
        NotificationBuilder::new(self.app.clone())
    }

    pub fn request_permission(&self) -> crate::Result<PermissionState> {
        Ok(PermissionState::Granted)
    }

    pub fn permission_state(&self) -> crate::Result<PermissionState> {
        Ok(PermissionState::Granted)
    }

    pub fn register_action_types(&self, types: Vec<ActionType>) -> crate::Result<()> {
        let mut action_types = self.desktop_state.action_types.lock().unwrap();
        action_types.clear();
        for action_type in types {
            action_types.insert(action_type.id.clone(), action_type);
        }
        Ok(())
    }

    pub fn register_listener(
        &self,
        event: String,
        handler: Channel<ReceivedNotification>,
    ) -> crate::Result<()> {
        let mut listeners = self.desktop_state.listeners.lock().unwrap();
        listeners
            .entry(event)
            .or_default()
            .insert(handler.id(), handler);
        Ok(())
    }

    pub fn remove_listener(&self, event: &str, channel_id: u32) -> crate::Result<()> {
        let mut listeners = self.desktop_state.listeners.lock().unwrap();
        if let Some(event_listeners) = listeners.get_mut(event) {
            event_listeners.remove(&channel_id);
            if event_listeners.is_empty() {
                listeners.remove(event);
            }
        }
        Ok(())
    }
}

mod imp {
    use super::*;

    #[cfg(windows)]
    use std::path::MAIN_SEPARATOR as SEP;

    #[derive(Debug)]
    pub struct Notification<R: Runtime> {
        pub(crate) data: NotificationData,
        delivered: DeliveredNotification,
        app: AppHandle<R>,
        identifier: String,
    }

    impl<R: Runtime> Notification<R> {
        pub fn new(
            identifier: impl Into<String>,
            app: AppHandle<R>,
            data: NotificationData,
            delivered: DeliveredNotification,
        ) -> Self {
            Self {
                data,
                delivered,
                app,
                identifier: identifier.into(),
            }
        }

        #[must_use]
        pub fn title(mut self, title: impl Into<String>) -> Self {
            self.data.title = Some(title.into());
            self.delivered.title = self.data.title.clone();
            self
        }

        pub fn show(self) -> crate::Result<()> {
            #[cfg(windows)]
            return self.show_windows();

            #[cfg(not(windows))]
            return self.show_notify_rust();
        }

        #[cfg(not(windows))]
        fn show_notify_rust(self) -> crate::Result<()> {
            let mut notification = notify_rust::Notification::new();
            if let Some(body) = self.data.body.as_deref() {
                notification.body(body);
            }
            if let Some(title) = self.data.title.as_deref() {
                notification.summary(title);
            }
            if let Some(icon) = self.data.icon.as_deref() {
                notification.icon(icon);
            } else {
                notification.auto_icon();
            }
            if let Some(sound) = self.data.sound.as_deref() {
                notification.sound_name(sound);
            }

            #[cfg(target_os = "macos")]
            {
                let _ = notify_rust::set_application(if tauri::is_dev() {
                    "com.apple.Terminal"
                } else {
                    &self.identifier
                });
            }

            tauri::async_runtime::spawn(async move {
                let _ = notification.show();
            });

            Ok(())
        }

        #[cfg(windows)]
        fn show_windows(self) -> crate::Result<()> {
            let sound = self
                .data
                .sound
                .as_deref()
                .and_then(|value| value.parse::<WinSound>().ok());

            let duration = match self.data.ongoing {
                true => WinDuration::Long,
                false => WinDuration::Short,
            };

            let app_id = packaged_app_id(&self.identifier)?;
            let title = self.data.title.clone().unwrap_or_default();
            let summary = self.data.summary.clone().unwrap_or_default();
            let body = self
                .data
                .large_body
                .clone()
                .or(self.data.body.clone())
                .unwrap_or_default();

            let state = self.app.state::<super::Notification<R>>();
            let desktop_state = state.desktop_state.clone();
            let delivered = self.delivered.clone();

            let mut toast = Toast::new(&app_id)
                .title(&title)
                .text1(&summary)
                .text2(&body)
                .sound(sound)
                .duration(duration)
                .on_activated(move |argument| {
                    emit_action_event(&desktop_state, &delivered, argument);
                    Ok(())
                });

            if let Some(image_path) = resolve_windows_notification_image_path(
                &self.app,
                self.data.icon.as_deref(),
                &self.data.attachments,
            ) {
                log::info!(
                    target: "tauri_plugin_notification",
                    "Using Windows toast image path: {}",
                    image_path
                );
                toast = toast.image(Path::new(&image_path), "sender-avatar");
            } else {
                log::info!(
                    target: "tauri_plugin_notification",
                    "No usable Windows toast image resolved"
                );
            }

            if let Some(action_type_id) = self.data.action_type_id.as_deref() {
                if let Some(action_type) = state
                    .desktop_state
                    .action_types
                    .lock()
                    .unwrap()
                    .get(action_type_id)
                    .cloned()
                {
                    for action in action_type.actions {
                        toast = toast.add_button(&action.title, &action.id);
                    }
                }
            }

            match toast.show() {
                Ok(_) => {
                    log::info!(
                        target: "tauri_plugin_notification",
                        "Displayed Windows toast"
                    );
                }
                Err(error) => {
                    log::warn!(
                        target: "tauri_plugin_notification",
                        "Failed to show Windows toast: {}",
                        error
                    );
                }
            }

            Ok(())
        }

        #[cfg(feature = "windows7-compat")]
        #[allow(unused_variables)]
        pub fn notify<Rt: tauri::Runtime>(self, app: &tauri::AppHandle<Rt>) -> crate::Result<()> {
            #[cfg(windows)]
            {
                fn is_windows_7() -> bool {
                    let v = windows_version::OsVersion::current();
                    v.major == 6 && v.minor == 1
                }

                if is_windows_7() {
                    self.notify_win7(app)
                } else {
                    self.show()
                }
            }
            #[cfg(not(windows))]
            {
                self.show()
            }
        }

        #[cfg(all(windows, feature = "windows7-compat"))]
        fn notify_win7<Rt: tauri::Runtime>(self, app: &tauri::AppHandle<Rt>) -> crate::Result<()> {
            let app_ = app.clone();
            let _ = app.clone().run_on_main_thread(move || {
                let mut notification = win7_notifications::Notification::new();
                if let Some(body) = self.data.body.as_deref() {
                    notification.body(body);
                }
                if let Some(title) = self.data.title.as_deref() {
                    notification.summary(title);
                }
                if let Some(icon) = app_.default_window_icon() {
                    notification.icon(icon.rgba().to_vec(), icon.width(), icon.height());
                }
                let _ = notification.show();
            });

            Ok(())
        }
    }

    #[cfg(windows)]
    fn packaged_app_id(identifier: &str) -> crate::Result<String> {
        let exe = tauri::utils::platform::current_exe()?;
        let exe_dir = exe.parent().expect("failed to get exe directory");
        let curr_dir = exe_dir.display().to_string();
        if curr_dir.ends_with(format!("{SEP}target{SEP}debug").as_str())
            || curr_dir.ends_with(format!("{SEP}target{SEP}release").as_str())
        {
            Ok(Toast::POWERSHELL_APP_ID.to_string())
        } else {
            Ok(identifier.to_string())
        }
    }
}

#[cfg(windows)]
fn emit_action_event(
    desktop_state: &Arc<DesktopState>,
    notification: &DeliveredNotification,
    argument: Option<String>,
) {
    let action_id = argument
        .filter(|value| !value.is_empty())
        .or_else(|| Some("tap".to_string()));
    let payload = ReceivedNotification {
        action_id,
        input_value: None,
        notification: Some(notification.clone()),
    };

    let listeners = desktop_state.listeners.lock().unwrap();
    if let Some(channels) = listeners.get("actionPerformed") {
        for channel in channels.values() {
            let _ = channel.send(payload.clone());
        }
    }
}

#[cfg(windows)]
fn resolve_windows_notification_image_path(
    app: &AppHandle<impl Runtime>,
    icon: Option<&str>,
    attachments: &[crate::Attachment],
) -> Option<String> {
    if let Some(icon) = icon {
        if let Some(path) = resolve_windows_path_candidate(app, icon) {
            log::info!(
                target: "tauri_plugin_notification",
                "Resolved Windows notification image from icon"
            );
            return Some(path);
        }
        log::info!(
            target: "tauri_plugin_notification",
            "Icon was present but could not be resolved as a Windows notification image"
        );
    }

    for attachment in attachments {
        if let Some(path) = resolve_windows_attachment_path(app, attachment) {
            log::info!(
                target: "tauri_plugin_notification",
                "Resolved Windows notification image from attachment {}",
                attachment.id()
            );
            return Some(path);
        }
    }

    None
}

#[cfg(windows)]
fn resolve_windows_attachment_path(
    app: &AppHandle<impl Runtime>,
    attachment: &crate::Attachment,
) -> Option<String> {
    let url = attachment.url();
    match url.scheme() {
        "file" => url.to_file_path().ok().and_then(ensure_existing_path),
        "http" | "https" => cache_remote_image(app, url),
        _ => None,
    }
}

#[cfg(windows)]
fn resolve_windows_path_candidate(app: &AppHandle<impl Runtime>, value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(url) = url::Url::parse(trimmed) {
        return match url.scheme() {
            "file" => url.to_file_path().ok().and_then(ensure_existing_path),
            "asset" => resolve_asset_local_path(url.path()),
            "http" | "https" => cache_remote_image(app, &url),
            _ => None,
        };
    }

    ensure_existing_path(PathBuf::from(trimmed))
}

#[cfg(windows)]
fn resolve_asset_local_path(raw_path: &str) -> Option<String> {
    let trimmed = raw_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }

    let decoded = percent_decode(trimmed);
    ensure_existing_path(PathBuf::from(decoded))
}

#[cfg(windows)]
fn percent_decode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(hex as char);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index] as char);
        index += 1;
    }

    out
}

#[cfg(windows)]
fn ensure_existing_path(path: PathBuf) -> Option<String> {
    let canonical = fs::canonicalize(path).ok()?;
    canonical.to_str().map(|value| value.to_string())
}

#[cfg(windows)]
fn cache_remote_image(app: &AppHandle<impl Runtime>, url: &url::Url) -> Option<String> {
    let cache_dir = notification_image_cache_dir(app)?;
    let file_path = cache_dir.join(stable_cached_filename(url));

    if let Some(existing) = ensure_existing_path(file_path.clone()) {
        log::info!(
            target: "tauri_plugin_notification",
            "Using cached Windows notification image for {} at {}",
            url,
            existing
        );
        return Some(existing);
    }

    log::info!(
        target: "tauri_plugin_notification",
        "Downloading Windows notification image from {} to {}",
        url,
        file_path.display()
    );

    if let Some(parent) = file_path.parent() {
        if fs::create_dir_all(parent).is_err() {
            log::warn!(
                target: "tauri_plugin_notification",
                "Failed to create notification image cache directory: {}",
                parent.display()
            );
            return None;
        }
    }

    let mut response = match ureq::get(url.as_str()).call() {
        Ok(response) => response,
        Err(error) => {
            log::warn!(
                target: "tauri_plugin_notification",
                "Failed to download notification image {}: {}",
                url,
                error
            );
            return None;
        }
    };

    let bytes = match response.body_mut().read_to_vec() {
        Ok(bytes) => bytes,
        Err(error) => {
            log::warn!(
                target: "tauri_plugin_notification",
                "Failed to read downloaded notification image {}: {}",
                url,
                error
            );
            return None;
        }
    };

    let decoded = match image::load_from_memory(&bytes) {
        Ok(decoded) => decoded,
        Err(error) => {
            log::warn!(
                target: "tauri_plugin_notification",
                "Failed to decode downloaded notification image {}: {}",
                url,
                error
            );
            return None;
        }
    };

    let mut encoded = Cursor::new(Vec::new());
    if decoded
        .write_to(&mut encoded, image::ImageFormat::Png)
        .is_err()
    {
        log::warn!(
            target: "tauri_plugin_notification",
            "Failed to encode downloaded notification image {} as PNG",
            url
        );
        return None;
    }

    if fs::write(&file_path, encoded.into_inner()).is_err() {
        log::warn!(
            target: "tauri_plugin_notification",
            "Failed to persist downloaded notification image: {}",
            file_path.display()
        );
        return None;
    }

    ensure_existing_path(file_path)
}

#[cfg(windows)]
fn notification_image_cache_dir(app: &AppHandle<impl Runtime>) -> Option<PathBuf> {
    if let Ok(path) = app.path().app_local_data_dir() {
        return Some(path.join("notification-images"));
    }

    app.path()
        .temp_dir()
        .ok()
        .map(|path| path.join("notification-images"))
}

#[cfg(windows)]
fn stable_cached_filename(url: &url::Url) -> String {
    let hash = stable_url_hash_hex(url.as_str());
    let stem = safe_windows_filename(
        url.path_segments()
            .and_then(|segments| segments.last())
            .unwrap_or("image"),
    );
    let base = Path::new(&stem)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("image");

    format!("{}-{}.png", base, hash)
}

#[cfg(windows)]
fn stable_url_hash_hex(value: &str) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    format!("{hash:016x}")
}

#[cfg(windows)]
fn safe_windows_filename(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control() {
            sanitized.push('_');
        } else {
            sanitized.push(ch);
        }
    }

    let trimmed = sanitized.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        percent_decode, safe_windows_filename, stable_cached_filename, stable_url_hash_hex,
    };

    #[test]
    fn decodes_percent_encoded_asset_paths() {
        assert_eq!(
            percent_decode("C%3A/Users/Jon/avatar%20one.png"),
            "C:/Users/Jon/avatar one.png"
        );
    }

    #[test]
    fn sanitizes_windows_cached_filenames() {
        assert_eq!(
            safe_windows_filename("avatar:name?.png"),
            "avatar_name_.png"
        );
    }

    #[test]
    fn builds_stable_cached_png_name() {
        let url = url::Url::parse("https://example.com/path/avatar:name?.png?token=abc").unwrap();
        assert_eq!(
            stable_cached_filename(&url),
            format!("avatar_name_-{}.png", stable_url_hash_hex(url.as_str()))
        );
    }
}
