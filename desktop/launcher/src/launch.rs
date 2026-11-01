//! Which installed `RalphMeet.exe` the root stub starts, and with what command line.
//!
//! Pure logic (file system reads only) so it can be unit tested on any host.
//! The install root layout is owned by the installer (`desktop/installer/InstallRootLayout.cs`).

use std::cmp::Ordering;
use std::path::{Path, PathBuf};

pub const APP_EXE: &str = "RalphMeet.exe";
pub const UPDATE_EXE: &str = "Update.exe";
pub const STATE_FILE: &str = "current.json";
pub const VERSION_PREFIX: &str = "app-";
/// Arguments the legacy `Update.exe` launcher needs before the caller's own.
pub const UPDATE_EXE_ARGS: &str = "--processStart RalphMeet.exe";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// `currentVersion` from `current.json`.
    CurrentJson,
    /// An `app-<semver>` directory, highest first.
    Scan,
    /// `Update.exe --processStart RalphMeet.exe`, the pre-stub launcher.
    UpdateExe,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub exe: PathBuf,
    pub dir: PathBuf,
    /// Arguments placed before the caller's own (only set for `Update.exe`).
    pub prefix_args: &'static str,
    pub source: Source,
}

/// Every launch target under `root`, in the order the stub should try them:
/// the version named by `current.json`, then each other valid `app-<semver>`
/// directory from highest to lowest, then `Update.exe`.
pub fn candidates(root: &Path) -> Vec<Target> {
    let mut targets = Vec::new();

    let current = std::fs::read_to_string(root.join(STATE_FILE))
        .ok()
        .and_then(|json| json_string_field(&json, "currentVersion"))
        .map(|version| version.trim().to_string())
        .filter(|version| is_safe_version(version));
    if let Some(version) = &current {
        let dir = root.join(format!("{VERSION_PREFIX}{version}"));
        if dir.join(APP_EXE).is_file() {
            targets.push(app_target(dir, Source::CurrentJson));
        }
    }

    let mut scanned: Vec<(Version, String)> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let version = parse_version(name.strip_prefix(VERSION_PREFIX)?)?;
            Some((version, name))
        })
        .filter(|(_, name)| root.join(name).join(APP_EXE).is_file())
        .collect();
    scanned.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, name) in scanned {
        let dir = root.join(&name);
        if !targets.iter().any(|t| same_dir(&t.dir, &dir)) {
            targets.push(app_target(dir, Source::Scan));
        }
    }

    let update_exe = root.join(UPDATE_EXE);
    if update_exe.is_file() {
        targets.push(Target {
            exe: update_exe,
            dir: root.to_path_buf(),
            prefix_args: UPDATE_EXE_ARGS,
            source: Source::UpdateExe,
        });
    }

    targets
}

fn app_target(dir: PathBuf, source: Source) -> Target {
    Target {
        exe: dir.join(APP_EXE),
        dir,
        prefix_args: "",
        source,
    }
}

fn same_dir(a: &Path, b: &Path) -> bool {
    a.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
}

/// The child's argument string: the target's prefix, then the caller's
/// arguments exactly as they were passed to the stub.
pub fn child_arguments(prefix: &str, caller_tail: &[u16]) -> Vec<u16> {
    let mut args: Vec<u16> = prefix.encode_utf16().collect();
    if !args.is_empty() && !caller_tail.is_empty() {
        args.push(u16::from(b' '));
    }
    args.extend_from_slice(caller_tail);
    args
}

/// Everything after argv[0] in a Windows command line, unparsed, so quoting
/// and deep-link URLs pass through byte for byte. argv[0] follows the
/// `CommandLineToArgvW` rule: quoted up to the next `"`, otherwise up to the
/// first space or tab, with no escape processing.
pub fn command_line_tail(command_line: &[u16]) -> &[u16] {
    const QUOTE: u16 = b'"' as u16;
    const SPACE: u16 = b' ' as u16;
    const TAB: u16 = b'\t' as u16;

    let rest = match command_line.first() {
        Some(&QUOTE) => {
            let body = &command_line[1..];
            match body.iter().position(|&c| c == QUOTE) {
                Some(end) => &body[end + 1..],
                None => &[],
            }
        }
        _ => match command_line.iter().position(|&c| c == SPACE || c == TAB) {
            Some(end) => &command_line[end..],
            None => &[],
        },
    };

    let start = rest
        .iter()
        .position(|&c| c != SPACE && c != TAB)
        .unwrap_or(rest.len());
    &rest[start..]
}

