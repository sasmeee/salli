use crate::dedupe::merge_duplicates;
use crate::net::{PORT, local_ip};
use crate::parser::spawn_parser;
use crate::state::{Backup, MerchantInfo, PairingInfo, Shared, Store, ViewState, now, save};
use serde::Serialize;
use tauri::Emitter;

#[derive(Serialize)]
pub(crate) struct ExportResult {
    txs: usize,
    shops: usize,
    sms: usize,
}

#[derive(Serialize)]
pub(crate) struct ImportResult {
    added_txs: usize,
    added_sms: usize,
    shops: usize,
}

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
        txs: merge_duplicates(st.txs.clone()),
        total_sms: st.inbox.len(),
        pending: st.inbox.len().saturating_sub(done),
        busy: *state.busy.lock().unwrap(),
        paired: !st.sessions.is_empty(),
        memory_size: st.memory.len(),
        last_error: state.last_error.lock().unwrap().clone(),
        onboarded: st.onboarded,
        last_sync: st.last_sync,
        last_export: st.last_export,
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

#[tauri::command]
pub(crate) fn finish_onboarding(state: tauri::State<Shared>) {
    state.store.lock().unwrap().onboarded = true;
    save(&state);
    let _ = state.app.emit("tx-updated", ());
}

#[tauri::command]
pub(crate) fn export_data(
    state: tauri::State<Shared>,
    path: String,
) -> Result<ExportResult, String> {
    let (backup, result) = {
        let st = state.store.lock().unwrap();
        let backup = Backup {
            salli_export: 1,
            exported_at: now(),
            inbox: st.inbox.clone(),
            txs: st.txs.clone(),
            skipped: st.skipped.clone(),
            memory: st.memory.clone(),
        };
        let result = ExportResult {
            txs: st.txs.len(),
            shops: st.memory.len(),
            sms: st.inbox.len(),
        };
        (backup, result)
    };
    let bytes = serde_json::to_vec_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("couldn't save the file: {e}"))?;

    state.store.lock().unwrap().last_export = Some(now());
    save(&state);
    let _ = state.app.emit("tx-updated", ());
    Ok(result)
}

// merges a backup into what's here, nothing gets deleted
#[tauri::command]
pub(crate) fn import_data(
    state: tauri::State<Shared>,
    path: String,
) -> Result<ImportResult, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("couldn't open the file: {e}"))?;
    let raw: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "this isn't a json file".to_string())?;
    if raw.get("salli_export").is_none() {
        return Err("this isn't a salli backup file".into());
    }
    let backup: Backup =
        serde_json::from_value(raw).map_err(|e| format!("backup file is broken: {e}"))?;

    let result = {
        let mut st = state.store.lock().unwrap();
        let mut added_sms = 0;
        for m in backup.inbox {
            if !st.inbox.iter().any(|x| x.id == m.id) {
                st.inbox.push(m);
                added_sms += 1;
            }
        }
        let mut added_txs = 0;
        for t in backup.txs {
            if !st.txs.iter().any(|x| x.id == t.id) {
                st.txs.push(t);
                added_txs += 1;
            }
        }
        for id in backup.skipped {
            if !st.skipped.contains(&id) {
                st.skipped.push(id);
            }
        }
        let shops = backup.memory.len();
        st.memory.extend(backup.memory);
        st.onboarded = true;
        ImportResult {
            added_txs,
            added_sms,
            shops,
        }
    };
    save(&state);
    let _ = state.app.emit("tx-updated", ());
    spawn_parser(state.inner().clone());
    Ok(result)
}

#[tauri::command]
pub(crate) fn unpair_all(state: tauri::State<Shared>) {
    state.store.lock().unwrap().sessions.clear();
    save(&state);
    let _ = state.app.emit("tx-updated", ());
}

#[tauri::command]
pub(crate) fn reset_memory(state: tauri::State<Shared>) {
    state.store.lock().unwrap().memory.clear();
    save(&state);
    let _ = state.app.emit("tx-updated", ());
}

#[tauri::command]
pub(crate) fn delete_all_data(state: tauri::State<Shared>) {
    *state.store.lock().unwrap() = Store::default();
    save(&state);
    let _ = state.app.emit("tx-updated", ());
}
