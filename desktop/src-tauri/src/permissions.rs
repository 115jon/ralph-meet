// ── WebView2 media permission auto-granting ─────────────────────────────
//
// WebView2 fires a `PermissionRequested` event when web content calls
// `getUserMedia()`. Unlike a regular browser, if the host app does NOT
// handle this event, the request is **silently denied** — no prompt, no
// error, just a rejected promise.  Without a successful `getUserMedia`
// call, `enumerateDevices()` returns no usable devices.
//
// This handler intercepts those events and grants media permissions
// automatically, which is the expected behavior for a native desktop app.
//
// NOTE: Only compiled for WebView2 (non-CEF) builds on Windows.
// CEF has its own built-in PermissionHandler that auto-approves media.

// ── Runtime type ────────────────────────────────────────────────────────
// This module is only compiled for non-CEF Windows builds, so Wry is
// always the correct runtime.
#[cfg(all(target_os = "windows", not(feature = "cef")))]
type TauriRuntime = tauri::Wry;

#[cfg(all(target_os = "windows", not(feature = "cef")))]
pub fn setup_media_permissions(app: &tauri::App<TauriRuntime>) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs,
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(move |webview| {
            unsafe {
                let core = webview.controller().CoreWebView2().unwrap();

                // Create a handler that auto-allows microphone + camera
                let handler = PermissionRequestedEventHandler::create(Box::new(
                    move |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                        if let Some(args) = args {
                            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                            args.PermissionKind(&mut kind)?;
                            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                                || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                            {
                                log::info!(
                                    "[Permissions] Auto-granting media permission (kind={:?})",
                                    kind.0
                                );
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                            }
                        }
                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                let _ = core.add_PermissionRequested(&handler, &mut token as *mut i64 as *mut _);
                log::info!("[Permissions] WebView2 PermissionRequested handler registered");
            }
        });
    }
}
