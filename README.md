# Pablock

Pablock is a local, single-user dotenv vault for Linux. The React desktop app and the `pablock` CLI use the same Rust core, SQLite metadata, and encrypted IOTA Stronghold snapshot. There are no accounts or network services.

## Install and start

Debian 12 or newer with WebKitGTK 4.1:

```sh
sudo apt install ./Pablock_1.0.0_amd64.deb
pablock
```

The Debian package installs `/usr/bin/pablock` and a desktop launcher. The executable opens the GUI without arguments; `pablock gui` does the same. Every other subcommand runs without starting Tauri or a WebView, including on a machine without a graphical session.

For AppImage:

```sh
chmod +x Pablock_1.0.0_amd64.AppImage
./Pablock_1.0.0_amd64.AppImage
./Pablock_1.0.0_amd64.AppImage vault status
mkdir -p ~/.local/bin
ln -s /absolute/path/Pablock_1.0.0_amd64.AppImage ~/.local/bin/pablock
```

Put `~/.local/bin` on your PATH if needed. On a system without FUSE, use `APPIMAGE_EXTRACT_AND_RUN=1 ./Pablock_1.0.0_amd64.AppImage vault status`. The AppImage is built on Debian 12 to avoid requiring Fedora's newer glibc. Linux x86-64 is the delivery target; macOS and Windows are not supported releases.

## Desktop workflow

1. Create a master password, or unlock an existing vault. There is no recovery key or password reset.
2. Add a project using its absolute directory path. Pablock writes a `.pablock.toml` marker containing its schema version and project UUID, with no values.
3. Scan the project. Select dotenv files, then choose whether to register profiles only or preview and import their values. Unselected profiles are not registered. Cancel leaves the vault unchanged.
4. Select an environment in the sidebar. Values start masked. Reveal, copy, edit, delete, and view history using the row actions. Templates display key names only.
5. Use Import to preview merge or replace changes. Use Export to compare a destination with the vault and explicitly authorize overwriting an existing file.
6. Restore historical values as new versions, remove individual old versions, or clear old history. The current version is always retained.
7. Use Settings to change the master password. Lock the vault before using the CLI while the window remains open.

The vault stays unlocked until you lock it or close the application. There is no timeout. Project/profile deletion permanently removes the corresponding values and versions from the active snapshot; it does not delete source dotenv files. Project markers remain on disk so the same project can be registered again.

## CLI

Start in your project directory:

```sh
pablock vault init
pablock project add .
pablock scan
pablock profile list
pablock import .env .env.production
pablock --profile .env secret list
pablock --profile .env secret get DATABASE_URL
pablock --profile .env secret get DATABASE_URL --reveal
pablock --profile .env secret set DATABASE_URL
pablock --profile .env diff
pablock --profile .env export --yes
```

`secret set` prompts without echo. It never accepts a value as a command argument. `secret get` prints a mask unless `--reveal` is present; revealed plain output preserves the exact value without adding a newline. Lists, diffs, import previews, and history contain only metadata.

| Command | Arguments and behavior |
| --- | --- |
| `vault init` | Creates a vault; prompts for and confirms its password. |
| `vault status` | Shows initialization state and data directory without prompting. `unlocked` describes this CLI session, not another process. |
| `vault passwd` | Verifies the current password and rewrites the snapshot with the new one. |
| `project add [PATH] [--name NAME]` | Registers a canonical directory; defaults to the current directory. |
| `project list` | Lists registered projects. |
| `project rename NAME` | Renames the selected project. |
| `project remove [--yes]` | Permanently removes the project and all its stored records after confirmation. |
| `scan` | Discovers and registers all dotenv profiles; reads template keys without importing secret values. |
| `profile list` | Lists relative paths, IDs, display names, and kinds. |
| `profile rename NAME` | Changes the display name, preserving the relative file identity. |
| `profile remove [--yes]` | Permanently removes a profile and its records. |
| `import FILE... [--replace] [--yes]` | Previews changes and imports all files as one transaction. Merge is the default. |
| `export [--to FILE] [--yes]` | Previews changes and exports canonical dotenv. Defaults to the selected profile's path. |
| `diff [--against FILE]` | Compares the disk file with values in the vault. |
| `secret list` | Lists keys and compares the profile with project templates. |
| `secret get KEY [--reveal]` | Prints a masked or explicitly revealed value. |
| `secret set KEY [--value-stdin]` | Reads a hidden terminal value, or the remaining UTF-8 bytes on stdin. |
| `secret remove KEY` | Adds a deleted version. |
| `secret history KEY` | Lists version IDs, actions, source, time, and current/deleted status. |
| `secret restore KEY VERSION_ID` | Restores that version as a new current version, including deleted versions. |
| `secret delete-version KEY VERSION_ID [--yes]` | Permanently deletes a noncurrent version. |
| `secret clear-history KEY [--yes]` | Permanently deletes all noncurrent versions of the key. |

