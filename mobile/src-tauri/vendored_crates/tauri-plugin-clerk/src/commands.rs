use crate::ClerkExt;
use clerk_fapi_rs::models::{ClientClient, ClientEnvironment};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

/// Need to keep in sync with ClerkInitResponse in
/// guest-js/sync.ts
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClerkInitResponse {
    environment: ClientEnvironment,
    client: ClientClient,
    publishable_key: String,
    // TODO: DomainOrProxyUrl
    /* ts side
    export type DomainOrProxyUrl =
      | {
          /**
           * **Required for applications that run behind a reverse proxy**. The URL that Clerk will proxy requests to. Can be either a relative path (`/__clerk`) or a full URL (`https://<your-domain>/__clerk`).
           */
          proxyUrl?: never;
          /**
           * **Required if your application is a satellite application**. Sets the domain of the satellite application.
           */
          domain?: string | ((url: URL) => string);
        }
      | {
          proxyUrl?: string | ((url: URL) => string);
          domain?: never;
        };
    */
}

/// Authorization header to be injected in clerk-js __unstable__onBeforeRequest
#[tauri::command]
pub(crate) async fn get_client_authorization_header<R: Runtime>(
    app: AppHandle<R>,
) -> Option<String> {
    app.clerk().get_client_authorization_header()
}

/// Authorization header read in __unstable__onAfterResponse
#[tauri::command]
pub(crate) async fn set_client_authorization_header<R: Runtime>(
    app: AppHandle<R>,
    header: Option<String>,
) -> () {
    app.clerk().set_client_authorization_header(header)
}

#[tauri::command]
pub(crate) async fn initialize<R: Runtime>(app: AppHandle<R>) -> Result<ClerkInitResponse, String> {
    app.ensure_clerk_initialized().await?;
    let client = app.clerk().client().map_err(|e| e.to_string())?;
    let environment = app.clerk().environment().map_err(|e| e.to_string())?;
    let publishable_key = app.clerk_store().publishable_key;

    Ok(ClerkInitResponse {
        environment,
        client,
        publishable_key,
    })
}

// ── FAPI Proxy ──────────────────────────────────────────────────────────────
//
// Proxies Clerk FAPI requests through reqwest on the Rust side, completely
// bypassing the WebView. This solves the Origin+Authorization header collision:
// the WebView always injects `Origin: http://tauri.localhost` on cross-origin
// requests, and Clerk's FAPI rejects requests with both Origin and Authorization.
// By making the HTTP request from Rust, no Origin header is added.

/// Request payload from the JS side
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FapiProxyRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

/// Response payload sent back to JS
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FapiProxyResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// Proxy a Clerk FAPI request through reqwest, bypassing the WebView entirely.
/// This avoids the Origin header injection from the Android WebView/Tauri plugin-http.
#[tauri::command]
pub(crate) async fn fapi_proxy(
    req: FapiProxyRequest,
) -> Result<FapiProxyResponse, String> {
    let client = reqwest::Client::new();

    let method: reqwest::Method = req.method.parse().map_err(|e: http::method::InvalidMethod| {
        format!("Invalid HTTP method '{}': {}", req.method, e)
    })?;

    let mut builder = client.request(method, &req.url);

    // Forward headers, explicitly excluding Origin and internal flags
    for (key, value) in &req.headers {
        let lower = key.to_lowercase();
        if lower == "origin" || lower == "x-tauri-fetch" || lower == "x-no-origin" {
            continue;
        }
        builder = builder.header(key.as_str(), value.as_str());
    }

    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|e| format!("FAPI proxy request failed: {}", e))?;

    let status = response.status().as_u16();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = response.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(FapiProxyResponse {
        status,
        headers,
        body,
    })
}
