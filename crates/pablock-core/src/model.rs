use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Usage(String),
    #[error("Incorrect password or unreadable vault snapshot")]
    Authentication,
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Vault is locked")]
    Locked,
    #[error("{0}")]
    Io(String),
    #[error("Dotenv line {line}: {message}")]
    Parse { line: usize, message: String },
}
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn code(&self) -> i32 {
        match self {
            Self::Usage(_) | Self::Parse { .. } => 2,
            Self::Authentication | Self::Locked => 3,
            Self::NotFound(_) => 4,
            Self::Conflict(_) => 5,
            Self::Io(_) => 6,
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}
impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Self::Io(e.to_string())
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::Io("Invalid stored metadata".into())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProfileKind {
    Secret,
    Template,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub name: String,
    pub kind: ProfileKind,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableSummary {
    pub key: String,
    pub has_value: bool,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionSummary {
    pub id: String,
    pub key: String,
    pub action: String,
    pub source: String,
    pub created_at: String,
    pub has_value: bool,
    pub current: bool,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDiff {
    pub added: Vec<String>,
    pub changed: Vec<String>,
    pub removed: Vec<String>,
    pub unchanged: Vec<String>,
}
impl ProfileDiff {
    pub fn between(
        old: &BTreeMap<String, String>,
        new: &BTreeMap<String, String>,
        replace: bool,
    ) -> Self {
        let mut d = Self::default();
        for (k, v) in new {
            match old.get(k) {
                None => d.added.push(k.clone()),
                Some(o) if o == v => d.unchanged.push(k.clone()),
                _ => d.changed.push(k.clone()),
            }
        }
        for k in old.keys().filter(|k| !new.contains_key(*k)) {
            if replace {
                d.removed.push(k.clone());
            } else {
                d.unchanged.push(k.clone());
            }
        }
        d.unchanged.sort();
        d
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub path: String,
    pub kind: ProfileKind,
    pub diff: ProfileDiff,
    pub warnings: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateComparison {
    pub template: String,
    pub missing: Vec<String>,
    pub extra: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub data_dir: String,
}