Global flags can appear before or after the subcommand:

- `--project PATH_OR_ID` overrides project discovery. Otherwise the closest `.pablock.toml` in the current directory's ancestors wins. If there is none, the closest `.git` directory or file determines the root.
- `--profile RELATIVE_PATH_OR_ID` chooses a profile. Exactly one profile is selected automatically; multiple profiles require explicit selection.
- `--password-stdin` reads the first stdin line as the master password. Password arguments and password environment variables are not supported.
- `--json` writes a JSON result to stdout. Errors are JSON on stderr; previews and prompts also use stderr. Secret values still require `--reveal`.

Explicit file arguments are relative to the CLI working directory. GUI file paths are relative to the project root. New export files require an existing parent directory.

### Automation input

With both `--password-stdin` and `--value-stdin`, the first line is the password and **all remaining bytes** are the value. The value's trailing newline is preserved. Input must be UTF-8. `vault passwd --password-stdin` reads the current password on the first line and the new password on the second. `vault init --password-stdin` reads one password line.

For example, provide a protected input stream with this structure:

```text
<master password>\n
<secret value, possibly multiline>
```

Pipe that stream to `pablock --password-stdin --profile .env secret set KEY --value-stdin`. Avoid putting actual secrets into shell command history. Noninteractive imports and operations requiring confirmation return exit code 5 unless `--yes` is present.

| Exit code | Meaning |
| --- | --- |
| 0 | Success |
| 2 | Usage or dotenv syntax error |
| 3 | Incorrect password or locked vault |
| 4 | Project, profile, variable, or version not found |
| 5 | Confirmation required, stale preview, or another process owns the vault |
| 6 | Filesystem, database, or snapshot failure |

## Dotenv behavior

Scanning does not follow symlinks. It skips `.git`, `node_modules`, `target`, `vendor`, `.venv`, `venv`, `dist`, `build`, `.next`, and `.cache`. Dotenv files remain discoverable even when `.gitignore` excludes them.

`.env` and `.env.*` are secret profiles unless an `example`, `sample`, or `template` path suffix segment marks a template, for example `.env.production.example`. Profiles are identified by their full relative path, such as `apps/api/.env.production`. Template values are discarded; only key names are stored.

The parser supports `export KEY=...`, single/double quotes, escapes, multiline values, empty values, CRLF input, and a UTF-8 BOM. It does not interpolate `$VARIABLE` or `${VARIABLE}`. Names must match `[A-Za-z_][A-Za-z0-9_]*`. Double quotes support `\n`, `\r`, `\t`, `\"`, `\\`, and `\$`; single quotes are literal. Duplicate keys use the last value and produce a line-numbered warning. Syntax errors include the line number and never include the rejected value. A malformed multi-file import writes nothing.

Merge preserves keys absent from the file. Replace records those keys as deleted versions. Importing the same current value creates no version. Manual sets, deletion, and restore create versions; history is not automatically pruned.

