# Security boundaries

Pablock encrypts dotenv values at rest using `iota_stronghold`. SQLite stores metadata in plaintext. Project paths, names, relative dotenv paths, variable names, timestamps, version IDs, and operation sources are not confidential within the vault format.

The master password is not stored, logged, accepted as an argument, or read from an environment variable. Rust password input uses zeroizing buffers; the derived 32-byte Argon2id key is protected by Stronghold's key provider. There is no password recovery.

Stronghold Store records are encrypted in the snapshot. The Store API exposes plaintext in the unlocked process. Values can also be present briefly in parser buffers, serialization buffers, and the GUI's local state during reveal/edit. JavaScript strings cannot be reliably zeroized; closing a dialog or locking removes application references, not a guarantee of physical memory erasure. Revealed values do not enter TanStack Query's metadata cache, logs, browser storage, or hidden DOM data attributes. Clipboard copies are explicit user actions and may be retained by the OS clipboard manager.

The frontend has no filesystem, SQLite, shell, or Stronghold plugin permission. One closed Rust request enum handles vault operations. Tauri capabilities grant only the custom titlebar's window controls. The content security policy permits local assets and IPC. Browser demo data is available only in development with an explicit `?demo` query.

An exclusive OS file lock prevents simultaneous GUI/CLI access to the snapshot. The lock file is not deleted on close; the operating system releases its advisory lock on process exit. Do not delete it to bypass a busy vault. Lock or close the owning GUI instead.

Pending SQLite operations contain metadata only. Snapshot writes use a temporary encrypted file, `fsync`, atomic rename, and directory synchronization. Recovery follows the commit ID inside the encrypted snapshot. Import previews keep parsed values in Rust memory until confirmation; they do not reread changed files. Export rechecks the exact destination contents using the opened file descriptor before truncation. Unix path traversal uses `openat` with `O_NOFOLLOW`, including the canonical root's directory chain.

Exports are an explicit plaintext disclosure to disk. They preserve permissions and write directly, as required by the product contract. They can be readable by other users and can be partial after interruption. There is no automatic backup, secure erase guarantee, or protection from forensic recovery of previously deleted storage blocks, copied snapshots, source dotenv files, or external backups.

Pablock is intended for a trusted single-user OS account. It does not protect against malware running as that account, a debugger with access to the process, a compromised frontend dependency, an administrator, or physical access to an unlocked machine. Metadata is not independently authenticated; modifying SQLite outside the application is unsupported and can corrupt the vault. Keep the database, salt, and snapshot together.
