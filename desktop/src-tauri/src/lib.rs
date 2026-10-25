mod commands;
mod forecast;
mod gemma;
mod net;
mod parser;
mod roast;
mod rules;
mod server;
mod state;

use gemma::{MODEL, OLLAMA};
use net::{CODE_TTL, PORT, new_code};
use parser::spawn_parser;
use state::{PairCode, Shared, load, now};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let data_path = dir.join("salli.json");

            let shared = Shared {
                app: app.handle().clone(),
                store: Arc::new(Mutex::new(load(&data_path))),
                code: Arc::new(Mutex::new(PairCode {
                    current: new_code(),
                    previous: String::new(),
                    expires_at: now() + CODE_TTL,
                })),
                busy: Arc::new(Mutex::new(false)),
                last_error: Arc::new(Mutex::new(None)),
                data_path,
            };
            app.manage(shared.clone());

            // load gemma early so the first sms isn't slow
            tauri::async_runtime::spawn(async {
                let _ = reqwest::Client::new()
                    .post(format!("{OLLAMA}/api/generate"))
                    .json(&serde_json::json!({ "model": MODEL, "keep_alive": "30m" }))
                    .send()
                    .await;
            });

            // finish anything left from last time
            spawn_parser(shared.clone());

            // new pairing code every 30s
            let rot = shared.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(CODE_TTL)).await;
                    let expires = {
                        let mut c = rot.code.lock().unwrap();
                        c.previous = std::mem::replace(&mut c.current, new_code());
                        c.expires_at = now() + CODE_TTL;
                        c.expires_at
                    };
                    let _ = rot.app.emit("code-changed", expires);
                }
            });

            // server the phone talks to over wifi
            tauri::async_runtime::spawn(async move {
                let router = server::router(shared);
                let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT))
                    .await
                    .expect("port 7777 is busy");
                axum::serve(listener, router).await.unwrap();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pairing_info,
            commands::get_state,
            commands::retry_parse,
            commands::fix_tx,
            commands::finish_onboarding,
            commands::export_data,
            commands::import_data,
            commands::unpair_all,
            commands::reset_memory,
            commands::delete_all_data,
            roast::roast,
            forecast::forecast
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