Export writes sorted, double-quoted keys using UTF-8, LF, and a trailing newline. It discards original comments, spacing, and quoting. Added/changed/removed in an export diff describe changes from **disk to vault values**. Import uses the reverse direction, from vault to imported values. Symlink destinations and paths outside the canonical project root are rejected, including directory symlinks.

Export deliberately writes directly and preserves existing permissions. It does not use an atomic rename or force `0600`. An interrupted export can leave a partial file. Review the file's permissions before sharing the machine. A destination changed since preview must be compared again.

## Storage and recovery

The default Linux directory is `$XDG_DATA_HOME/pablock`, or `~/.local/share/pablock`. `vault status` prints the actual location.

- `pablock.hold`: encrypted Stronghold snapshot containing every value version.
- `pablock.db`: SQLite metadata, including canonical project paths, profile names, key names, version history, template keys, and pending operations. WAL/SHM companion files may also exist.
- `salt`: persistent random 32-byte Argon2id salt.
- `pablock.lock`: exclusive process lock held while a vault session is open.

Argon2id uses 64 MiB, three iterations, one lane, and a 32-byte output. The derived key is passed directly to Stronghold. Stronghold's additional password-oriented scrypt work factor is zero because Argon2id already performs password strengthening. Master password buffers are zeroized after derivation. The data directory is private; exports retain their existing modes.

Each vault write first journals metadata in SQLite, then changes Stronghold and atomically commits a new encrypted snapshot containing the operation ID. Only then does SQLite apply the metadata and remove the journal entry in one transaction. On reopening, a matching snapshot operation ID completes the metadata transaction; an unmatched journal entry is discarded. No secret values are written into the journal. A failed write disables that session until it is locked and reopened.

Password changes verify the old password and commit an encrypted temporary snapshot with the new key before replacing the original. The salt remains stable, so only one file requires atomic replacement. If the process stops after replacement but before reporting success, the new password is already active.

Manual copies of a vault must include the database, snapshot, and salt together, while every Pablock session is closed. Pablock does not create automatic backups. See [SECURITY.md](SECURITY.md) for the storage and memory boundaries.

## Development and verification

Install Rust, Node 24, pnpm 11.9, and [Tauri's Linux dependencies](https://v2.tauri.app/start/prerequisites/). On Debian 12 the container definition lists the complete build package set.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

A browser preview of the current UI is available at `http://localhost:1420/?demo` after `pnpm dev`. It uses fictitious in-memory data and is development-only. Production builds always connect to Rust. Fonts are bundled locally; the desktop UI makes no external font requests.

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm test
pnpm build
pnpm tauri build --no-bundle
pnpm tauri bundle
```

The tests cover parser/discovery behavior, real encrypted storage, version lifecycle, wrong passwords, password changes, symlink and export restrictions, stale previews, and fault injection at each journal/snapshot/SQLite commit boundary. CLI tests remove `DISPLAY` and `WAYLAND_DISPLAY` and exercise the actual executable. React tests mock the IPC command and exercise the current UI, including the scan selection/preview flow.

To generate Debian and AppImage packages on a consistent Debian 12 baseline:

```sh
./scripts/package-linux.sh
# Or: CONTAINER_ENGINE=docker ./scripts/package-linux.sh
```

This builds an isolated container and writes both packages to `artifacts/`. The source tree is mounted, but container dependencies and Rust build output use named volumes. Local bundles otherwise appear in `target/release/bundle/`. CI runs checks and uploads packages without publishing a release.

## Scope

This release does not include cloud sync, accounts, team sharing, the system keychain, password recovery, timed auto-lock, automatic backups, secret notes, comment-preserving dotenv edits, or a `run` command that injects secrets into child processes.

For a real WebKit smoke test, install `tauri-driver` with `cargo install tauri-driver --locked` and your distribution's `WebKitWebDriver`, then run `python3 scripts/smoke-gui.py target/release/pablock`. The script uses a temporary vault and project, and covers setup, scanning/import, reveal/hide, export, window controls, and locking. Use the unbundled executable with the host's WebKit driver; the AppImage can bundle a different WebKit version.
