use crate::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use zeroize::Zeroizing;

/// Closed command set. No SQL, arbitrary filesystem access, or Stronghold APIs are exposed.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Status,
    Init {
        password: Zeroizing<String>,
    },
    Unlock {
        password: Zeroizing<String>,
    },
    Lock,
    Password {
        current: Zeroizing<String>,
        new: Zeroizing<String>,
    },
    Projects,
    AddProject {
        path: String,
        name: Option<String>,
    },
    RenameProject {
        project: String,
        name: String,
    },
    RemoveProject {
        project: String,
    },
    Scan {
        project: String,
    },
    Profiles {
        project: String,
    },
    RenameProfile {
        profile: String,
        name: String,
    },
    RemoveProfile {
        profile: String,
    },
    Variables {
        profile: String,
    },
    Templates {
        profile: String,
    },
    Reveal {
        profile: String,
        key: String,
        version: Option<String>,
    },
    Set {
        profile: String,
        key: String,
        value: Zeroizing<String>,
    },
    RemoveSecret {
        profile: String,
        key: String,
    },
    History {
        profile: String,
        key: String,
    },
    Restore {
        profile: String,
        key: String,
        version: String,
    },
    DeleteVersion {
        profile: String,
        key: String,
        version: String,
    },
    ClearHistory {
        profile: String,
        key: String,
    },
    PreviewImport {
        project: String,
        files: Vec<String>,
        replace: bool,
    },
    Import {
        project: String,
        files: Vec<String>,
        replace: bool,
    },
    Diff {
        profile: String,
        target: Option<String>,
    },
    Export {
        profile: String,
        target: Option<String>,
        overwrite: bool,
    },
}
#[derive(Serialize)]
pub struct ApiError {
    pub code: i32,
    pub message: String,
}
impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self {
            code: e.code(),
            message: e.to_string(),
        }
    }
}
pub struct Session {
    pub dir: PathBuf,
    vault: Option<Vault>,
}
impl Session {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, vault: None }
    }
    fn vault(&mut self) -> Result<&mut Vault> {
        self.vault.as_mut().ok_or(Error::Locked)
    }
    pub fn handle(&mut self, request: Request) -> Result<serde_json::Value> {
        use Request::*;
        let value = match request {
            Status => serde_json::to_value(VaultStatus {
                initialized: Vault::initialized(&self.dir),
                unlocked: self.vault.is_some(),
                data_dir: self.dir.to_string_lossy().into_owned(),
            })?,
            Init { password } => {
                if self.vault.is_some() {
                    return Err(Error::Conflict("Vault already open".into()));
                }
                self.vault = Some(Vault::open(&self.dir, password, true)?);
                serde_json::Value::Null
            }
            Unlock { password } => {
                if self.vault.is_some() {
                    return Err(Error::Conflict("Vault already open".into()));
                }
                self.vault = Some(Vault::open(&self.dir, password, false)?);
                serde_json::Value::Null
            }
            Lock => {
                self.vault = None;
                serde_json::Value::Null
            }
            Password { current, new } => {
                self.vault()?
                    .change_password(current, new)?;
                serde_json::Value::Null
            }
            Projects => serde_json::to_value(self.vault()?.projects()?)?,
            AddProject { path, name } => serde_json::to_value(
                self.vault()?
                    .add_project(std::path::Path::new(&path), name.as_deref())?,
            )?,
            RenameProject { project, name } => {
                self.vault()?.rename_project(&project, &name)?;
                serde_json::Value::Null
            }
            RemoveProject { project } => {
                self.vault()?.remove_project(&project)?;
                serde_json::Value::Null
            }
            Scan { project } => serde_json::to_value(self.vault()?.scan(&project)?)?,
            Profiles { project } => serde_json::to_value(self.vault()?.profiles(&project)?)?,
            RenameProfile { profile, name } => {
                self.vault()?.rename_profile(&profile, &name)?;
                serde_json::Value::Null
            }
            RemoveProfile { profile } => {
                self.vault()?.remove_profile(&profile)?;
                serde_json::Value::Null
            }
            Variables { profile } => serde_json::to_value(self.vault()?.variables(&profile)?)?,
            Templates { profile } => {
                serde_json::to_value(self.vault()?.compare_templates(&profile)?)?
            }
            Reveal {
                profile,
                key,
                version,
            } => {
                serde_json::to_value(&*self.vault()?.reveal(&profile, &key, version.as_deref())?)?
            }
            Set {
                profile,
                key,
                value,
            } => {
                self.vault()?.set(&profile, &key, value)?;
                serde_json::Value::Null
            }
            RemoveSecret { profile, key } => {
                self.vault()?.remove_secret(&profile, &key)?;
                serde_json::Value::Null
            }
            History { profile, key } => {
                serde_json::to_value(self.vault()?.history(&profile, &key)?)?
            }
            Restore {
                profile,
                key,
                version,
            } => {
                self.vault()?.restore(&profile, &key, &version)?;
                serde_json::Value::Null
            }
            DeleteVersion {
                profile,
                key,
                version,
            } => {
                self.vault()?.delete_version(&profile, &key, &version)?;
                serde_json::Value::Null
            }
            ClearHistory { profile, key } => {
                self.vault()?.clear_history(&profile, &key)?;
                serde_json::Value::Null
            }
            PreviewImport {
                project,
                files,
                replace,
            } => serde_json::to_value(self.vault()?.preview_import(&project, &files, replace)?)?,
            Import {
                project,
                files,
                replace,
            } => serde_json::to_value(self.vault()?.import(&project, &files, replace)?)?,
            Diff { profile, target } => {
                serde_json::to_value(self.vault()?.disk_diff(&profile, target.as_deref())?)?
            }
            Export {
                profile,
                target,
                overwrite,
            } => serde_json::to_value(self.vault()?.export(
                &profile,
                target.as_deref(),
                overwrite,
            )?)?,
        };
        Ok(value)
    }
}
