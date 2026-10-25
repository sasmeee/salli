use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const PORT: u16 = 7777;
const CODE_TTL: u64 = 30;
const MODEL: &str = "gemma3:4b";
const OLLAMA: &str = "http://127.0.0.1:11434";
const BATCH: usize = 8;
const CATEGORIES: [&str; 11] = [
    "Food", "Groceries", "Transport", "Bills", "Shopping", "Salary",
    "Transfer", "Entertainment", "Health", "Subscriptions", "Other",
];

// ================= data =================

#[derive(Clone, Serialize, Deserialize)]
pub struct Sms {
    id: String,
    address: String,
    body: String,
    date: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Tx {
    id: String,
    date: f64,
    sender: String,
    body: String,
    amount: f64,
    kind: String,
    merchant: String,
    category: String,
    /// "memory" | "ai" | "you"
    #[serde(default)]
    source: String,
    /// normalized raw merchant, used for memory
    #[serde(default)]
    key: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct MerchantInfo {
    merchant: String,
    category: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Store {
    inbox: Vec<Sms>,
    txs: Vec<Tx>,
    skipped: Vec<String>,
    sessions: HashSet<String>,
    memory: HashMap<String, MerchantInfo>,
}

#[derive(Clone, Serialize)]
struct PairCode {
    current: String,
    previous: String,
    expires_at: u64,
}

#[derive(Clone)]
struct Shared {
    app: AppHandle,
    store: Arc<Mutex<Store>>,
    code: Arc<Mutex<PairCode>>,
    busy: Arc<Mutex<bool>>,
    last_error: Arc<Mutex<Option<String>>>,
    data_path: PathBuf,
}

#[derive(Deserialize)]
struct SyncBody {
    messages: Vec<Sms>,
}

#[derive(Deserialize)]
struct PairBody {
    code: String,
}

#[derive(Serialize)]
struct PairingInfo {
    ip: String,
    port: u16,
    code: String,
    expires_at: u64,
}

#[derive(Serialize)]
struct ViewState {
    txs: Vec<Tx>,
    total_sms: usize,
    pending: usize,
    busy: bool,
    paired: bool,
    memory_size: usize,
    last_error: Option<String>,
}

// ================= helpers =================

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

fn save(s: &Shared) {
    let st = s.store.lock().unwrap();
    if let Ok(bytes) = serde_json::to_vec_pretty(&*st) {
        let _ = std::fs::write(&s.data_path, bytes);
    }
}

fn load(path: &PathBuf) -> Store {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

// ================= rules (exact, instant) =================

static AMOUNT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:LKR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)").unwrap());
static BAL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(avl\.?\s*bal|available\s+bal|current\s+bal|bal(ance)?\s*[:.])").unwrap()
});
static CREDIT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(credited|received|deposited|refund(ed)?|salary|cr)\b").unwrap()
});
static DEBIT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(debited|paid|purchased?|spent|withdrawn?|withdrawal|payment|charged|dr)\b")
        .unwrap()
});
static AT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bat\s+([A-Za-z0-9&'.\-/ ]{2,40}?)(?:\s+on\s|\s+\d{1,2}[/-]|[,;]|\.\s|\.$|\s*$)")
        .unwrap()
});

const BANKS: [&str; 18] = [
    "BOC", "COMBANK", "COMMERCIAL", "HNB", "SAMPATH", "NDB", "PEOPLES", "NSB", "DFCC",
    "SEYLAN", "NTB", "NATIONS", "PABC", "AMANA", "UNION", "HSBC", "SCB", "STANDARD",
];

struct Rules {
    amount: Option<f64>,
    kind: Option<String>,
    key: Option<String>,
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_uppercase()
}

fn is_bank(sender: &str) -> bool {
    let up = sender.to_uppercase();
    BANKS.iter().any(|b| up.contains(b))
}

fn rules(m: &Sms) -> Rules {
    // only look for the amount BEFORE the balance part
    let head = match BAL_RE.find(&m.body) {
        Some(x) => &m.body[..x.start()],
        None => &m.body[..],
    };
    let amount = AMOUNT_RE
        .captures(head)
        .and_then(|c| c[1].replace(',', "").parse::<f64>().ok())
        .filter(|a| *a > 0.0);

    let kind = match (CREDIT_RE.is_match(&m.body), DEBIT_RE.is_match(&m.body)) {
        (true, false) => Some("credit".to_string()),
        (false, true) => Some("debit".to_string()),
        _ => None, // unclear -> let Gemma decide
    };

    // memory key: shop after "at ...", else sender if it's not a bank (PickMe, Uber...)
    let key = AT_RE
        .captures(&m.body)
        .map(|c| norm(&c[1]))
        .filter(|k| k.len() >= 2)
        .or_else(|| if is_bank(&m.address) { None } else { Some(norm(&m.address)) });

    Rules { amount, kind, key }
}

// ================= gemma (batched) =================

