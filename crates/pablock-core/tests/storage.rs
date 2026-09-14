use pablock_core::{vault::FaultPoint, Error, ProfileDiff, Vault};
use std::{collections::BTreeMap, fs, path::Path};
use tempfile::TempDir;
use zeroize::Zeroizing;
fn pw() -> Zeroizing<String> {
    Zeroizing::new("correct horse battery staple".into())
}
fn secret(s: &str) -> Zeroizing<String> {
    Zeroizing::new(s.into())
}
struct Fixture {
    data: TempDir,
    project: TempDir,
    vault: Vault,
    pid: String,
    profile: String,
}
impl Fixture {
    fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let mut vault = Vault::open(data.path(), pw(), true).unwrap();
        fs::write(project.path().join(".env"), "A=original-secret\nB=kept\n").unwrap();
        let pid = vault.add_project(project.path(), None).unwrap().id;
        let profile = vault.scan(&pid).unwrap()[0].id.clone();
        vault.import(&pid, &[".env".into()], false).unwrap();
        Self {
            data,
            project,
            vault,
            pid,
            profile,
        }
    }
}
#[test]
fn authentication_crud_versions_restore_history_and_encryption() {
    let mut f = Fixture::new();
    let p = &f.profile;
    assert_eq!(&*f.vault.reveal(p, "A", None).unwrap(), "original-secret");
    assert_eq!(f.vault.history(p, "A").unwrap().len(), 1);
    f.vault.import(&f.pid, &[".env".into()], false).unwrap();
    assert_eq!(f.vault.history(p, "A").unwrap().len(), 1);
    let first = f.vault.history(p, "A").unwrap()[0].id.clone();
    f.vault.set(p, "A", secret("replacement-secret")).unwrap();
    assert_eq!(f.vault.history(p, "A").unwrap().len(), 2);
    f.vault.remove_secret(p, "A").unwrap();
    assert!(matches!(
        f.vault.reveal(p, "A", None),
        Err(Error::NotFound(_))
    ));
    f.vault.restore(p, "A", &first).unwrap();
    assert_eq!(&*f.vault.reveal(p, "A", None).unwrap(), "original-secret");
    let history = f.vault.history(p, "A").unwrap();
    assert_eq!(history.len(), 4);
    assert_eq!(history[0].action, "restore");
    assert!(history[0].current);
    assert!(matches!(
        f.vault.delete_version(p, "A", &history[0].id),
        Err(Error::Conflict(_))
    ));
    f.vault.delete_version(p, "A", &first).unwrap();
    assert_eq!(f.vault.history(p, "A").unwrap().len(), 3);
    f.vault.clear_history(p, "A").unwrap();
    assert_eq!(f.vault.history(p, "A").unwrap().len(), 1);
    let summary = serde_json::to_string(&f.vault.variables(p).unwrap()).unwrap();
    assert!(!summary.contains("original-secret"));
    drop(f.vault);
    for entry in fs::read_dir(f.data.path()).unwrap() {
        let bytes = fs::read(entry.unwrap().path()).unwrap();
        assert!(!bytes.windows(15).any(|b| b == b"original-secret"));
        assert!(!bytes.windows(18).any(|b| b == b"replacement-secret"));
    }
    assert!(matches!(
        Vault::open(f.data.path(), secret("wrong"), false),
        Err(Error::Authentication)
    ));
    let reopened = Vault::open(f.data.path(), pw(), false).unwrap();
    assert_eq!(&*reopened.reveal(p, "A", None).unwrap(), "original-secret");
}
#[test]
fn password_change_and_project_deletion_remove_records() {
    let mut f = Fixture::new();
    assert!(matches!(
        f.vault
            .change_password(secret("wrong"), secret("new password")),
        Err(Error::Authentication)
    ));
    f.vault
        .change_password(pw(), secret("new password"))
        .unwrap();
    drop(f.vault);
    assert!(matches!(
        Vault::open(f.data.path(), pw(), false),
        Err(Error::Authentication)
    ));
    let mut vault = Vault::open(f.data.path(), secret("new password"), false).unwrap();
    assert_eq!(
        &*vault.reveal(&f.profile, "A", None).unwrap(),
        "original-secret"
    );
    vault.remove_project(&f.pid).unwrap();
    assert!(vault.projects().unwrap().is_empty());
    drop(vault);
    let db = rusqlite::Connection::open(f.data.path().join("pablock.db")).unwrap();
    for table in ["projects", "profiles", "versions", "variables"] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    assert!(f.project.path().join(".env").exists());
    let vault = Vault::open(f.data.path(), secret("new password"), false).unwrap();
    assert!(vault.projects().unwrap().is_empty());
}
#[test]
fn merge_replace_template_and_invalid_batch_are_transactional() {
    let mut f = Fixture::new();
    fs::write(f.project.path().join(".env"), "A=next\nC=added\n").unwrap();
    let preview = f
        .vault
        .preview_import(&f.pid, &[".env".into()], false)
        .unwrap();
    assert_eq!(preview[0].diff.changed, ["A"]);
    assert_eq!(preview[0].diff.added, ["C"]);
    assert_eq!(preview[0].diff.unchanged, ["B"]);
    f.vault.import(&f.pid, &[".env".into()], false).unwrap();
    assert!(f.vault.reveal(&f.profile, "B", None).is_ok());
    f.vault.import(&f.pid, &[".env".into()], true).unwrap();
    assert!(f.vault.reveal(&f.profile, "B", None).is_err());
    assert_eq!(
        f.vault.history(&f.profile, "B").unwrap()[0].action,
        "delete"
    );
    fs::write(
        f.project.path().join(".env.example"),
        "A=template-secret-must-not-persist\nREQUIRED=example\n",
    )
    .unwrap();
    fs::write(f.project.path().join(".env.invalid"), "bad syntax").unwrap();
    let before = f.vault.history(&f.profile, "A").unwrap().len();
    fs::write(f.project.path().join(".env"), "A=would-change\n").unwrap();
    assert!(f
        .vault
        .import(&f.pid, &[".env".into(), ".env.invalid".into()], false)
        .is_err());
    assert_eq!(f.vault.history(&f.profile, "A").unwrap().len(), before);
    f.vault
        .import(&f.pid, &[".env.example".into()], false)
        .unwrap();
    let comparison = f.vault.compare_templates(&f.profile).unwrap();
    assert_eq!(comparison[0].missing, ["REQUIRED"]);
    assert_eq!(comparison[0].extra, ["C"]);
    let template = f
        .vault
        .resolve_profile(&f.pid, Some(".env.example"))
        .unwrap();
    assert!(f.vault.set(&template.id, "A", secret("no")).is_err());
    assert!(f
        .vault
        .variables(&template.id)
        .unwrap()
        .iter()
        .all(|v| !v.has_value));
    f.vault.remove_profile(&template.id).unwrap();
    assert!(f.vault.profile(&template.id).is_err());
}
#[test]
fn export_confirmation_canonical_modes_and_path_security() {
    let mut f = Fixture::new();
    f.vault
        .set(&f.profile, "MULTI", secret("line\nquote\"${A}"))
        .unwrap();
    assert!(matches!(
        f.vault.export(&f.profile, None, false),
        Err(Error::Conflict(_))
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            f.project.path().join(".env"),
            fs::Permissions::from_mode(0o640),
        )
        .unwrap();
    }
    f.vault.export(&f.profile, None, true).unwrap();
    let text = fs::read_to_string(f.project.path().join(".env")).unwrap();
    assert!(text.starts_with("A=\""));
    assert!(text.ends_with('\n'));
    assert_eq!(
        pablock_core::dotenv::parse(&text).unwrap().values["MULTI"],
        "line\nquote\"${A}"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(f.project.path().join(".env"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        std::os::unix::fs::symlink(f.project.path().join(".env"), f.project.path().join("link"))
            .unwrap();
        assert!(f.vault.export(&f.profile, Some("link"), true).is_err());
        fs::create_dir(f.project.path().join("nested")).unwrap();
        std::os::unix::fs::symlink(
            f.project.path().join("nested"),
            f.project.path().join("parent-link"),
        )
        .unwrap();
        assert!(f
            .vault
            .export(&f.profile, Some("parent-link/out"), true)
            .is_err());
    }
    assert!(f.vault.export(&f.profile, Some("../escape"), true).is_err());
    assert!(f
        .vault
        .export(&f.profile, Some("/tmp/pablock-escape"), true)
        .is_err());
    f.vault.export(&f.profile, Some("new.env"), false).unwrap();
    assert!(f.project.path().join("new.env").exists());
}
#[test]
fn every_journal_phase_recovers_additions_and_deletions() {
    for point in [
        FaultPoint::Journal,
        FaultPoint::Store,
        FaultPoint::TemporarySnapshot,
        FaultPoint::Snapshot,
        FaultPoint::Metadata,
    ] {
        let mut f = Fixture::new();
        f.vault.inject_failure(point);
        assert!(f.vault.set(&f.profile, "A", secret("after-crash")).is_err());
        assert!(f.vault.projects().is_err());
        drop(f.vault);
        let mut v = Vault::open(f.data.path(), pw(), false).unwrap();
        let committed = matches!(point, FaultPoint::Snapshot | FaultPoint::Metadata);
        assert_eq!(
            &*v.reveal(&f.profile, "A", None).unwrap(),
            if committed {
                "after-crash"
            } else {
                "original-secret"
            }
        );
        assert_eq!(
            v.history(&f.profile, "A").unwrap().len(),
            if committed { 2 } else { 1 }
        );
        v.inject_failure(point);
        assert!(v.remove_project(&f.pid).is_err());
        drop(v);
        let v = Vault::open(f.data.path(), pw(), false).unwrap();
        assert_eq!(v.projects().unwrap().is_empty(), committed);
        drop(v);
        let db = rusqlite::Connection::open(f.data.path().join("pablock.db")).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM pending_operations", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
#[test]
fn exclusive_lock_released_on_drop() {
    let f = Fixture::new();
    assert!(matches!(
        Vault::open(f.data.path(), pw(), false),
        Err(Error::Conflict(_))
    ));
    drop(f.vault);
    assert!(Vault::open(f.data.path(), pw(), false).is_ok());
}
#[test]
fn rekey_interruption_preserves_old_snapshot_until_rename() {
    let mut f = Fixture::new();
    f.vault.inject_failure(FaultPoint::TemporarySnapshot);
    assert!(f.vault.change_password(pw(), secret("new")).is_err());
    drop(f.vault);
    let v = Vault::open(f.data.path(), pw(), false).unwrap();
    assert!(v.reveal(&f.profile, "A", None).is_ok());
}
#[test]
fn diff_merge_keeps_missing_keys_replace_removes_them() {
    let old = BTreeMap::from([("A".into(), "1".into()), ("B".into(), "2".into())]);
    let new = BTreeMap::from([("A".into(), "3".into()), ("C".into(), "4".into())]);
    let merge = ProfileDiff::between(&old, &new, false);
    assert_eq!(merge.unchanged, ["B"]);
    assert!(merge.removed.is_empty());
    let replace = ProfileDiff::between(&old, &new, true);
    assert_eq!(replace.removed, ["B"]);
}
#[test]
fn project_selection_names_paths_and_marker() {
    let mut f = Fixture::new();
    assert_eq!(
        f.vault.resolve_project(None, f.project.path()).unwrap().id,
        f.pid
    );
    f.vault.rename_project(&f.pid, "New name").unwrap();
    assert_eq!(f.vault.project(&f.pid).unwrap().name, "New name");
    f.vault.rename_profile(&f.profile, "Development").unwrap();
    assert_eq!(f.vault.profile(&f.profile).unwrap().path, ".env");
    assert!(f
        .vault
        .add_project(Path::new("/path/does/not/exist"), None)
        .is_err());
}
