//! `RalphMeet.exe` at the install root (`%LOCALAPPDATA%\RalphMeet`).
//!
//! Shortcuts, the Run key, the `ralphmeet://` handler and taskbar pins all
//! point here. It starts `app-<version>\RalphMeet.exe` with the caller's
//! arguments and working directory set to that version directory, then exits.
//! See docs/desktop/launch.md.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod launch;

#[cfg(windows)]
fn main() {
    std::process::exit(win::run());
}

#[cfg(not(windows))]
fn main() {
    eprintln!("ralph-meet-launcher only runs on Windows");
    std::process::exit(1);
}

#[cfg(windows)]
mod win {
    use std::ffi::OsString;
    use std::io::Write;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::process::CommandExt;
    use std::path::Path;
    use std::process::Command;

    use windows_sys::Win32::System::Environment::GetCommandLineW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, MessageBoxW, ASFW_ANY, MB_ICONERROR, MB_OK,
    };

    use crate::launch;

    const LOG_LIMIT_BYTES: u64 = 256 * 1024;

    pub fn run() -> i32 {
        let Some(root) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
        else {
            error_box("RalphMeet could not locate its install directory.");
            return 1;
        };

        let command_line = current_command_line();
        let tail = launch::command_line_tail(&command_line);

        // The shell gave this process the right to take the foreground. Pass it
        // on to whichever process ends up showing the window: the new app
        // process, or the running instance it hands off to (single-instance).
        unsafe { AllowSetForegroundWindow(ASFW_ANY) };

        let candidates = launch::candidates(&root);
        for target in &candidates {
            let args = launch::child_arguments(target.prefix_args, tail);
            let mut command = Command::new(&target.exe);
            command.current_dir(&target.dir);
            if !args.is_empty() {
                command.raw_arg(OsString::from_wide(&args));
            }
            match command.spawn() {
                Ok(child) => {
                    log(
                        &root,
                        &format!(
                            "launched {} ({:?}) pid {} with {} argument chars",
                            target.exe.display(),
                            target.source,
                            child.id(),
                            tail.len()
                        ),
                    );
                    return 0;
                }
                Err(error) => log(
                    &root,
                    &format!("failed to launch {}: {error}", target.exe.display()),
                ),
            }
        }

        log(&root, "no installed RalphMeet version could be started");
        error_box(&format!(
            "RalphMeet could not find an installed version to start in\n{}\n\nReinstall RalphMeet to repair it.",
            root.display()
        ));
        1
    }

    fn current_command_line() -> Vec<u16> {
        unsafe {
            let ptr = GetCommandLineW();
            if ptr.is_null() {
                return Vec::new();
            }
            let mut len = 0usize;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            std::slice::from_raw_parts(ptr, len).to_vec()
        }
    }

    /// One line per launch in `logs\launcher.log`, best effort. Arguments are
    /// not logged: deep links carry invite codes.
    fn log(root: &Path, message: &str) {
        let dir = root.join("logs");
        let path = dir.join("launcher.log");
        let _ = std::fs::create_dir_all(&dir);
        let too_big = std::fs::metadata(&path)
            .map(|m| m.len() > LOG_LIMIT_BYTES)
            .unwrap_or(false);
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(!too_big)
            .truncate(too_big)
            .open(&path);
        if let Ok(mut file) = file {
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = writeln!(file, "{secs} pid {} {message}", std::process::id());
        }
    }

    fn error_box(message: &str) {
        let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let caption: Vec<u16> = "RalphMeet".encode_utf16().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                caption.as_ptr(),
                MB_OK | MB_ICONERROR,
            )
        };
    }
}