/// A version string that is safe to splice into `app-<version>`.
pub fn is_safe_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && !version.contains("..")
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_'))
}

// ── current.json ─────────────────────────────────────────────────────────

/// Reads one top-level string field from a JSON object. Returns `None` for
/// malformed JSON or a non-string value; the caller falls back to scanning.
pub fn json_string_field(json: &str, key: &str) -> Option<String> {
    let mut p = Parser {
        chars: json.trim_start_matches('\u{feff}').chars().peekable(),
    };
    p.ws();
    p.expect('{')?;
    loop {
        p.ws();
        if p.peek()? == '}' {
            return None;
        }
        let name = p.string()?;
        p.ws();
        p.expect(':')?;
        p.ws();
        if name == key {
            return if p.peek()? == '"' { p.string() } else { None };
        }
        p.skip_value()?;
        p.ws();
        match p.next()? {
            ',' => continue,
            _ => return None,
        }
    }
}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl Parser<'_> {
    fn peek(&mut self) -> Option<char> {
        self.chars.peek().copied()
    }

    fn next(&mut self) -> Option<char> {
        self.chars.next()
    }

    fn ws(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\r' | '\n')) {
            self.chars.next();
        }
    }

    fn expect(&mut self, c: char) -> Option<()> {
        (self.next()? == c).then_some(())
    }

    fn string(&mut self) -> Option<String> {
        self.expect('"')?;
        let mut out = String::new();
        loop {
            match self.next()? {
                '"' => return Some(out),
                '\\' => match self.next()? {
                    '"' => out.push('"'),
                    '\\' => out.push('\\'),
                    '/' => out.push('/'),
                    'b' => out.push('\u{8}'),
                    'f' => out.push('\u{c}'),
                    'n' => out.push('\n'),
                    'r' => out.push('\r'),
                    't' => out.push('\t'),
                    'u' => {
                        let mut code = 0u32;
                        for _ in 0..4 {
                            code = code * 16 + self.next()?.to_digit(16)?;
                        }
                        out.push(char::from_u32(code).unwrap_or('\u{fffd}'));
                    }
                    _ => return None,
                },
                c => out.push(c),
            }
        }
    }

    fn skip_value(&mut self) -> Option<()> {
        match self.peek()? {
            '"' => self.string().map(|_| ()),
            '{' | '[' => {
                let mut depth = 0usize;
                loop {
                    match self.peek()? {
                        '"' => {
                            self.string()?;
                            continue;
                        }
                        '{' | '[' => depth += 1,
                        '}' | ']' => {
                            depth -= 1;
                            if depth == 0 {
                                self.next();
                                return Some(());
                            }
                        }
                        _ => {}
                    }
                    self.next();
                }
            }
            _ => {
                while !matches!(self.peek()?, ',' | '}' | ']' | ' ' | '\t' | '\r' | '\n') {
                    self.next();
                }
                Some(())
            }
        }
    }
}

// ── Semantic versions ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    core: (u64, u64, u64),
    pre: Vec<Ident>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Ident {
    // Declared first: numeric identifiers sort below alphanumeric ones.
    Num(u64),
    Alpha(String),
}

/// `MAJOR.MINOR.PATCH[-pre][+build]`; build metadata is ignored.
pub fn parse_version(text: &str) -> Option<Version> {
    let text = text.split_once('+').map_or(text, |(v, _)| v);
    let (core, pre) = match text.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (text, None),
    };

    let mut parts = core.split('.').map(parse_number);
    let core = (parts.next()??, parts.next()??, parts.next()??);
    if parts.next().is_some() {
        return None;
    }

    let pre = match pre {
        None => Vec::new(),
        Some(pre) => pre
            .split('.')
            .map(|id| {
                if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    None
                } else if let Some(n) = parse_number(id) {
                    Some(Ident::Num(n))
                } else {
                    Some(Ident::Alpha(id.to_string()))
                }
            })
            .collect::<Option<Vec<_>>>()?,
    };

    Some(Version { core, pre })
}

