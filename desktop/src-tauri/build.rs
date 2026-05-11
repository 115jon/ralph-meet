fn main() {
    println!("cargo:rerun-if-changed=../../.env.local");
    tauri_build::build()
}
