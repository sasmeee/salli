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
// one sms per call, bigger batches made gemma mix up lines
const BATCH: usize = 1;
const CATEGORIES: [&str; 11] = [
    "Food", "Groceries", "Transport", "Bills", "Shopping", "Salary",
    "Transfer", "Entertainment", "Health", "Subscriptions", "Other",
];

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
    // rule, memory, ai or you
    #[serde(default)]
    source: String,
    // shop name used to look up memory
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

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn new_code() -> String {
    format!("{:06}", uuid::Uuid::new_v4().as_u128() % 1_000_000)
}

// pick the wifi ip and skip vpn / virtual adapters
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
    Regex::new(
        r"(?i)\bat\s+([A-Za-z0-9&'.\-/* ]{2,40}?)(?:\s+(?:on|using|via|with|card|ref|for)\b|\s+\d{1,2}[/-]|[,;]|\.\s|\.$|\s*$)",
    )
    .unwrap()
});
static SALARY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bsalary\b").unwrap());
static FROM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)transfer(?:red)?\s+from\s+([A-Za-z .]{2,30}?)(?:[.,]|\s+avl|\s+on\s|$)").unwrap()
});
static PROMO_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(\d+\s*%\s*off|\bsale\b|\bearn\b|\bpoints\b|\boffers?\b|t&c|shop now|\bwin\b|discount|promo)")
        .unwrap()
});
static RIDE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(trip|ride|riding|fare)\b").unwrap());

const BANKS: [&str; 18] = [
    "BOC", "COMBANK", "COMMERCIAL", "HNB", "SAMPATH", "NDB", "PEOPLES", "NSB", "DFCC",
    "SEYLAN", "NTB", "NATIONS", "PABC", "AMANA", "UNION", "HSBC", "SCB", "STANDARD",
];

struct Rules {
    amount: Option<f64>,
    kind: Option<String>,
    key: Option<String>,
    merchant: Option<String>,
    category: Option<String>,
    skip: bool,
}

// drops card numbers and refs so the same shop always gets the same key
fn norm(s: &str) -> String {
    s.split_whitespace()
        .filter(|w| w.chars().filter(|c| c.is_ascii_digit()).count() < 3)
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
}

fn title(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_bank(sender: &str) -> bool {
    let up = sender.to_uppercase();
    BANKS.iter().any(|b| up.contains(b))
}

fn rules(m: &Sms) -> Rules {
    // look for the amount before the balance part only
    let head = match BAL_RE.find(&m.body) {
        Some(x) => &m.body[..x.start()],
        None => &m.body[..],
    };
    let amount = AMOUNT_RE
        .captures(head)
        .and_then(|c| c[1].replace(',', "").parse::<f64>().ok())
        .filter(|a| *a > 0.0);

    let c = CREDIT_RE.is_match(&m.body);
    let d = DEBIT_RE.is_match(&m.body);

    // ads with no money words, skip without asking gemma
    if PROMO_RE.is_match(&m.body) && !c && !d {
        return Rules { amount, kind: None, key: None, merchant: None, category: None, skip: true };
    }

    // "payment received" from dialog or ceb means you paid them
    let kind = if d && !is_bank(&m.address) {
        Some("debit".to_string())
    } else {
        match (c, d) {
            (true, false) => Some("credit".to_string()),
            (false, true) => Some("debit".to_string()),
            _ => None,
        }
    };

    let mut merchant = None;
    let mut category = None;
    if kind.as_deref() == Some("credit") {
        if SALARY_RE.is_match(&m.body) {
            merchant = Some("Salary".to_string());
            category = Some("Salary".to_string());
        } else if let Some(cap) = FROM_RE.captures(&m.body) {
            merchant = Some(title(cap[1].trim()));
            category = Some("Transfer".to_string());
        }
    }
    if kind.as_deref() == Some("debit") && RIDE_RE.is_match(&m.body) {
        category = Some("Transport".to_string());
    }

    // shop after "at", or the sender if it's not a bank (pickme, uber, dialog)
    let key = AT_RE
        .captures(&m.body)
        .map(|cap| norm(&cap[1]))
        .filter(|k| k.len() >= 2)
        .or_else(|| if is_bank(&m.address) { None } else { Some(norm(&m.address)) })
        .filter(|k| !k.is_empty());

    Rules { amount, kind, key, merchant, category, skip: false }
}

#[derive(Deserialize)]
struct AiItem {
    i: usize,
    #[serde(default)]
    shop_text: String,
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
Return exactly one item per line with the same i. \
For each line: FIRST copy the shop or payee text exactly as written in THAT line into shop_text, \
THEN decide merchant and category using only that same line. Never mix information between lines. \
amount = money moved (never the balance). type = debit if money left the account, credit if money came in. \
merchant = short clean brand name ('KEELLS SUPER COLOMBO 07' -> 'Keells', 'UBER EATS COLOMBO' -> 'Uber Eats', 'CEB ONLINE PAYMENT' -> 'CEB'). \
If a line is an ad, promo, loyalty points message, OTP or not a completed transaction, set is_transaction false.\n\
Category guide:\n\
- Groceries: supermarkets (Keells, Cargills Food City, Arpico, Laugfs Super, Glomark, Spar).\n\
- Food: restaurants, cafes, bakeries, fast food, food delivery (KFC, Pizza Hut, Uber Eats).\n\
- Transport: taxi and ride apps (PickMe rides, Uber rides), fuel (Lanka IOC, Ceypetco), parking, bus, train, tolls.\n\
- Bills: electricity, water, phone, internet, TV (CEB, LECO, Water Board, Dialog, Mobitel, SLT, Hutch).\n\
- Subscriptions: monthly digital services (Netflix, Spotify, YouTube, iCloud, Google One).\n\
- Shopping: clothes, electronics, online and department stores (Odel, Daraz, Abans, Singer).\n\
- Health: pharmacies, hospitals, clinics, labs (Osu Sala, Healthguard, Union Chemists, Asiri, Nawaloka).\n\
- Entertainment: cinemas, events, games, tickets (Scope Cinemas, Savoy).\n\
- Salary: salary credits. Transfer: money between people or own accounts.\n\
- Other: only if nothing above fits.\n\
JSON only.";

const SHOT_USER: &str = "0: Your A/C ***1234 debited LKR 2,450.00 at KEELLS SUPER COLOMBO 07 on 25/10/26. Avl Bal LKR 45,210.00
1: Get 20% off at Cargills this weekend! Min spend Rs.5000. T&C apply.
2: BOC: Rs.4,500.00 spent at CEYPETCO MAHARAGAMA using card ending 4821 on 12/10/2026. Bal Rs.80,120.00
3: Sampath Bank: Your card ***7731 was charged LKR 1,250.00 at UNION CHEMISTS NUGEGODA 05/10/2026.";

const SHOT_ASSISTANT: &str = r#"{"items":[
{"i":0,"shop_text":"KEELLS SUPER COLOMBO 07","is_transaction":true,"amount":2450,"type":"debit","merchant":"Keells","category":"Groceries"},
{"i":1,"shop_text":"","is_transaction":false,"amount":0,"type":"debit","merchant":"","category":"Other"},
{"i":2,"shop_text":"CEYPETCO MAHARAGAMA","is_transaction":true,"amount":4500,"type":"debit","merchant":"Ceypetco","category":"Transport"},
{"i":3,"shop_text":"UNION CHEMISTS NUGEGODA","is_transaction":true,"amount":1250,"type":"debit","merchant":"Union Chemists","category":"Health"}]}"#;

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
                            "shop_text": { "type": "string" },
                            "is_transaction": { "type": "boolean" },
                            "amount": { "type": "number" },
                            "type": { "type": "string", "enum": ["debit", "credit"] },
                            "merchant": { "type": "string" },
                            "category": { "type": "string", "enum": CATEGORIES }
                        },
                        "required": ["i", "shop_text", "is_transaction", "amount", "type", "merchant", "category"]
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
    let mut batch: AiBatch = serde_json::from_str(content).map_err(|e| e.to_string())?;

    // if gemma gives no merchant, use the shop text instead
    for it in batch.items.iter_mut() {
        if it.merchant.trim().is_empty() && !it.shop_text.trim().is_empty() {
            it.merchant = it
                .shop_text
                .split_whitespace()
                .take(3)
                .map(|w| if w.len() <= 4 { w.to_uppercase() } else { title(w) })
                .collect::<Vec<_>>()
                .join(" ");
        }
    }
    Ok(batch.items)
}

