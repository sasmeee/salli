use crate::net::{PORT, local_ip};
use crate::parser::spawn_parser;
use crate::state::{MerchantInfo, PairingInfo, Shared, ViewState, save};
use tauri::Emitter;

#[tauri::command]
pub(crate) fn pairing_info(state: tauri::State<Shared>) -> PairingInfo {
    let c = state.code.lock().unwrap().clone();
    PairingInfo {
        ip: local_ip(),
        port: PORT,
        code: c.current,
        expires_at: c.expires_at,
    }
}

#[tauri::command]
pub(crate) fn get_state(state: tauri::State<Shared>) -> ViewState {
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
pub(crate) fn retry_parse(state: tauri::State<Shared>) {
    state.store.lock().unwrap().skipped.clear();
    spawn_parser(state.inner().clone());
}

// fixing one tx also fixes every tx from the same shop
#[tauri::command]
pub(crate) fn fix_tx(state: tauri::State<Shared>, id: String, merchant: String, category: String) {
    {
        let mut st = state.store.lock().unwrap();
        let key = st
            .txs
            .iter()
            .find(|t| t.id == id)
            .and_then(|t| t.key.clone());
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
