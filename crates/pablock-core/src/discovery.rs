use crate::{Error, ProfileKind, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;

const EXCLUDED: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "vendor",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".cache",
];
#[derive(Serialize, Deserialize)]
pub struct Marker {
    pub schema_version: u32,
    pub project_id: String,
}
pub fn read_marker(path: &Path) -> Result<Marker> {
    let marker: Marker = toml::from_str(&fs::read_to_string(path)?)
        .map_err(|_| Error::Usage("Invalid .pablock.toml".into()))?;
    if marker.schema_version != 1 || uuid::Uuid::parse_str(&marker.project_id).is_err() {
        return Err(Error::Usage("Unsupported project marker".into()));
    }
    Ok(marker)
}
pub fn find_root(start: &Path) -> Result<PathBuf> {
    let start = start.canonicalize()?;
    let mut git = None;
    for p in start.ancestors() {
        if p.join(".pablock.toml").is_file() {
            read_marker(&p.join(".pablock.toml"))?;
            return Ok(p.to_path_buf());
        }
        if git.is_none() && p.join(".git").exists() {
            git = Some(p.to_path_buf());
        }
    }
    git.ok_or_else(|| {
        Error::NotFound("No project marker or Git root found; use project add".into())
    })
}
pub fn classify(path: &Path) -> Option<ProfileKind> {
    let name = path.file_name()?.to_str()?;
    if name != ".env" && !name.starts_with(".env.") {
        return None;
    }
    if name
        .split('.')
        .any(|part| matches!(part, "example" | "sample" | "template"))
    {
        Some(ProfileKind::Template)
    } else {
        Some(ProfileKind::Secret)
    }
}
pub fn scan(root: &Path) -> Result<Vec<(String, ProfileKind)>> {
    let mut found = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || !(e.file_type().is_dir()
                    && EXCLUDED.contains(&e.file_name().to_string_lossy().as_ref()))
        })
    {
        let entry = entry.map_err(|e| Error::Io(e.to_string()))?;
        if entry.file_type().is_file() {
            if let Some(kind) = classify(entry.path()) {
                found.push((relative(root, entry.path())?, kind));
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(found)
}
pub fn relative(root: &Path, path: &Path) -> Result<String> {
    let path = checked_path(root, path, false)?;
    path.strip_prefix(root)
        .map_err(|_| Error::Usage("File must be inside the project root".into()))?
        .to_str()
        .map(|s| s.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or_else(|| Error::Usage("Paths must be UTF-8".into()))
}
/// Reject symlinks in every component, including dangling links and the destination itself.
pub fn checked_path(root: &Path, path: &Path, allow_missing: bool) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let rel = absolute
        .strip_prefix(root)
        .map_err(|_| Error::Usage("File must be inside the project root".into()))?;
    if rel.as_os_str().is_empty() {
        return Err(Error::Usage("Expected a file path".into()));
    }
    let mut current = root.to_path_buf();
    let parts: Vec<_> = rel.components().collect();
    for (i, part) in parts.iter().enumerate() {
        if !matches!(part, Component::Normal(_)) {
            return Err(Error::Usage("Path traversal is not allowed".into()));
        }
        current.push(part.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(Error::Usage("Symlinks are not allowed".into()))
            }
            Ok(m) if i + 1 == parts.len() && !m.is_file() => {
                return Err(Error::Usage("Expected a regular file".into()))
            }
            Ok(m) if i + 1 < parts.len() && !m.is_dir() => {
                return Err(Error::Usage("Expected a directory".into()))
            }
            Ok(_) => (),
            Err(e)
                if e.kind() == std::io::ErrorKind::NotFound
                    && allow_missing
                    && i + 1 == parts.len() =>
            {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(current)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nearest_marker_wins_over_git() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        fs::create_dir_all(root.join("a/b/.git")).unwrap();
        fs::write(
            root.join(".pablock.toml"),
            format!("schema_version=1\nproject_id=\"{}\"", uuid::Uuid::new_v4()),
        )
        .unwrap();
        assert_eq!(find_root(&root.join("a/b")).unwrap(), root);
        fs::write(
            root.join("a/.pablock.toml"),
            format!("schema_version=1\nproject_id=\"{}\"", uuid::Uuid::new_v4()),
        )
        .unwrap();
        assert_eq!(find_root(&root.join("a/b")).unwrap(), root.join("a"));
        fs::remove_file(root.join("a/.pablock.toml")).unwrap();
        fs::remove_file(root.join(".pablock.toml")).unwrap();
        assert_eq!(find_root(&root.join("a/b")).unwrap(), root.join("a/b"));
    }
    #[test]
    fn ignores_gitignore_but_not_exclusions() {
        let t = tempfile::tempdir().unwrap();
        fs::create_dir(t.path().join("node_modules")).unwrap();
        fs::write(t.path().join(".gitignore"), ".env*\n").unwrap();
        for p in [".env", ".env.production.example", "node_modules/.env"] {
            fs::write(t.path().join(p), "K=x").unwrap();
        }
        let files = scan(t.path()).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[1].1, ProfileKind::Template);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(t.path().join(".env"), t.path().join(".env.link")).unwrap();
            assert_eq!(scan(t.path()).unwrap().len(), 2);
            assert!(checked_path(t.path(), Path::new(".env.link"), true).is_err());
        }
    }
}
