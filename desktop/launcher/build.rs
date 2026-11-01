// Embeds the app icon, version info and an asInvoker manifest so Explorer, the
// taskbar and Task Manager show "RalphMeet" with the app icon for the root stub.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../src-tauri/icons/icon.ico");
    println!("cargo:rerun-if-changed=launcher.exe.manifest");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let mut res = winresource::WindowsResource::new();
    res.set_icon("../src-tauri/icons/icon.ico")
        .set_manifest_file("launcher.exe.manifest")
        .set("FileDescription", "RalphMeet")
        .set("ProductName", "RalphMeet")
        .set("CompanyName", "115jon")
        .set("InternalName", "RalphMeet")
        .set("OriginalFilename", "RalphMeet.exe")
        .set("LegalCopyright", "Copyright © 2026 115jon");
    res.compile().expect("failed to embed launcher resources");
}
