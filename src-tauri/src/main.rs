mod cli;
use pablock_core::api::{ApiError, Request, Session};
use std::sync::Mutex;

#[tauri::command]
async fn vault_request(
    state: tauri::State<'_, Mutex<Session>>,
    request: Request,
) -> Result<serde_json::Value, ApiError> {
    state
        .lock()
        .map_err(|_| ApiError {
            code: 6,
            message: "Vault session failed; restart Pablock".into(),
        })?
        .handle(request)
        .map_err(Into::into)
}
fn main() {
    // Dispatch before constructing Tauri: CLI needs neither DISPLAY nor a WebView.
    if std::env::args_os().len() > 1
        && std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new("gui"))
    {
        std::process::exit(cli::run());
    }
    if std::env::args_os().len() > 2 {
        eprintln!("pablock gui does not accept arguments");
        std::process::exit(2);
    }
    let dir = match pablock_core::Vault::data_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(e.code());
        }
    };
    tauri::Builder::default()
        .manage(Mutex::new(Session::new(dir)))
        .invoke_handler(tauri::generate_handler![vault_request])
        .run(tauri::generate_context!())
        .expect("Unable to start Pablock window");
}
