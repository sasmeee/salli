use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const PORT: u16 = 7777;
const CODE_TTL: u64 = 30;

#[derive(Clone, Serialize, Deserialize)]
pub struct Sms {
    id: String,
    address: String,
    body: String,
    date: f64,
}

#[derive(Deserialize)]
struct SyncBody {
    messages: Vec<Sms>,
}

#[derive(Deserialize)]
struct PairBody {
    code: String,
}

#[derive(Clone, Serialize)]
struct PairCode {
    current: String,
    previous: String,
    expires_at: u64,
}

#[derive(Serialize)]
struct PairingInfo {
    ip: String,
    port: u16,
    code: String,
    expires_at: u64,
}

#[derive(Clone)]
struct Shared {
    app: AppHandle,
    inbox: Arc<Mutex<Vec<Sms>>>,
    code: Arc<Mutex<PairCode>>,
    sessions: Arc<Mutex<HashSet<String>>>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn new_code() -> String {
    format!("{:06}", uuid::Uuid::new_v4().as_u128() % 1_000_000)
}

/// Pick the WiFi IP, skipping virtual adapters (VPN, Hyper-V, emulator).
fn local_ip() -> String {
    let ips: Vec<IpAddr> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .map(|(_, ip)| ip)
        .filter(|ip| ip.is_ipv4() && !ip.is_loopback())
        .collect();

    // prefer 192.168.x.x, then 172.16-31.x.x, then anything
    let pick = ips
        .iter()
        .find(|ip| ip.to_string().starts_with("192.168."))
        .or_else(|| {
            ips.iter().find(|ip| {
                let s = ip.to_string();
                s.starts_with("172.")
                    && s.split('.')
                        .nth(1)
                        .and_then(|n| n.parse::<u8>().ok())
                        .map_or(false, |n| (16..=31).contains(&n))
            })
        })
        .or_else(|| ips.first());

    pick.map(|ip| ip.to_string())
        .unwrap_or_else(|| "127.0.0.1".into())
}

#[tauri::command]
fn pairing_info(state: tauri::State<Shared>) -> PairingInfo {
    let c = state.code.lock().unwrap().clone();
    PairingInfo { ip: local_ip(), port: PORT, code: c.current, expires_at: c.expires_at }
}

#[tauri::command]
fn get_inbox(state: tauri::State<Shared>) -> Vec<Sms> {
    state.inbox.lock().unwrap().clone()
}

async fn ping() -> &'static str {
    "salli"
}

async fn pair(
    State(s): State<Shared>,
    Json(body): Json<PairBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let ok = {
        let c = s.code.lock().unwrap();
        let input = body.code.replace(' ', "");
        !input.is_empty() && (input == c.current || input == c.previous)
    };
    if !ok {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    s.sessions.lock().unwrap().insert(token.clone());
    let _ = s.app.emit("phone-paired", ());
    Ok(Json(serde_json::json!({ "token": token })))
}

async fn sync(
    State(s): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<SyncBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let tok = headers
        .get("x-salli-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !s.sessions.lock().unwrap().contains(tok) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let (added, total) = {
        let mut inbox = s.inbox.lock().unwrap();
        let mut added = 0;
        for m in body.messages {
            if !inbox.iter().any(|x| x.id == m.id) {
                inbox.push(m);
                added += 1;
            }
        }
        (added, inbox.len())
    };
    let _ = s.app.emit("sms-synced", serde_json::json!({ "added": added, "total": total }));
    Ok(Json(serde_json::json!({ "ok": true, "added": added, "total": total })))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let shared = Shared {
                app: app.handle().clone(),
                inbox: Arc::new(Mutex::new(Vec::new())),
                code: Arc::new(Mutex::new(PairCode {
                    current: new_code(),
                    previous: String::new(),
                    expires_at: now() + CODE_TTL,
                })),
                sessions: Arc::new(Mutex::new(HashSet::new())),
            };
            app.manage(shared.clone());

            // rotate pairing code every 30s
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

            // local http server on WiFi
            tauri::async_runtime::spawn(async move {
                let router = Router::new()
                    .route("/ping", get(ping))
                    .route("/pair", post(pair))
                    .route("/sync", post(sync))
                    .layer(DefaultBodyLimit::max(20 * 1024 * 1024))
                    .with_state(shared);
                let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT))
                    .await
                    .expect("port 7777 is busy");
                axum::serve(listener, router).await.unwrap();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pairing_info, get_inbox])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}