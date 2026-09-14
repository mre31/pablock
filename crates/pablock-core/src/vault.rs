use crate::{discovery, dotenv, model::*};
use argon2::{Algorithm, Argon2, Params, Version};
use fs2::FileExt;
use iota_stronghold::{Client, KeyProvider, SnapshotPath, Stronghold};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};

const CLIENT: &[u8] = b"pablock-v1";
const COMMIT: &[u8] = b"__commit";
const MIGRATION_1: &str = include_str!("schema.sql");
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn sh<T>(r: std::result::Result<T, iota_stronghold::ClientError>) -> Result<T> {
    r.map_err(|_| Error::Io("Stronghold operation failed".into()))
}
fn key(password: Zeroizing<String>, salt: &[u8]) -> Result<KeyProvider> {
    let mut bytes = Zeroizing::new(vec![0u8; 32]);
    let params = Params::new(65536, 3, 1, Some(32))
        .map_err(|_| Error::Io("Invalid KDF parameters".into()))?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut bytes)
        .map_err(|_| Error::Io("Password derivation failed".into()))?;
    KeyProvider::try_from(bytes).map_err(|_| Error::Io("Key protection failed".into()))
}
fn private_file(path: &Path) -> Result<File> {
    let mut o = OpenOptions::new();
    o.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    Ok(o.open(path)?)
}
fn sync_dir(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultPoint {
    Journal,
    Store,
    TemporarySnapshot,
    Snapshot,
    Metadata,
}
#[derive(Serialize, Deserialize)]
struct Statement {
    sql: String,
    args: Vec<Option<String>>,
}
fn stmt(sql: &str, args: &[&str]) -> Statement {
    Statement {
        sql: sql.into(),
        args: args.iter().map(|s| Some((*s).to_string())).collect(),
    }
}
#[derive(Serialize, Deserialize)]
struct Operation {
    id: String,
    statements: Vec<Statement>,
}
/// One process owns the vault until this object is dropped. Secrets never enter SQLite.
pub struct Vault {
    dir: PathBuf,
    db: Connection,
    stronghold: Stronghold,
    client: Client,
    key: KeyProvider,
    _lock: File,
    poisoned: bool,
    fault: Option<FaultPoint>,
}
impl Drop for Vault {
    fn drop(&mut self) {
        if let Ok(keys) = self.client.store().keys() {
            for k in keys {
                if let Ok(Some(mut v)) = self.client.store().delete(&k) {
                    v.zeroize();
                }
            }
        }
        let _ = self.stronghold.clear();
    }
}
impl Vault {
    pub fn data_dir() -> Result<PathBuf> {
        directories::ProjectDirs::from("com", "pablock", "pablock")
            .map(|d| d.data_dir().to_path_buf())
            .ok_or_else(|| Error::Io("Cannot determine application data directory".into()))
    }
    pub fn initialized(dir: &Path) -> bool {
        dir.join("pablock.hold").is_file()
    }
    pub fn open(dir: &Path, password: Zeroizing<String>, initialize: bool) -> Result<Self> {
        // The snapshot key has already been strengthened with Argon2id. Disable
        // Stronghold's additional password-oriented scrypt pass for 32-byte keys.
        iota_stronghold::engine::snapshot::try_set_encrypt_work_factor(0)
            .map_err(|_| Error::Io("Cannot configure snapshot encryption".into()))?;
        fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
        }
        let lock = private_file(&dir.join("pablock.lock"))?;
        FileExt::try_lock_exclusive(&lock).map_err(|_| {
            Error::Conflict(
                "Vault is in use by another process. Lock or close the other Pablock window first."
                    .into(),
            )
        })?;
        let exists = Self::initialized(dir);
        if initialize && exists {
            return Err(Error::Conflict("Vault already exists".into()));
        }
        if !initialize && !exists {
            return Err(Error::NotFound(
                "Vault is not initialized; use vault init".into(),
            ));
        }
        let salt_path = dir.join("salt");
        if initialize {
            if password.is_empty() {
                return Err(Error::Usage("Password cannot be empty".into()));
            }
            let mut salt = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut salt);
            let mut f = private_file(&salt_path)?;
            f.set_len(0)?;
            f.write_all(&salt)?;
            f.sync_all()?;
        }
        let salt = fs::read(&salt_path)?;
        if salt.len() != 32 {
            return Err(Error::Io("Invalid vault salt".into()));
        }
        let key = key(password, &salt)?;
        let stronghold = Stronghold::default();
        let client = if initialize {
            sh(stronghold.create_client(CLIENT))?
        } else {
            stronghold
                .load_client_from_snapshot(
                    CLIENT,
                    &key,
                    &SnapshotPath::from_path(dir.join("pablock.hold")),
                )
                .map_err(|_| Error::Authentication)?
        };
        private_file(&dir.join("pablock.db"))?;
        let db = Connection::open(dir.join("pablock.db"))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;")?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > 1 {
            return Err(Error::Usage(
                "Vault schema is newer than this application".into(),
            ));
        }
        if version == 0 {
            db.execute_batch(MIGRATION_1)?;
        }
        let mut vault = Self {
            dir: dir.to_path_buf(),
            db,
            stronghold,
            client,
            key,
            _lock: lock,
            poisoned: false,
            fault: None,
        };
        if initialize {
            vault.persist(None)?;
        }
        vault.recover()?;
        let temp = dir.join("pablock.hold.tmp");
        if temp.exists() {
            fs::remove_file(temp)?;
        }
        Ok(vault)
    }
    /// Test seam for a simulated process interruption; never exposed through IPC or CLI.
    pub fn inject_failure(&mut self, point: FaultPoint) {
        self.fault = Some(point);
    }
    fn checkpoint(&mut self, p: FaultPoint) -> Result<()> {
        if self.fault == Some(p) {
            self.fault = None;
            return Err(Error::Io(
                "Simulated interrupted write; reopen vault".into(),
            ));
        }
        Ok(())
    }
    fn ready(&self) -> Result<()> {
        if self.poisoned {
            Err(Error::Io(
                "A write was interrupted. Lock and reopen the vault to recover.".into(),
            ))
        } else {
            Ok(())
        }
    }
    fn persist(&mut self, replacement: Option<&KeyProvider>) -> Result<()> {
        let tmp = self.dir.join("pablock.hold.tmp");
        // Stronghold requires a missing destination when writing a new snapshot.
        if tmp.exists() {
            fs::remove_file(&tmp)?;
        }
        sh(self.stronghold.commit_with_keyprovider(
            &SnapshotPath::from_path(&tmp),
            replacement.unwrap_or(&self.key),
        ))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        }
        File::open(&tmp)?.sync_all()?;
        self.checkpoint(FaultPoint::TemporarySnapshot)?;
        fs::rename(tmp, self.dir.join("pablock.hold"))?;
        sync_dir(&self.dir)?;
        Ok(())
    }
    fn apply(&mut self, op: &Operation) -> Result<()> {
        let tx = self.db.transaction()?;
        for s in &op.statements {
            tx.execute(&s.sql, rusqlite::params_from_iter(s.args.iter()))?;
        }
        tx.execute("DELETE FROM pending_operations WHERE id=?1", [&op.id])?;
        tx.commit()?;
        Ok(())
    }
    fn recover(&mut self) -> Result<()> {
        let ops: Vec<String> = self
            .db
            .prepare("SELECT payload FROM pending_operations ORDER BY rowid")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        let committed = sh(self.client.store().get(COMMIT))?;
        for payload in ops {
            let op: Operation = serde_json::from_str(&payload)?;
            if committed.as_deref() == Some(op.id.as_bytes()) {
                self.apply(&op)?;
            } else {
                self.db
                    .execute("DELETE FROM pending_operations WHERE id=?1", [&op.id])?;
            }
        }
        Ok(())
    }
    fn commit(
        &mut self,
        statements: Vec<Statement>,
        puts: Vec<(String, Zeroizing<String>)>,
        deletes: Vec<String>,
    ) -> Result<()> {
        self.ready()?;
        let op = Operation {
            id: id(),
            statements,
        };
        self.poisoned = true;
        self.db.execute(
            "INSERT INTO pending_operations(id,payload) VALUES(?1,?2)",
            params![op.id, serde_json::to_string(&op)?],
        )?;
        self.checkpoint(FaultPoint::Journal)?;
        for (k, v) in puts {
            sh(self
                .client
                .store()
                .insert(k.into_bytes(), v.as_bytes().to_vec(), None))?;
        }
        for k in deletes {
            if let Some(mut v) = sh(self.client.store().delete(k.as_bytes()))? {
                v.zeroize();
            }
        }
        if let Some(mut old) =
            sh(self
                .client
                .store()
                .insert(COMMIT.to_vec(), op.id.as_bytes().to_vec(), None))?
        {
            old.zeroize();
        }
        self.checkpoint(FaultPoint::Store)?;
        self.persist(None)?;
        self.checkpoint(FaultPoint::Snapshot)?;
        self.apply(&op)?;
        self.checkpoint(FaultPoint::Metadata)?;
        self.poisoned = false;
        Ok(())
    }
    pub fn change_password(
        &mut self,
        current: Zeroizing<String>,
        new: Zeroizing<String>,
    ) -> Result<()> {
        self.ready()?;
        if new.is_empty() {
            return Err(Error::Usage("Password cannot be empty".into()));
        }
        let salt = fs::read(self.dir.join("salt"))?;
        let old = key(current, &salt)?;
        let verifier = Stronghold::default();
        verifier
            .load_client_from_snapshot(
                CLIENT,
                &old,
                &SnapshotPath::from_path(self.dir.join("pablock.hold")),
            )
            .map_err(|_| Error::Authentication)?;
        // Clear temporary plaintext store before dropping the verification client.
        if let Ok(c) = verifier.get_client(CLIENT) {
            for k in sh(c.store().keys())? {
                if let Some(mut v) = sh(c.store().delete(&k))? {
                    v.zeroize();
                }
            }
        }
        sh(verifier.clear())?;
        let replacement = key(new, &salt)?;
        self.poisoned = true;
        self.persist(Some(&replacement))?;
        self.key = replacement;
        self.poisoned = false;
        Ok(())
    }
    pub fn projects(&self) -> Result<Vec<Project>> {
        self.ready()?;
        Ok(self
            .db
            .prepare("SELECT id,name,root,created_at,updated_at FROM projects ORDER BY name,root")?
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    root: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?)
    }
    pub fn project(&self, selector: &str) -> Result<Project> {
        let canonical = Path::new(selector)
            .canonicalize()
            .ok()
            .and_then(|p| p.to_str().map(str::to_string));
        self.projects()?
            .into_iter()
            .find(|p| p.id == selector || Some(&p.root) == canonical.as_ref())
            .ok_or_else(|| Error::NotFound("Project not found".into()))
    }
    pub fn resolve_project(&self, selector: Option<&str>, cwd: &Path) -> Result<Project> {
        if let Some(s) = selector {
            return self.project(s);
        }
        let root = discovery::find_root(cwd)?;
        if root.join(".pablock.toml").is_file() {
            let marker = discovery::read_marker(&root.join(".pablock.toml"))?;
            let project = self.project(&marker.project_id)?;
            if Path::new(&project.root) != root {
                return Err(Error::Conflict(
                    "Project moved or marker copied. Add the project at its new path.".into(),
                ));
            }
            Ok(project)
        } else {
            self.project(
                root.to_str()
                    .ok_or_else(|| Error::Usage("Paths must be UTF-8".into()))?,
            )
        }
    }
    pub fn add_project(&mut self, path: &Path, name: Option<&str>) -> Result<Project> {
        self.ready()?;
        let root = path.canonicalize()?;
        if !root.is_dir() {
            return Err(Error::Usage("Project root must be a directory".into()));
        }
        let root_str = root
            .to_str()
            .ok_or_else(|| Error::Usage("Paths must be UTF-8".into()))?;
        if let Ok(p) = self.project(root_str) {
            return Ok(p);
        }
        let marker_path = root.join(".pablock.toml");
        let marker = if marker_path.exists() {
            discovery::checked_path(&root, &marker_path, false)?;
            discovery::read_marker(&marker_path)?
        } else {
            discovery::Marker {
                schema_version: 1,
                project_id: id(),
            }
        };
        if self.projects()?.iter().any(|p| p.id == marker.project_id) {
            return Err(Error::Conflict(
                "Marker belongs to a different registered path".into(),
            ));
        }
        let name = name.unwrap_or_else(|| {
            root.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Project")
        });
        validate_name(name)?;
        // The marker is safe to leave after an interrupted registration; retry adopts its UUID.
        if !marker_path.exists() {
            let mut f = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&marker_path)?;
            f.write_all(
                format!(
                    "schema_version = 1\nproject_id = \"{}\"\n",
                    marker.project_id
                )
                .as_bytes(),
            )?;
            f.sync_all()?;
        }
        let time = now();
        self.commit(
            vec![stmt(
                "INSERT INTO projects VALUES(?1,?2,?3,?4,?4)",
                &[&marker.project_id, name, root_str, &time],
            )],
            vec![],
            vec![],
        )?;
        self.project(&marker.project_id)
    }
    pub fn rename_project(&mut self, project: &str, name: &str) -> Result<()> {
        self.project(project)?;
        validate_name(name)?;
        self.commit(
            vec![stmt(
                "UPDATE projects SET name=?2,updated_at=?3 WHERE id=?1",
                &[project, name, &now()],
            )],
            vec![],
            vec![],
        )
    }
    pub fn remove_project(&mut self, project: &str) -> Result<()> {
        self.project(project)?;
        let keys = self.db.prepare("SELECT v.id FROM versions v JOIN profiles p ON p.id=v.profile_id WHERE p.project_id=?1")?.query_map([project], |r| r.get(0))?.collect::<std::result::Result<Vec<String>,_>>()?;
        self.commit(
            vec![stmt("DELETE FROM projects WHERE id=?1", &[project])],
            vec![],
            keys,
        )
    }
    pub fn profiles(&self, project: &str) -> Result<Vec<Profile>> {
        self.project(project)?;
        Ok(self.db.prepare("SELECT id,project_id,path,name,kind FROM profiles WHERE project_id=?1 ORDER BY path")?.query_map([project], profile_row)?.collect::<std::result::Result<_,_>>()?)
    }
    pub fn profile(&self, profile: &str) -> Result<Profile> {
        self.ready()?;
        self.db
            .query_row(
                "SELECT id,project_id,path,name,kind FROM profiles WHERE id=?1",
                [profile],
                profile_row,
            )
            .optional()?
            .ok_or_else(|| Error::NotFound("Profile not found".into()))
    }
    pub fn resolve_profile(&self, project: &str, selector: Option<&str>) -> Result<Profile> {
        let profiles = self.profiles(project)?;
        if let Some(s) = selector {
            profiles
                .into_iter()
                .find(|p| p.id == s || p.path == s)
                .ok_or_else(|| Error::NotFound("Profile not found".into()))
        } else if profiles.len() == 1 {
            Ok(profiles[0].clone())
        } else {
            Err(Error::Usage(
                "Select a profile with --profile <relative-path-or-id>".into(),
            ))
        }
    }
    fn profile_insert(
        project: &str,
        path: &str,
        kind: &ProfileKind,
        profile_id: &str,
    ) -> Statement {
        stmt(
            "INSERT INTO profiles(id,project_id,path,name,kind) VALUES(?1,?2,?3,?3,?4)",
            &[
                profile_id,
                project,
                path,
                if *kind == ProfileKind::Template {
                    "template"
                } else {
                    "secret"
                },
            ],
        )
    }
    pub fn scan(&mut self, project: &str) -> Result<Vec<Profile>> {
        let p = self.project(project)?;
        let found = discovery::scan(Path::new(&p.root))?;
        let current = self.profiles(project)?;
        let mut statements = Vec::new();
        for (path, kind) in found {
            let existing = current.iter().find(|p| p.path == path);
            let pid = existing.map(|p| p.id.clone()).unwrap_or_else(id);
            if existing.is_none() {
                statements.push(Self::profile_insert(project, &path, &kind, &pid));
            }
            if kind == ProfileKind::Template {
                let content = Zeroizing::new(fs::read_to_string(Path::new(&p.root).join(&path))?);
                let parsed = dotenv::parse(&content)?;
                statements.push(stmt(
                    "DELETE FROM template_keys WHERE profile_id=?1",
                    &[&pid],
                ));
                for k in parsed.values.keys() {
                    statements.push(stmt("INSERT INTO template_keys VALUES(?1,?2)", &[&pid, k]));
                }
            }
        }
        if !statements.is_empty() {
            self.commit(statements, vec![], vec![])?;
        }
        self.profiles(project)
    }
    pub fn rename_profile(&mut self, profile: &str, name: &str) -> Result<()> {
        self.profile(profile)?;
        validate_name(name)?;
        self.commit(
            vec![stmt(
                "UPDATE profiles SET name=?2 WHERE id=?1",
                &[profile, name],
            )],
            vec![],
            vec![],
        )
    }
    pub fn remove_profile(&mut self, profile: &str) -> Result<()> {
        self.profile(profile)?;
        let keys = self.version_ids(profile)?;
        self.commit(
            vec![stmt("DELETE FROM profiles WHERE id=?1", &[profile])],
            vec![],
            keys,
        )
    }
    fn version_ids(&self, profile: &str) -> Result<Vec<String>> {
        Ok(self
            .db
            .prepare("SELECT id FROM versions WHERE profile_id=?1")?
            .query_map([profile], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    }
    pub fn variables(&self, profile: &str) -> Result<Vec<VariableSummary>> {
        let p = self.profile(profile)?;
        if p.kind == ProfileKind::Template {
            return Ok(self
                .template_keys(profile)?
                .into_iter()
                .map(|key| VariableSummary {
                    key,
                    has_value: false,
                    updated_at: String::new(),
                })
                .collect());
        }
        Ok(self.db.prepare("SELECT a.key,v.has_value,a.updated_at FROM variables a JOIN versions v ON v.id=a.current_id WHERE a.profile_id=?1 ORDER BY a.key")?.query_map([profile], |r| Ok(VariableSummary { key:r.get(0)?, has_value:r.get(1)?, updated_at:r.get(2)? }))?.collect::<std::result::Result<_,_>>()?)
    }
    fn secret_profile(&self, profile: &str) -> Result<Profile> {
        let p = self.profile(profile)?;
        if p.kind == ProfileKind::Template {
            Err(Error::Usage("Templates contain key names only".into()))
        } else {
            Ok(p)
        }
    }
    fn current_id(&self, profile: &str, key: &str) -> Result<Option<String>> {
        Ok(self
            .db
            .query_row(
                "SELECT current_id FROM variables WHERE profile_id=?1 AND key=?2",
                params![profile, key],
                |r| r.get(0),
            )
            .optional()?)
    }
    pub fn reveal(
        &self,
        profile: &str,
        key: &str,
        version: Option<&str>,
    ) -> Result<Zeroizing<String>> {
        self.secret_profile(profile)?;
        let vid = match version {
            Some(v) => v.to_owned(),
            None => self
                .current_id(profile, key)?
                .ok_or_else(|| Error::NotFound("Variable not found".into()))?,
        };
        let exists: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM versions WHERE id=?1 AND profile_id=?2 AND key=?3 AND has_value=1)",params![vid,profile,key],|r|r.get(0))?;
        if !exists {
            return Err(Error::NotFound("This version has no value".into()));
        }
        let bytes = Zeroizing::new(
            sh(self.client.store().get(vid.as_bytes()))?
                .ok_or_else(|| Error::Io("Secret record missing from snapshot".into()))?,
        );
        let value =
            std::str::from_utf8(&bytes).map_err(|_| Error::Io("Secret is not UTF-8".into()))?;
        Ok(Zeroizing::new(value.to_string()))
    }
    fn values(&self, profile: &str) -> Result<SecretMap> {
        let mut values = SecretMap::default();
        for v in self.variables(profile)?.into_iter().filter(|v| v.has_value) {
            values.0.insert(
                v.key.clone(),
                self.reveal(profile, &v.key, None)?.to_string(),
            );
        }
        Ok(values)
    }
    fn version_statements(
        profile: &str,
        key: &str,
        vid: &str,
        has_value: bool,
        action: &str,
        source: &str,
    ) -> Vec<Statement> {
        let time = now();
        vec![stmt("INSERT INTO versions(id,profile_id,key,action,source,created_at,has_value) VALUES(?1,?2,?3,?4,?5,?6,?7)", &[vid,profile,key,action,source,&time,if has_value {"1"} else {"0"}]), stmt("INSERT INTO variables(profile_id,key,current_id,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(profile_id,key) DO UPDATE SET current_id=excluded.current_id,updated_at=excluded.updated_at", &[profile,key,vid,&time])]
    }
    pub fn set(&mut self, profile: &str, key: &str, value: Zeroizing<String>) -> Result<()> {
        self.secret_profile(profile)?;
        if !dotenv::valid_key(key) {
            return Err(Error::Usage("Invalid variable name".into()));
        }
        let vid = id();
        self.commit(
            Self::version_statements(profile, key, &vid, true, "set", "manual"),
            vec![(vid, value)],
            vec![],
        )
    }
    pub fn remove_secret(&mut self, profile: &str, key: &str) -> Result<()> {
        self.reveal(profile, key, None)?;
        let vid = id();
        self.commit(
            Self::version_statements(profile, key, &vid, false, "delete", "manual"),
            vec![],
            vec![],
        )
    }
    pub fn history(&self, profile: &str, key: &str) -> Result<Vec<VersionSummary>> {
        self.secret_profile(profile)?;
        if self.current_id(profile, key)?.is_none() {
            return Err(Error::NotFound("Variable not found".into()));
        }
        Ok(self.db.prepare("SELECT v.id,v.key,v.action,v.source,v.created_at,v.has_value,v.id=a.current_id FROM versions v JOIN variables a ON a.profile_id=v.profile_id AND a.key=v.key WHERE v.profile_id=?1 AND v.key=?2 ORDER BY v.rowid DESC")?.query_map(params![profile,key],|r| Ok(VersionSummary{id:r.get(0)?,key:r.get(1)?,action:r.get(2)?,source:r.get(3)?,created_at:r.get(4)?,has_value:r.get(5)?,current:r.get(6)?}))?.collect::<std::result::Result<_,_>>()?)
    }
    pub fn restore(&mut self, profile: &str, key: &str, version: &str) -> Result<()> {
        let v = self
            .history(profile, key)?
            .into_iter()
            .find(|v| v.id == version)
            .ok_or_else(|| Error::NotFound("Version not found".into()))?;
        let vid = id();
        let puts = if v.has_value {
            vec![(vid.clone(), self.reveal(profile, key, Some(version))?)]
        } else {
            vec![]
        };
        self.commit(
            Self::version_statements(profile, key, &vid, v.has_value, "restore", version),
            puts,
            vec![],
        )
    }
    pub fn delete_version(&mut self, profile: &str, key: &str, version: &str) -> Result<()> {
        let v = self
            .history(profile, key)?
            .into_iter()
            .find(|v| v.id == version)
            .ok_or_else(|| Error::NotFound("Version not found".into()))?;
        if v.current {
            return Err(Error::Conflict(
                "The current version cannot be deleted".into(),
            ));
        }
        self.commit(
            vec![stmt("DELETE FROM versions WHERE id=?1", &[version])],
            vec![],
            vec![version.into()],
        )
    }
    pub fn clear_history(&mut self, profile: &str, key: &str) -> Result<()> {
        let versions = self.history(profile, key)?;
        let ids: Vec<_> = versions
            .into_iter()
            .filter(|v| !v.current)
            .map(|v| v.id)
            .collect();
        if ids.is_empty() {
            return Ok(());
        }
        self.commit(
            ids.iter()
                .map(|v| stmt("DELETE FROM versions WHERE id=?1", &[v]))
                .collect(),
            vec![],
            ids,
        )
    }
    fn template_keys(&self, profile: &str) -> Result<BTreeSet<String>> {
        Ok(self
            .db
            .prepare("SELECT key FROM template_keys WHERE profile_id=?1 ORDER BY key")?
            .query_map([profile], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    }
    pub fn compare_templates(&self, profile: &str) -> Result<Vec<TemplateComparison>> {
        let p = self.secret_profile(profile)?;
        let actual: BTreeSet<_> = self
            .variables(profile)?
            .into_iter()
            .filter(|v| v.has_value)
            .map(|v| v.key)
            .collect();
        let mut out = Vec::new();
        for t in self
            .profiles(&p.project_id)?
            .into_iter()
            .filter(|t| t.kind == ProfileKind::Template)
        {
            let expected = self.template_keys(&t.id)?;
            out.push(TemplateComparison {
                template: t.path,
                missing: expected.difference(&actual).cloned().collect(),
                extra: actual.difference(&expected).cloned().collect(),
            });
        }
        Ok(out)
    }
    pub fn prepare_import(&self, project: &str, files: &[String], replace: bool) -> Result<PreparedImport> {
        let p = self.project(project)?;
        let profiles = self.profiles(project)?;
        let mut previews = Vec::new(); let mut parsed_files = Vec::new(); let mut seen = BTreeSet::new();
        if files.is_empty() { return Err(Error::Usage("Select at least one dotenv file".into())); }
        for file in files {
            let path = discovery::relative(Path::new(&p.root), Path::new(file))?;
            if !seen.insert(path.clone()) { return Err(Error::Usage("Duplicate import path".into())); }
            let kind = discovery::classify(Path::new(&path)).ok_or_else(|| Error::Usage("Import expects a .env or .env.* file".into()))?;
            let input = read_project_file(&p.root, &Path::new(&p.root).join(&path))?;
            let mut parsed = dotenv::parse(&input)?;
            let existing = profiles.iter().find(|q| q.path == path);
            let diff = if kind == ProfileKind::Template {
                // Discard template values immediately, including from the pending preview.
                for value in parsed.values.values_mut() { value.zeroize(); }
                let old = existing.map(|q| self.template_keys(&q.id)).transpose()?.unwrap_or_default().into_iter().map(|k| (k,String::new())).collect();
                ProfileDiff::between(&old,&parsed.values,true)
            } else {
                let old = existing.map(|q|self.values(&q.id)).transpose()?.unwrap_or_default();
                ProfileDiff::between(&old.0,&parsed.values,replace)
            };
            previews.push(ImportPreview { path,kind,diff,warnings:parsed.warnings.clone() }); parsed_files.push(parsed);
        }
        Ok(PreparedImport { project:project.into(), files:files.to_vec(), replace, revision:sh(self.client.store().get(COMMIT))?, previews, parsed_files })
    }
    pub fn preview_import(&self, project: &str, files: &[String], replace: bool) -> Result<Vec<ImportPreview>> {
        Ok(self.prepare_import(project,files,replace)?.previews)
    }
    pub fn import(&mut self, project: &str, files: &[String], replace: bool) -> Result<Vec<ImportPreview>> {
        let prepared=self.prepare_import(project,files,replace)?; self.import_prepared(prepared)
    }
    pub fn import_prepared(&mut self, prepared: PreparedImport) -> Result<Vec<ImportPreview>> {
        self.ready()?;
        if sh(self.client.store().get(COMMIT))? != prepared.revision { return Err(Error::Conflict("Vault changed since preview; preview the import again".into())); }
        let profiles=self.profiles(&prepared.project)?; let mut statements=Vec::new(); let mut puts=Vec::new();
        for (preview,parsed) in prepared.previews.iter().zip(&prepared.parsed_files) {
            let existing=profiles.iter().find(|q|q.path==preview.path); let pid=existing.map(|q|q.id.clone()).unwrap_or_else(id);
            if existing.is_none() { statements.push(Self::profile_insert(&prepared.project,&preview.path,&preview.kind,&pid)); }
            if preview.kind==ProfileKind::Template {
                statements.push(stmt("DELETE FROM template_keys WHERE profile_id=?1", &[&pid]));
                for k in parsed.values.keys() { statements.push(stmt("INSERT INTO template_keys VALUES(?1,?2)",&[&pid,k])); }
            } else {
                for k in preview.diff.added.iter().chain(&preview.diff.changed) {
                    let vid=id(); statements.extend(Self::version_statements(&pid,k,&vid,true,"import",&preview.path)); puts.push((vid,Zeroizing::new(parsed.values[k].clone())));
                }
                for k in &preview.diff.removed { statements.extend(Self::version_statements(&pid,k,&id(),false,"delete",&preview.path)); }
            }
        }
        if !statements.is_empty() { self.commit(statements,puts,vec![])?; } Ok(prepared.previews)
    }
    fn export_target(&self, profile: &str, target: Option<&str>) -> Result<PathBuf> {
        let p=self.secret_profile(profile)?; let project=self.project(&p.project_id)?;
        discovery::checked_path(Path::new(&project.root),Path::new(target.unwrap_or(&p.path)),true)
    }
    pub fn prepare_export(&self, profile: &str, target: Option<&str>) -> Result<PreparedExport> {
        let path=self.export_target(profile,target)?;
        let root=self.project(&self.profile(profile)?.project_id)?.root;
        let original=if path.exists() { Some(read_project_file(&root,&path)?) } else { None };
        let old=dotenv::parse(original.as_deref().map(|s|s.as_str()).unwrap_or(""))?;
        let values=self.values(profile)?; let diff=ProfileDiff::between(&old.values,&values.0,true);
        Ok(PreparedExport { profile:profile.into(), target:target.map(str::to_string), root,path,original,content:Zeroizing::new(dotenv::encode(&values.0)),diff,revision:sh(self.client.store().get(COMMIT))? })
    }
    pub fn disk_diff(&self, profile: &str, target: Option<&str>) -> Result<ProfileDiff> { Ok(self.prepare_export(profile,target)?.diff) }
    pub fn export(&self, profile: &str, target: Option<&str>, overwrite: bool) -> Result<ProfileDiff> { self.export_prepared(self.prepare_export(profile,target)?,overwrite) }
    pub fn export_prepared(&self, prepared: PreparedExport, overwrite: bool) -> Result<ProfileDiff> {
        self.ready()?;
        if sh(self.client.store().get(COMMIT))? != prepared.revision { return Err(Error::Conflict("Vault changed since preview; compare again".into())); }
        if prepared.original.is_some() && !overwrite { return Err(Error::Conflict("Destination exists; confirmation or --yes is required".into())); }
        discovery::checked_path(Path::new(&prepared.root),&prepared.path,true)?;
        let mut file=open_project_file(&prepared.root,&prepared.path,if prepared.original.is_some() { FileMode::Overwrite } else { FileMode::Create })?;
        if let Some(original)=prepared.original {
            let mut current=Zeroizing::new(String::new()); file.read_to_string(&mut current)?;
            if *current!=*original { return Err(Error::Conflict("Destination changed since preview; compare again".into())); }
        }
        file.rewind()?; file.set_len(0)?; file.write_all(prepared.content.as_bytes())?; file.sync_all()?; Ok(prepared.diff)
    }

}
fn profile_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
    Ok(Profile {
        id: r.get(0)?,
        project_id: r.get(1)?,
        path: r.get(2)?,
        name: r.get(3)?,
        kind: if r.get::<_, String>(4)? == "template" {
            ProfileKind::Template
        } else {
            ProfileKind::Secret
        },
    })
}
fn validate_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
        Err(Error::Usage(
            "Name must contain 1–256 characters without control characters".into(),
        ))
    } else {
        Ok(())
    }
}
#[derive(Default)]
struct SecretMap(BTreeMap<String, String>);
impl Drop for SecretMap {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            value.zeroize();
        }
    }
}
pub struct PreparedImport {
    pub project: String, pub files: Vec<String>, pub replace: bool,
    revision: Option<Vec<u8>>, pub previews: Vec<ImportPreview>, parsed_files: Vec<dotenv::Parsed>,
}
pub struct PreparedExport {
    pub profile: String, pub target: Option<String>, root: String, path: PathBuf,
    original: Option<Zeroizing<String>>, content: Zeroizing<String>, pub diff: ProfileDiff, revision: Option<Vec<u8>>,
}
impl PreparedExport { pub fn destination_exists(&self) -> bool { self.original.is_some() } }
enum FileMode { Read, Overwrite, Create }
fn read_project_file(root: &str, path: &Path) -> Result<Zeroizing<String>> {
    let mut f=open_project_file(root,path,FileMode::Read)?; let mut text=Zeroizing::new(String::new()); f.read_to_string(&mut text)?; Ok(text)
}
#[cfg(unix)]
fn open_project_file(root: &str, path: &Path, mode: FileMode) -> Result<File> {
    use std::os::{fd::{AsRawFd, FromRawFd}, unix::ffi::OsStrExt};
    let mut parent=File::open(root)?;
    let rel=path.strip_prefix(root).map_err(|_|Error::Usage("File must stay inside project".into()))?;
    let parts:Vec<_>=rel.components().collect();
    for (i,part) in parts.iter().enumerate() {
        if !matches!(part,std::path::Component::Normal(_)) { return Err(Error::Usage("Path traversal is not allowed".into())); }
        let name=std::ffi::CString::new(part.as_os_str().as_bytes()).map_err(|_|Error::Usage("Invalid path".into()))?;
        let last=i+1==parts.len();
        let flags=libc::O_NOFOLLOW|libc::O_CLOEXEC|if last {libc::O_NONBLOCK|match mode {FileMode::Read=>libc::O_RDONLY,FileMode::Overwrite=>libc::O_RDWR,FileMode::Create=>libc::O_RDWR|libc::O_CREAT|libc::O_EXCL}} else {libc::O_RDONLY|libc::O_DIRECTORY};
        // SAFETY: name and parent are valid for this call. A new descriptor is returned.
        let fd=unsafe {libc::openat(parent.as_raw_fd(),name.as_ptr(),flags,0o666)};
        if fd<0 { let e=std::io::Error::last_os_error(); if e.kind()==std::io::ErrorKind::AlreadyExists { return Err(Error::Conflict("Destination appeared since preview; compare again".into())); } return Err(e.into()); }
        // SAFETY: openat returned an owned valid descriptor, transferred to File exactly once.
        let file=unsafe {File::from_raw_fd(fd)};
        if last { if !file.metadata()?.is_file() { return Err(Error::Usage("Expected a regular file".into())); } return Ok(file); } parent=file;
    }
    Err(Error::Usage("Expected a file".into()))
}
#[cfg(not(unix))]
fn open_project_file(root:&str,path:&Path,mode:FileMode)->Result<File> {
    discovery::checked_path(Path::new(root),path,matches!(mode,FileMode::Create))?;
    Ok(OpenOptions::new().read(true).write(!matches!(mode,FileMode::Read)).create_new(matches!(mode,FileMode::Create)).open(path)?)
}