fn parse_number(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        self.core
            .cmp(&other.core)
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => self.pre.cmp(&other.pre),
            })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ralph-launcher-{name}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn app(&self, version: &str) -> PathBuf {
            let dir = self.0.join(format!("app-{version}"));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(APP_EXE), b"exe").unwrap();
            dir
        }

        fn state(&self, json: &str) {
            fs::write(self.0.join(STATE_FILE), json).unwrap();
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn narrow(s: &[u16]) -> String {
        String::from_utf16(s).unwrap()
    }

    fn sources(targets: &[Target]) -> Vec<(String, Source)> {
        targets
            .iter()
            .map(|t| {
                let dir = t.dir.file_name().unwrap().to_string_lossy().into_owned();
                (dir, t.source)
            })
            .collect()
    }

    #[test]
    fn current_json_version_comes_first() {
        let root = TempRoot::new("current");
        root.app("3.4.0");
        let current = root.app("3.5.0");
        root.app("3.6.0-beta.1");
        root.state(
            r#"{"activatedAtUtc":"2026-11-01T00:00:00.0000000Z","currentVersion":"3.5.0","previousVersion":"3.4.0"}"#,
        );

        let targets = candidates(&root.0);
        assert_eq!(targets[0].exe, current.join(APP_EXE));
        assert_eq!(targets[0].dir, current);
        assert_eq!(targets[0].source, Source::CurrentJson);
        assert_eq!(targets[0].prefix_args, "");
        // Scan order after it, without repeating the current version.
        assert_eq!(
            sources(&targets[1..]),
            vec![
                ("app-3.6.0-beta.1".into(), Source::Scan),
                ("app-3.4.0".into(), Source::Scan)
            ]
        );
    }

    #[test]
    fn missing_or_corrupt_state_falls_back_to_highest_semver() {
        for state in [
            None,
            Some("{not json"),
            Some(""),
            Some(r#"{"currentVersion":3}"#),
        ] {
            let root = TempRoot::new("corrupt");
            root.app("3.9.0");
            root.app("3.10.0");
            root.app("3.10.0-rc.1");
            if let Some(state) = state {
                root.state(state);
            }

            let targets = candidates(&root.0);
            assert_eq!(
                sources(&targets),
                vec![
                    ("app-3.10.0".into(), Source::Scan),
                    ("app-3.10.0-rc.1".into(), Source::Scan),
                    ("app-3.9.0".into(), Source::Scan),
                ],
                "state {state:?}"
            );
        }
    }

    #[test]
    fn state_pointing_at_missing_or_unsafe_version_is_ignored() {
        for version in ["9.9.9", "..\\..\\Windows", "a/b", "3.5.0\\..\\x"] {
            let root = TempRoot::new("stale");
            root.app("3.5.0");
            // JSON-escape the backslashes.
            let escaped = version.replace('\\', "\\\\");
            root.state(&format!(r#"{{"currentVersion":"{escaped}"}}"#));
            let targets = candidates(&root.0);
            assert_eq!(
                sources(&targets),
                vec![("app-3.5.0".into(), Source::Scan)],
                "{version}"
            );
        }
    }

    #[test]
    fn version_dirs_without_an_exe_or_semver_name_are_skipped() {
        let root = TempRoot::new("skip");
        fs::create_dir_all(root.0.join("app-4.0.0")).unwrap(); // no exe
        root.app("not-a-version");
        root.app("3.2");
        fs::create_dir_all(root.0.join("staging").join("app-5.0.0")).unwrap();
        let ok = root.app("3.1.0");
        let targets = candidates(&root.0);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].dir, ok);
    }

    #[test]
    fn update_exe_is_the_last_resort() {
        let root = TempRoot::new("update");
        fs::write(root.0.join(UPDATE_EXE), b"exe").unwrap();
        let targets = candidates(&root.0);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].source, Source::UpdateExe);
        assert_eq!(targets[0].exe, root.0.join(UPDATE_EXE));
        assert_eq!(targets[0].dir, root.0);
        assert_eq!(targets[0].prefix_args, "--processStart RalphMeet.exe");

        root.app("3.5.0");
        let targets = candidates(&root.0);
        assert_eq!(targets.last().unwrap().source, Source::UpdateExe);
        assert_eq!(targets[0].source, Source::Scan);
    }

    #[test]
    fn empty_root_has_no_candidates() {
        let root = TempRoot::new("empty");
        assert!(candidates(&root.0).is_empty());
        assert!(candidates(&root.0.join("missing")).is_empty());
    }

    #[test]
    fn command_line_tail_keeps_caller_arguments_verbatim() {
        let cases = [
            (
                r#""C:\Users\a b\RalphMeet\RalphMeet.exe" "ralphmeet://invite/abc?x=1&y=2""#,
                r#""ralphmeet://invite/abc?x=1&y=2""#,
            ),
            (r#""C:\RalphMeet\RalphMeet.exe""#, ""),
            (
                r#""C:\RalphMeet\RalphMeet.exe"   --autostart  --minimized"#,
                "--autostart  --minimized",
            ),
            (
                r#"C:\RalphMeet\RalphMeet.exe --flag "quoted \" arg""#,
                r#"--flag "quoted \" arg""#,
            ),
            (r#"RalphMeet.exe"#, ""),
            ("RalphMeet.exe\tralphmeet://x", "ralphmeet://x"),
            (r#""unterminated"#, ""),
            ("", ""),
        ];
        for (command_line, tail) in cases {
            assert_eq!(
                narrow(command_line_tail(&wide(command_line))),
                tail,
                "{command_line}"
            );
        }
    }

    #[test]
    fn child_arguments_prefix_and_passthrough() {
        let tail = wide(r#""ralphmeet://invite/abc""#);
        assert_eq!(
            narrow(&child_arguments("", &tail)),
            r#""ralphmeet://invite/abc""#
        );
        assert_eq!(
            narrow(&child_arguments(UPDATE_EXE_ARGS, &tail)),
            r#"--processStart RalphMeet.exe "ralphmeet://invite/abc""#
        );
        assert_eq!(
            narrow(&child_arguments(UPDATE_EXE_ARGS, &[])),
            UPDATE_EXE_ARGS
        );
        assert!(child_arguments("", &[]).is_empty());
    }

    #[test]
    fn json_field_reader() {
        let json = "\u{feff} { \"pendingCleanup\" : [\"app-1.0.0\", {\"x\":\"}\"}], \"n\": -1.5e3, \"ok\": true,\n \"currentVersion\" : \"3.5.0\" }";
        assert_eq!(
            json_string_field(json, "currentVersion").as_deref(),
            Some("3.5.0")
        );
        assert_eq!(
            json_string_field(r#"{"a":"\u0033\/x"}"#, "a").as_deref(),
            Some("3/x")
        );
        assert_eq!(json_string_field(r#"{"a":"1"}"#, "currentVersion"), None);
        assert_eq!(
            json_string_field(r#"{"currentVersion":null}"#, "currentVersion"),
            None
        );
        assert_eq!(
            json_string_field(r#"["currentVersion","3.5.0"]"#, "currentVersion"),
            None
        );
        assert_eq!(
            json_string_field(r#"{"currentVersion":"3.5"#, "currentVersion"),
            None
        );
        // A key nested in another value does not count.
        assert_eq!(
            json_string_field(r#"{"x":{"currentVersion":"1.0.0"}}"#, "currentVersion"),
            None
        );
    }

    #[test]
    fn semver_ordering() {
        let ordered = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
            "1.0.1",
            "1.2.0",
            "1.10.0",
            "10.0.0",
        ];
        for pair in ordered.windows(2) {
            let (a, b) = (
                parse_version(pair[0]).unwrap(),
                parse_version(pair[1]).unwrap(),
            );
            assert!(a < b, "{} < {}", pair[0], pair[1]);
        }
        assert_eq!(parse_version("1.0.0+build.5"), parse_version("1.0.0"));
        for bad in [
            "",
            "1",
            "1.2",
            "1.2.3.4",
            "v1.2.3",
            "1.2.x",
            "1.2.3-",
            "1.2.3-a..b",
            "-1.2.3",
        ] {
            assert!(parse_version(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn safe_version_names() {
        for ok in ["3.5.0", "3.6.0-beta.1", "1.0.0+build_7"] {
            assert!(is_safe_version(ok), "{ok}");
        }
        for bad in ["", "..", "1..2", "a/b", "a\\b", "C:x", "3.5.0 ", "x\"y"] {
            assert!(!is_safe_version(bad), "{bad}");
        }
    }
}
