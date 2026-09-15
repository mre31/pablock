use clap::{Parser, Subcommand};
use pablock_core::{Error, Result, Vault};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, IsTerminal, Read, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

#[derive(Parser)]
#[command(
    name = "pablock",
    version,
    about = "Local encrypted dotenv vault",
    long_about = "Local encrypted dotenv vault. Without arguments, opens the desktop app.\nExit codes: 2 usage, 3 authentication, 4 not found, 5 confirmation/lock conflict, 6 I/O."
)]
struct Cli {
    #[arg(long, global = true)]
    project: Option<String>,
    #[arg(long, global = true)]
    profile: Option<String>,
    #[arg(long, global = true)]
    password_stdin: bool,
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Vault {
        #[command(subcommand)]
        command: VaultCommand,
    },
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    Scan,
    Profile {
        #[command(subcommand)]
        command: ProfileCommand,
    },
    Import {
        #[arg(required = true)]
        files: Vec<PathBuf>,
        #[arg(long)]
        replace: bool,
        #[arg(long)]
        yes: bool,
    },
    Export {
        #[arg(long)]
        to: Option<PathBuf>,
        #[arg(long)]
        yes: bool,
    },
    Diff {
        #[arg(long)]
        against: Option<PathBuf>,
    },
    Secret {
        #[command(subcommand)]
        command: SecretCommand,
    },
}
#[derive(Subcommand)]
enum VaultCommand {
    Init,
    Status,
    Passwd,
}
#[derive(Subcommand)]
enum ProjectCommand {
    Add {
        path: Option<PathBuf>,
        #[arg(long)]
        name: Option<String>,
    },
    List,
    Rename {
        name: String,
    },
    Remove {
        #[arg(long)]
        yes: bool,
    },
}
#[derive(Subcommand)]
enum ProfileCommand {
    List,
    Rename {
        name: String,
    },
    Remove {
        #[arg(long)]
        yes: bool,
    },
}
#[derive(Subcommand)]
enum SecretCommand {
    List,
    Get {
        key: String,
        #[arg(long)]
        reveal: bool,
    },
    Set {
        key: String,
        #[arg(long)]
        value_stdin: bool,
    },
    Remove {
        key: String,
    },
    History {
        key: String,
    },
    Restore {
        key: String,
        version: String,
    },
    DeleteVersion {
        key: String,
        version: String,
        #[arg(long)]
        yes: bool,
    },
    ClearHistory {
        key: String,
        #[arg(long)]
        yes: bool,
    },
}
fn serial<T: Serialize>(v: T) -> Result<Value> {
    Ok(serde_json::to_value(v)?)
}
fn line(stdin: &mut impl BufRead) -> Result<Zeroizing<String>> {
    let mut s = Zeroizing::new(String::new());
    if stdin.read_line(&mut s)? == 0 {
        return Err(Error::Usage("Expected a password line on stdin".into()));
    }
    if s.ends_with('\n') {
        s.pop();
        if s.ends_with('\r') {
            s.pop();
        }
    }
    Ok(s)
}
fn hidden(prompt: &str) -> Result<Zeroizing<String>> {
    if !Path::new("/dev/tty").exists() {
        return Err(Error::Usage(
            "No terminal; use --password-stdin or --value-stdin".into(),
        ));
    }
    rpassword::prompt_password(prompt)
        .map(Zeroizing::new)
        .map_err(|_| Error::Usage("No interactive terminal; use the appropriate stdin flag".into()))
}
fn confirmed(yes: bool, message: &str) -> Result<()> {
    if yes {
        return Ok(());
    }
    if !io::stdin().is_terminal() {
        return Err(Error::Conflict(format!("{message}; rerun with --yes")));
    }
    eprint!("{message} [y/N] ");
    io::stderr().flush()?;
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    if matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes") {
        Ok(())
    } else {
        Err(Error::Conflict("Operation cancelled".into()))
    }
}
fn new_password(stdin: &mut impl BufRead, piped: bool) -> Result<Zeroizing<String>> {
    if piped {
        line(stdin)
    } else {
        let p = hidden("New master password: ")?;
        let confirm = hidden("Confirm master password: ")?;
        if *p != *confirm {
            return Err(Error::Usage("Passwords do not match".into()));
        }
        Ok(p)
    }
}
pub fn run() -> i32 {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            if matches!(
                error.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            ) {
                let _ = error.print();
                return 0;
            }
            // Never echo a mistakenly supplied secret argument into an error or log.
            let message =
                "Invalid command or arguments; use pablock --help or the subcommand's --help";
            if std::env::args_os().any(|a| a == "--json") {
                eprintln!("{}", json!({"error":{"code":2,"message":message}}));
            } else {
                eprintln!("Error: {message}");
            }
            return 2;
        }
    };
    match execute(&cli) {
        Ok(v) => {
            if cli.json {
                println!("{}", v);
            } else {
                print_human(&v);
            }
            0
        }
        Err(e) => {
            if cli.json {
                eprintln!(
                    "{}",
                    json!({"error":{"code":e.code(),"message":e.to_string()}})
                );
            } else {
                eprintln!("Error: {e}");
            }
            e.code()
        }
    }
}
fn execute(cli: &Cli) -> Result<Value> {
    // AppImage's AppRun changes into its bundled usr directory. The runtime
    // preserves the caller's working directory in OWD for command-line tools.
    if let (Some(_), Some(appdir), Some(original)) = (
        std::env::var_os("APPIMAGE"),
        std::env::var_os("APPDIR"),
        std::env::var_os("OWD"),
    ) {
        // AppImage variables can be inherited from a terminal/editor packaged
        // as AppImage. Only our own bundled executable should restore OWD.
        if std::env::current_exe()?.starts_with(Path::new(&appdir)) {
            std::env::set_current_dir(original)?;
        }
    }
    let dir = Vault::data_dir()?;
    if matches!(
        cli.command,
        Command::Vault {
            command: VaultCommand::Status
        }
    ) {
        return serial(pablock_core::VaultStatus {
            initialized: Vault::initialized(&dir),
            unlocked: false,
            data_dir: dir.to_string_lossy().into_owned(),
        });
    }
    let mut input = io::stdin().lock();
    let init = matches!(
        cli.command,
        Command::Vault {
            command: VaultCommand::Init
        }
    );
    let password = if init {
        new_password(&mut input, cli.password_stdin)?
    } else if cli.password_stdin {
        line(&mut input)?
    } else {
        hidden("Master password: ")?
    };
    // passwd needs the current password a second time for verification in the shared core.
    let current = if matches!(
        cli.command,
        Command::Vault {
            command: VaultCommand::Passwd
        }
    ) {
        Some(password.clone())
    } else {
        None
    };
    let mut vault = Vault::open(&dir, password, init)?;
    if let Command::Vault { command } = &cli.command {
        return match command {
            VaultCommand::Init => Ok(json!({"message":"Vault created"})),
            VaultCommand::Status => unreachable!(),
            VaultCommand::Passwd => {
                let new = new_password(&mut input, cli.password_stdin)?;
                vault.change_password(current.unwrap(), new)?;
                Ok(json!({"message":"Password changed"}))
            }
        };
    }
    if let Command::Project { command } = &cli.command {
        match command {
            ProjectCommand::Add { path, name } => {
                return serial(
                    vault
                        .add_project(path.as_deref().unwrap_or(Path::new(".")), name.as_deref())?,
                )
            }
            ProjectCommand::List => return serial(vault.projects()?),
            _ => (),
        }
    }
    let project = vault.resolve_project(cli.project.as_deref(), &std::env::current_dir()?)?;
    match &cli.command {
        Command::Project {
            command: ProjectCommand::Rename { name },
        } => {
            vault.rename_project(&project.id, name)?;
            return Ok(json!({"message":"Project renamed"}));
        }
        Command::Project {
            command: ProjectCommand::Remove { yes },
        } => {
            confirmed(
                *yes,
                "Permanently delete this project and all stored versions?",
            )?;
            vault.remove_project(&project.id)?;
            return Ok(json!({"message":"Project removed; source files preserved"}));
        }
        Command::Scan => return serial(vault.scan(&project.id)?),
        Command::Profile {
            command: ProfileCommand::List,
        } => return serial(vault.profiles(&project.id)?),
        Command::Import {
            files,
            replace,
            yes,
        } => {
            let files: Vec<_> = files
                .iter()
                .map(|p| {
                    if p.is_absolute() {
                        p.clone()
                    } else {
                        std::env::current_dir().unwrap_or_default().join(p)
                    }
                })
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let prepared = vault.prepare_import(&project.id, &files, *replace)?;
            eprintln!("{}", serde_json::to_string_pretty(&prepared.previews)?);
            confirmed(*yes, "Import these changes into the vault?")?;
            return serial(vault.import_prepared(prepared)?);
        }
        _ => (),
    }
    let profile = vault.resolve_profile(&project.id, cli.profile.as_deref())?;
    let absolute_target = |path: &Option<PathBuf>| -> Option<String> {
        path.as_ref()
            .map(|p| {
                if p.is_absolute() {
                    p.clone()
                } else {
                    std::env::current_dir().unwrap_or_default().join(p)
                }
            })
            .map(|p| p.to_string_lossy().into_owned())
    };
    match &cli.command {
        Command::Profile {
            command: ProfileCommand::Rename { name },
        } => vault.rename_profile(&profile.id, name)?,
        Command::Profile {
            command: ProfileCommand::Remove { yes },
        } => {
            confirmed(
                *yes,
                "Permanently delete this profile and all its versions?",
            )?;
            vault.remove_profile(&profile.id)?;
        }
        Command::Diff { against } => {
            return serial(vault.disk_diff(&profile.id, absolute_target(against).as_deref())?)
        }
        Command::Export { to, yes } => {
            let target = absolute_target(to);
            let prepared = vault.prepare_export(&profile.id, target.as_deref())?;
            eprintln!("{}", serde_json::to_string_pretty(&prepared.diff)?);
            let exists = prepared.destination_exists();
            if exists {
                confirmed(*yes,"Overwrite this file? Writing is direct and existing permissions are preserved.")?;
            }
            return serial(vault.export_prepared(prepared, exists || *yes)?);
        }
        Command::Secret { command } => match command {
            SecretCommand::List => {
                return Ok(
                    json!({"variables":vault.variables(&profile.id)?,"templates":if profile.kind == pablock_core::ProfileKind::Secret {vault.compare_templates(&profile.id)?} else {vec![]}}),
                )
            }
            SecretCommand::Get { key, reveal } => {
                // Verify existence without bringing the plaintext across the API for masked reads.
                let exists = vault
                    .variables(&profile.id)?
                    .iter()
                    .any(|v| v.key == *key && v.has_value);
                if !exists {
                    return Err(Error::NotFound("Variable not found".into()));
                }
                return if *reveal {
                    Ok(json!({"key":key,"value":&*vault.reveal(&profile.id,key,None)?}))
                } else {
                    Ok(json!({"key":key,"value":"••••••••","redacted":true}))
                };
            }
            SecretCommand::Set { key, value_stdin } => {
                let value = if *value_stdin {
                    let mut s = Zeroizing::new(String::new());
                    input.read_to_string(&mut s)?;
                    s
                } else {
                    hidden("Secret value: ")?
                };
                vault.set(&profile.id, key, value)?;
            }
            SecretCommand::Remove { key } => vault.remove_secret(&profile.id, key)?,
            SecretCommand::History { key } => return serial(vault.history(&profile.id, key)?),
            SecretCommand::Restore { key, version } => vault.restore(&profile.id, key, version)?,
            SecretCommand::DeleteVersion { key, version, yes } => {
                confirmed(*yes, "Permanently delete this old version?")?;
                vault.delete_version(&profile.id, key, version)?;
            }
            SecretCommand::ClearHistory { key, yes } => {
                confirmed(*yes, "Permanently delete all old versions of this key?")?;
                vault.clear_history(&profile.id, key)?;
            }
        },
        _ => return Err(Error::Usage("Unsupported command".into())),
    }
    Ok(json!({"message":"Done"}))
}
fn print_human(value: &Value) {
    if let Some(message) = value.get("message").and_then(Value::as_str) {
        println!("{message}");
    } else if let Some(secret) = value.get("value").and_then(Value::as_str) {
        print!("{secret}");
        let _ = io::stdout().flush();
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(value).unwrap_or_default()
        );
    }
}