// reads new sms in the background: rules first, then memory, then gemma
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

            // instant ones first
            let mut need_ai: Vec<(Sms, Rules)> = Vec::new();
            {
                let mut st = s.store.lock().unwrap();
                for m in pending {
                    let r = rules(&m);
                    if r.skip {
                        st.skipped.push(m.id.clone());
                        continue;
                    }
                    let (info, source) = match (&r.merchant, &r.category) {
                        (Some(mm), Some(cc)) => (
                            Some(MerchantInfo { merchant: mm.clone(), category: cc.clone() }),
                            "rule",
                        ),
                        _ => (r.key.as_ref().and_then(|k| st.memory.get(k)).cloned(), "memory"),
                    };
                    match (info, r.amount, r.kind.clone()) {
                        (Some(info), Some(amount), Some(kind)) => st.txs.push(Tx {
                            id: m.id.clone(),
                            date: m.date,
                            sender: m.address.clone(),
                            body: m.body.clone(),
                            amount,
                            kind,
                            merchant: info.merchant,
                            category: r.category.clone().unwrap_or(info.category),
                            source: source.into(),
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

            // ask gemma once per shop, the rest get picked up from memory next loop
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
                            // if rules already found amount and type, keep it even if gemma says no
                            Some(it) if it.is_transaction || (r.amount.is_some() && r.kind.is_some()) => {
                                // numbers always come from rules when we have them
                                let amount = r.amount.unwrap_or(it.amount);
                                if amount <= 0.0 {
                                    st.skipped.push(m.id.clone());
                                    continue;
                                }
                                let kind = r.kind.clone().unwrap_or_else(|| it.kind.clone());
                                let category = r.category.clone().unwrap_or_else(|| {
                                    if CATEGORIES.contains(&it.category.as_str()) {
                                        it.category.clone()
                                    } else {
                                        "Other".into()
                                    }
                                });
                                let merchant = r.merchant.clone().unwrap_or_else(|| {
                                    if it.merchant.trim().is_empty() {
                                        r.key.as_deref().map(title).unwrap_or_else(|| title(&m.address))
                                    } else {
                                        it.merchant.clone()
                                    }
                                });
                                if let Some(k) = &r.key {
                                    st.memory.insert(
                                        k.clone(),
                                        MerchantInfo { merchant: merchant.clone(), category: category.clone() },
                                    );
                                }
                                st.txs.push(Tx {
                                    id: m.id.clone(),
                                    date: m.date,
                                    sender: m.address.clone(),
                                    body: m.body.clone(),
                                    amount,
                                    kind,
                                    merchant,
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

// fixing one tx also fixes every tx from the same shop
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