#[derive(Deserialize)]
struct AiItem {
    i: usize,
    is_transaction: bool,
    amount: f64,
    #[serde(rename = "type")]
    kind: String,
    merchant: String,
    category: String,
}

#[derive(Deserialize)]
struct AiBatch {
    items: Vec<AiItem>,
}

const SYSTEM_PROMPT: &str = "You read Sri Lankan bank and payment SMS. Input is numbered lines 'i: sms'. \
Return one item per line with the same i. amount = money moved (never the balance). \
type = debit if money left the account, credit if money came in. \
merchant = short clean brand name ('KEELLS SUPER COLOMBO 07' -> 'Keells', 'UBER EATS COLOMBO' -> 'Uber Eats'). \
If a line is an ad, promo, OTP or not a completed transaction, set is_transaction false. JSON only.";

const SHOT_USER: &str = "0: Your A/C ***1234 debited LKR 2,450.00 at KEELLS SUPER COLOMBO 07 on 25/10/26. Avl Bal LKR 45,210.00
1: LKR 85,000.00 credited to A/C ***5678 SALARY OCT. Avl Bal LKR 130,210.00
2: Get 20% off at Cargills this weekend! Min spend Rs.5000. T&C apply.
3: Your trip fare LKR 680.00 paid by card. Thank you for riding with PickMe.";

const SHOT_ASSISTANT: &str = r#"{"items":[
{"i":0,"is_transaction":true,"amount":2450,"type":"debit","merchant":"Keells","category":"Groceries"},
{"i":1,"is_transaction":true,"amount":85000,"type":"credit","merchant":"Salary","category":"Salary"},
{"i":2,"is_transaction":false,"amount":0,"type":"debit","merchant":"","category":"Other"},
{"i":3,"is_transaction":true,"amount":680,"type":"debit","merchant":"PickMe","category":"Transport"}]}"#;

async fn ask_gemma_batch(client: &reqwest::Client, sms: &[&str]) -> Result<Vec<AiItem>, String> {
    let list = sms
        .iter()
        .enumerate()
        .map(|(i, b)| format!("{i}: {}", b.replace('\n', " ")))
        .collect::<Vec<_>>()
        .join("\n");

    let body = serde_json::json!({
        "model": MODEL,
        "stream": false,
        "keep_alive": "30m",
        "options": { "temperature": 0 },
        "format": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "i": { "type": "integer" },
                            "is_transaction": { "type": "boolean" },
                            "amount": { "type": "number" },
                            "type": { "type": "string", "enum": ["debit", "credit"] },
                            "merchant": { "type": "string" },
                            "category": { "type": "string", "enum": CATEGORIES }
                        },
                        "required": ["i", "is_transaction", "amount", "type", "merchant", "category"]
                    }
                }
            },
            "required": ["items"]
        },
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": SHOT_USER },
            { "role": "assistant", "content": SHOT_ASSISTANT },
            { "role": "user", "content": list }
        ]
    });

    let res = client
        .post(format!("{OLLAMA}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable. Is it running? ({e})"))?;
    let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = v["message"]["content"]
        .as_str()
        .ok_or_else(|| "Gemma returned nothing".to_string())?;
    let batch: AiBatch = serde_json::from_str(content).map_err(|e| e.to_string())?;
    Ok(batch.items)
}

