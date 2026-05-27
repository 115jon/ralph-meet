fn main() {
    println!("cargo:rerun-if-changed=../../.env.local");
    sync_cef_runtime_from_env();
    tauri_build::build()
}

#[cfg(all(windows, feature = "cef"))]
fn sync_cef_runtime_from_env() {
    use std::{env, fs, path::PathBuf};

    let Ok(cef_path) = env::var("CEF_PATH") else {
        return;
    };
    let Ok(out_dir) = env::var("OUT_DIR") else {
        return;
    };

    let source = PathBuf::from(cef_path);
    if !source.join("libcef.dll").is_file() {
        println!(
            "cargo:warning=CEF_PATH does not contain libcef.dll: {}",
            source.display()
        );
        return;
    }

    let Some(profile_dir) = PathBuf::from(out_dir)
        .ancestors()
        .nth(3)
        .map(PathBuf::from)
    else {
        return;
    };

    for entry in CEF_RUNTIME_FILES {
        let src = source.join(entry);
        let dest = profile_dir.join(entry);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if src.is_file() {
            if let Err(error) = fs::copy(&src, &dest) {
                println!(
                    "cargo:warning=Failed to copy CEF runtime file {} -> {}: {}",
                    src.display(),
                    dest.display(),
                    error
                );
            }
        }
    }

    let source_locales = source.join("locales");
    let dest_locales = profile_dir.join("locales");
    if source_locales.is_dir() {
        let _ = fs::create_dir_all(&dest_locales);
        if let Ok(entries) = fs::read_dir(source_locales) {
            for entry in entries.flatten() {
                let src = entry.path();
                if src.is_file() {
                    let dest = dest_locales.join(entry.file_name());
                    let _ = fs::copy(src, dest);
                }
            }
        }
    }

    println!("cargo:rerun-if-env-changed=CEF_PATH");
    println!("cargo:warning=Synced CEF runtime from {}", source.display());
}

#[cfg(not(all(windows, feature = "cef")))]
fn sync_cef_runtime_from_env() {}

#[cfg(all(windows, feature = "cef"))]
const CEF_RUNTIME_FILES: &[&str] = &[
    "bootstrap.exe",
    "bootstrapc.exe",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "chrome_elf.dll",
    "d3dcompiler_47.dll",
    "dxcompiler.dll",
    "dxil.dll",
    "icudtl.dat",
    "libcef.dll",
    "libEGL.dll",
    "libGLESv2.dll",
    "resources.pak",
    "v8_context_snapshot.bin",
    "vk_swiftshader.dll",
    "vk_swiftshader_icd.json",
    "vulkan-1.dll",
];
