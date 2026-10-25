use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Sms {
    pub(crate) id: String,
    pub(crate) address: String,
    pub(crate) body: String,
    pub(crate) date: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Tx {
    pub(crate) id: String,
    pub(crate) date: f64,
    pub(crate) sender: String,
    pub(crate) body: String,
    pub(crate) amount: f64,
    pub(crate) kind: String,
    pub(crate) merchant: String,
    pub(crate) category: String,
    // rule, memory, ai or you
    #[serde(default)]
    pub(crate) source: String,
    // shop name used to look up memory
    #[serde(default)]
    pub(crate) key: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct MerchantInfo {
    pub(crate) merchant: String,
    pub(crate) category: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct Store {
    pub(crate) inbox: Vec<Sms>,
    pub(crate) txs: Vec<Tx>,
    pub(crate) skipped: Vec<String>,
    pub(crate) sessions: HashSet<String>,
    pub(crate) memory: HashMap<String, MerchantInfo>,
}

#[derive(Clone, Serialize)]
pub(crate) struct PairCode {
    pub(crate) current: String,
    pub(crate) previous: String,
    pub(crate) expires_at: u64,
}

#[derive(Clone)]
pub(crate) struct Shared {
    pub(crate) app: AppHandle,
    pub(crate) store: Arc<Mutex<Store>>,
    pub(crate) code: Arc<Mutex<PairCode>>,
    pub(crate) busy: Arc<Mutex<bool>>,
    pub(crate) last_error: Arc<Mutex<Option<String>>>,
    pub(crate) data_path: PathBuf,
}

#[derive(Deserialize)]
pub(crate) struct SyncBody {
    pub(crate) messages: Vec<Sms>,
}

#[derive(Deserialize)]
pub(crate) struct PairBody {
    pub(crate) code: String,
}

#[derive(Serialize)]
pub(crate) struct PairingInfo {
    pub(crate) ip: String,
    pub(crate) port: u16,
    pub(crate) code: String,
    pub(crate) expires_at: u64,
}

#[derive(Serialize)]
pub(crate) struct ViewState {
    pub(crate) txs: Vec<Tx>,
    pub(crate) total_sms: usize,
    pub(crate) pending: usize,
    pub(crate) busy: bool,
    pub(crate) paired: bool,
    pub(crate) memory_size: usize,
    pub(crate) last_error: Option<String>,
}

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

pub(crate) fn save(s: &Shared) {
    let st = s.store.lock().unwrap();
    if let Ok(bytes) = serde_json::to_vec_pretty(&*st) {
        let _ = std::fs::write(&s.data_path, bytes);
    }
}

pub(crate) fn load(path: &PathBuf) -> Store {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