/// Background worker: memory first, then Gemma for unknown shops.
fn spawn_parser(s: Shared) {
    tauri::async_runtime::spawn(async move {
        {
            let mut b = s.busy.lock().unwrap();
            if *b {
                return;
            }
            *b = true;
        }
        *s.last_error.lock().unwrap() = None;
        let _ = s.app.emit("tx-updated", ());

        let client = reqwest::Client::new();
        loop {
            let pending: Vec<Sms> = {
                let st = s.store.lock().unwrap();
                st.inbox
                    .iter()
                    .filter(|m| !st.txs.iter().any(|t| t.id == m.id) && !st.skipped.contains(&m.id))
                    .cloned()
                    .collect()
            };
            if pending.is_empty() {
                break;
            }

            // pass 1: instant via rules + memory
            let mut need_ai: Vec<(Sms, Rules)> = Vec::new();
            {
                let mut st = s.store.lock().unwrap();
                for m in pending {
                    let r = rules(&m);
                    let hit = r.key.as_ref().and_then(|k| st.memory.get(k)).cloned();
                    match (hit, r.amount, r.kind.clone()) {
                        (Some(info), Some(amount), Some(kind)) => st.txs.push(Tx {
                            id: m.id.clone(),
                            date: m.date,
                            sender: m.address.clone(),
                            body: m.body.clone(),
                            amount,
                            kind,
                            merchant: info.merchant,
                            category: info.category,
                            source: "memory".into(),
                            key: r.key.clone(),
                        }),
                        _ => need_ai.push((m, r)),
                    }
                }
            }
            save(&s);
            let _ = s.app.emit("tx-updated", ());
            if need_ai.is_empty() {
                continue;
            }

            // pass 2: one Gemma batch; same shop sent only once, rest resolved by memory next loop
            let mut seen = HashSet::new();
            let batch: Vec<(Sms, Rules)> = need_ai
                .into_iter()
                .filter(|(_, r)| match &r.key {
                    Some(k) => seen.insert(k.clone()),
                    None => true,
                })
                .take(BATCH)
                .collect();
            let bodies: Vec<&str> = batch.iter().map(|(m, _)| m.body.as_str()).collect();

            match ask_gemma_batch(&client, &bodies).await {
                Ok(items) => {
                    let mut st = s.store.lock().unwrap();
                    for (i, (m, r)) in batch.iter().enumerate() {
                        match items.iter().find(|x| x.i == i) {
                            Some(it) if it.is_transaction => {
                                // trust regex for numbers, Gemma only as fallback
                                let amount = r.amount.unwrap_or(it.amount);
                                if amount <= 0.0 {
                                    st.skipped.push(m.id.clone());
                                    continue;
                                }
                                let kind = r.kind.clone().unwrap_or_else(|| it.kind.clone());
                                let category = if CATEGORIES.contains(&it.category.as_str()) {
                                    it.category.clone()
                                } else {
                                    "Other".into()
                                };
                                if let Some(k) = &r.key {
                                    st.memory.insert(
                                        k.clone(),
                                        MerchantInfo { merchant: it.merchant.clone(), category: category.clone() },
                                    );
                                }
                                st.txs.push(Tx {
                                    id: m.id.clone(),
                                    date: m.date,
                                    sender: m.address.clone(),
                                    body: m.body.clone(),
                                    amount,
                                    kind,
                                    merchant: it.merchant.clone(),
                                    category,
                                    source: "ai".into(),
                                    key: r.key.clone(),
                                });
                            }
                            _ => st.skipped.push(m.id.clone()),
                        }
                    }
                }
                Err(e) => {
                    *s.last_error.lock().unwrap() = Some(e);
                    break;
                }
            }
            save(&s);
            let _ = s.app.emit("tx-updated", ());
        }

        *s.busy.lock().unwrap() = false;
        let _ = s.app.emit("tx-updated", ());
    });
}

// ================= tauri commands =================

#[tauri::command]
fn pairing_info(state: tauri::State<Shared>) -> PairingInfo {
    let c = state.code.lock().unwrap().clone();
    PairingInfo { ip: local_ip(), port: PORT, code: c.current, expires_at: c.expires_at }
}

#[tauri::command]
fn get_state(state: tauri::State<Shared>) -> ViewState {
    let st = state.store.lock().unwrap();
    let done = st.txs.len() + st.skipped.len();
    ViewState {
        txs: st.txs.clone(),
        total_sms: st.inbox.len(),
        pending: st.inbox.len().saturating_sub(done),
        busy: *state.busy.lock().unwrap(),
        paired: !st.sessions.is_empty(),
        memory_size: st.memory.len(),
        last_error: state.last_error.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn retry_parse(state: tauri::State<Shared>) {
    state.store.lock().unwrap().skipped.clear();
    spawn_parser(state.inner().clone());
}

/// User fixes a transaction: applies to every tx from the same shop + saves to memory.
#[tauri::command]
fn fix_tx(state: tauri::State<Shared>, id: String, merchant: String, category: String) {
    {
        let mut st = state.store.lock().unwrap();
        let key = st.txs.iter().find(|t| t.id == id).and_then(|t| t.key.clone());
        for t in st.txs.iter_mut() {
            if t.id == id || (key.is_some() && t.key == key) {
                t.merchant = merchant.clone();
                t.category = category.clone();
                t.source = "you".into();
            }
        }
        if let Some(k) = key {
            st.memory.insert(k, MerchantInfo { merchant, category });
        }
    }
    save(&state);
    let _ = state.app.emit("tx-updated", ());
}

// ================= http server =================

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
    s.store.lock().unwrap().sessions.insert(token.clone());
    save(&s);
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
    if !s.store.lock().unwrap().sessions.contains(tok) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let (added, total) = {
        let mut st = s.store.lock().unwrap();
        let mut added = 0;
        for m in body.messages {
            if !st.inbox.iter().any(|x| x.id == m.id) {
                st.inbox.push(m);
                added += 1;
            }
        }
        (added, st.inbox.len())
    };
    save(&s);
    let _ = s.app.emit("sms-synced", serde_json::json!({ "added": added, "total": total }));
    spawn_parser(s.clone());
    Ok(Json(serde_json::json!({ "ok": true, "added": added, "total": total })))
}

// ================= app =================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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

            // warm up Gemma so first parse isn't a 35s cold load
            tauri::async_runtime::spawn(async {
                let _ = reqwest::Client::new()
                    .post(format!("{OLLAMA}/api/generate"))
                    .json(&serde_json::json!({ "model": MODEL, "keep_alive": "30m" }))
                    .send()
                    .await;
            });

            // finish any SMS left unparsed from last run
            spawn_parser(shared.clone());

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
        .invoke_handler(tauri::generate_handler![pairing_info, get_state, retry_parse, fix_tx])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}