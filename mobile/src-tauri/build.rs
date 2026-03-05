fn main() {
    // Load .env.local from the project root so Rust's env!() macro
    // can read CLERK_PUBLISHABLE_KEY at compile time.
    let env_path = std::path::Path::new("../../.env.local");
    if env_path.exists() {
        dotenvy::from_path(env_path).ok();
    }

    // Forward VITE_CLERK_PUBLISHABLE_KEY → CLERK_PUBLISHABLE_KEY for env!()
    if let Ok(key) = std::env::var("VITE_CLERK_PUBLISHABLE_KEY") {
        println!("cargo:rustc-env=CLERK_PUBLISHABLE_KEY={}", key);
    } else if std::env::var("CLERK_PUBLISHABLE_KEY").is_err() {
        panic!(
            "CLERK_PUBLISHABLE_KEY (or VITE_CLERK_PUBLISHABLE_KEY) must be set.\n\
             Add it to .env.local or set it in the environment."
        );
    }

    // Re-run if the env file changes
    println!("cargo:rerun-if-changed=../../.env.local");

    tauri_build::build()
}
