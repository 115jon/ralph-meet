use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;

/// Clerk publishable key — loaded from .env.local via build.rs.
/// This is a *public* key (pk_...) safe to embed in client code.
const CLERK_PUBLISHABLE_KEY: &str = env!("CLERK_PUBLISHABLE_KEY");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        // Clerk auth — requires http + store plugins to be registered first
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_clerk::ClerkPluginBuilder::new()
                .publishable_key(CLERK_PUBLISHABLE_KEY)
                .with_tauri_store() // persist session across restarts
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // When a second instance launches (e.g. from a deep link),
            // forward the URL to the existing instance's webview
            log::info!("Single instance callback, argv: {:?}", argv);
            for arg in &argv {
                if arg.starts_with("ralphmeet://") {
                    log::info!("Deep link from second instance: {}", arg);
                    let _ = app.emit("deep-link", arg.as_str());
                }
            }
            // Focus the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = tauri::WebviewWindow::set_focus(&window);
            }
        }))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Persist window size & position across restarts
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_window_state::Builder::default().build())?;

            // ── System tray ─────────────────────────────────────────────
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show_i = MenuItem::with_id(app, "show", "Show Ralph Meet", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Ralph Meet")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        // Left-click → show & focus the window
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                // Listen for badge updates from the frontend
                let tray_handle = app.tray_by_id("main").or_else(|| {
                    // TrayIconBuilder without an explicit id uses "main" by default
                    // but fallback to first tray
                    None
                });
                if let Some(tray) = tray_handle {
                    let tray_clone = tray.clone();
                    app.listen("update-tray-badge", move |event| {
                        if let Ok(count) = event.payload().trim_matches('"').parse::<u32>() {
                            let tooltip = if count > 0 {
                                format!("Ralph Meet — {} unread", count)
                            } else {
                                "Ralph Meet".to_string()
                            };
                            let _ = tray_clone.set_tooltip(Some(&tooltip));
                        }
                    });
                }
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
