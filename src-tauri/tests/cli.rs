use assert_cmd::{cargo::cargo_bin_cmd, Command};
use predicates::prelude::*;
use serde_json::Value;
use std::fs;
use tempfile::TempDir;
struct Fixture {
    data: TempDir,
    project: TempDir,
}
impl Fixture {
    fn command(&self, args: &[&str], input: &str) -> Command {
        let mut c = cargo_bin_cmd!("pablock");
        c.env("XDG_DATA_HOME", self.data.path())
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .current_dir(self.project.path())
            .args(args)
            .write_stdin(input);
        c
    }
    fn new() -> Self {
        let f = Self {
            data: tempfile::tempdir().unwrap(),
            project: tempfile::tempdir().unwrap(),
        };
        fs::write(f.project.path().join(".env"), "TOKEN=initial\n").unwrap();
        f.command(&["vault", "init", "--password-stdin"], "master\n")
            .assert()
            .success();
        f.command(&["project", "add", "--password-stdin"], "master\n")
            .assert()
            .success();
        f.command(&["import", ".env", "--yes", "--password-stdin"], "master\n")
            .assert()
            .success();
        f
    }
}
#[test]
fn headless_help_status_and_usage_exit_codes() {
    let f = Fixture {
        data: tempfile::tempdir().unwrap(),
        project: tempfile::tempdir().unwrap(),
    };
    f.command(&["--help"], "")
        .assert()
        .success()
        .stdout(predicate::str::contains("secret"));
    f.command(&["vault", "status", "--json"], "")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"initialized\":false"));
    f.command(&["secret", "set", "KEY", "secret-in-argument"], "")
        .assert()
        .code(2);
}
#[test]
fn combined_stdin_redaction_reveal_and_json() {
    let f = Fixture::new();
    let value = "line one\nline two\n";
    f.command(
        &[
            "secret",
            "set",
            "TOKEN",
            "--password-stdin",
            "--value-stdin",
        ],
        &format!("master\n{value}"),
    )
    .assert()
    .success();
    f.command(
        &["secret", "get", "TOKEN", "--password-stdin", "--json"],
        "master\n",
    )
    .assert()
    .success()
    .stdout(predicate::str::contains("redacted"))
    .stdout(predicate::str::contains("line one").not());
    f.command(
        &["secret", "get", "TOKEN", "--password-stdin", "--reveal"],
        "master\n",
    )
    .assert()
    .success()
    .stdout(value);
    let out = f
        .command(
            &[
                "secret",
                "get",
                "TOKEN",
                "--password-stdin",
                "--reveal",
                "--json",
            ],
            "master\n",
        )
        .output()
        .unwrap();
    let parsed: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(parsed["value"], value);
    f.command(
        &["secret", "list", "--password-stdin", "--json"],
        "master\n",
    )
    .assert()
    .success()
    .stdout(predicate::str::contains("line one").not());
    f.command(&["secret", "get", "TOKEN", "--password-stdin"], "wrong\n")
        .assert()
        .code(3);
    f.command(
        &["secret", "get", "MISSING", "--password-stdin"],
        "master\n",
    )
    .assert()
    .code(4);
}
#[test]
fn confirmation_history_and_password_protocol() {
    let f = Fixture::new();
    f.command(&["export", "--password-stdin"], "master\n")
        .assert()
        .code(5);
    f.command(&["import", ".env", "--password-stdin"], "master\n")
        .assert()
        .code(5);
    f.command(&["export", "--password-stdin", "--yes"], "master\n")
        .assert()
        .success();
    let out = f
        .command(
            &["secret", "history", "TOKEN", "--password-stdin", "--json"],
            "master\n",
        )
        .output()
        .unwrap();
    let history: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert!(history[0].get("value").is_none());
    f.command(
        &["vault", "passwd", "--password-stdin"],
        "master\nnew-master\n",
    )
    .assert()
    .success();
    f.command(&["secret", "get", "TOKEN", "--password-stdin"], "master\n")
        .assert()
        .code(3);
    f.command(
        &["secret", "get", "TOKEN", "--password-stdin"],
        "new-master\n",
    )
    .assert()
    .success();
}
#[test]
fn process_lock_and_profile_selection() {
    let f = Fixture::new();
    let dir = f.data.path().join("pablock");
    let vault =
        pablock_core::Vault::open(&dir, zeroize::Zeroizing::new("master".into()), false).unwrap();
    f.command(&["project", "list", "--password-stdin"], "master\n")
        .assert()
        .code(5);
    drop(vault);
    fs::write(f.project.path().join(".env.production"), "TOKEN=prod\n").unwrap();
    f.command(&["scan", "--password-stdin"], "master\n")
        .assert()
        .success();
    f.command(&["secret", "list", "--password-stdin"], "master\n")
        .assert()
        .code(2);
    f.command(
        &["secret", "list", "--profile", ".env", "--password-stdin"],
        "master\n",
    )
    .assert()
    .success();
}

#[test]
fn usage_errors_are_json_and_do_not_echo_accidental_secret_arguments() {
    let f = Fixture {
        data: tempfile::tempdir().unwrap(),
        project: tempfile::tempdir().unwrap(),
    };
    let out = f
        .command(&["secret", "set", "KEY", "accidental-secret", "--json"], "")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let error: Value = serde_json::from_slice(&out.stderr).unwrap();
    assert_eq!(error["error"]["code"], 2);
    assert!(!String::from_utf8(out.stderr)
        .unwrap()
        .contains("accidental-secret"));
}

#[test]
fn appimage_cli_restores_the_callers_working_directory() {
    let f = Fixture::new();
    f.command(
        &["secret", "get", "TOKEN", "--password-stdin", "--reveal"],
        "master\n",
    )
    .current_dir(f.data.path())
    .env("APPIMAGE", "/tmp/test.AppImage")
    .env(
        "APPDIR",
        assert_cmd::cargo::cargo_bin!("pablock").parent().unwrap(),
    )
    .env("OWD", f.project.path())
    .assert()
    .success()
    .stdout("initial");
}

#[test]
fn native_cli_ignores_appimage_environment_inherited_from_an_editor() {
    let f = Fixture::new();
    f.command(
        &["secret", "get", "TOKEN", "--password-stdin", "--reveal"],
        "master\n",
    )
    .env("APPIMAGE", "/tmp/editor.AppImage")
    .env("APPDIR", f.data.path())
    .env("OWD", f.data.path())
    .assert()
    .success()
    .stdout("initial");
}
