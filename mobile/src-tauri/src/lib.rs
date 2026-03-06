// ── Ralph Meet Mobile — Tauri application entry point ────────────────────
//
// Mobile-specific entry point that shares the same Clerk auth flow and
// plugin stack as the desktop app, but without:
//   - CEF runtime (uses Android System WebView via Wry)
//   - Screen capture / xcap (Android uses native getDisplayMedia)
//   - System tray (not applicable on mobile)
//   - Win32 API calls (dark title bar, window transparency hack)
//   - Autostart / window state / updater (use Play Store)

use tauri::Emitter;
use tauri::Listener;

/// Clerk publishable key — loaded from .env.local via build.rs.
/// This is a *public* key (pk_...) safe to embed in client code.
const CLERK_PUBLISHABLE_KEY: &str = env!("CLERK_PUBLISHABLE_KEY");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install the rustls ring crypto provider before anything touches TLS.
    // Without this, reqwest (used by tauri-plugin-clerk) panics with "No provider set".
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_status_bar_color::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_edge_to_edge::init())
        // Clerk auth — requires http + store plugins to be registered first
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_clerk::ClerkPluginBuilder::new()
                .publishable_key(CLERK_PUBLISHABLE_KEY)
                .with_tauri_store() // persist session across restarts
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Listen for deep link events (ralphmeet://auth?token=...)
            // and forward them to the webview as a custom event
            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                log::info!("Deep link received: {:?}", event.payload());
                // Forward to all webviews — the frontend handles token extraction
                let _ = handle.emit("deep-link", event.payload());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
