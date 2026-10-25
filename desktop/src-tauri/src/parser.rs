use crate::gemma::{BATCH, CATEGORIES, ask_gemma_batch};
use crate::rules::{Rules, rules, title};
use crate::state::{MerchantInfo, Shared, Sms, Tx, save};
use std::collections::HashSet;
use tauri::Emitter;

// reads new sms in the background: rules first, then memory, then gemma
pub(crate) fn spawn_parser(s: Shared) {
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
                            Some(MerchantInfo {
                                merchant: mm.clone(),
                                category: cc.clone(),
                            }),
                            "rule",
                        ),
                        _ => (
                            r.key.as_ref().and_then(|k| st.memory.get(k)).cloned(),
                            "memory",
                        ),
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
                            merged: Vec::new(),
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
                            Some(it)
                                if it.is_transaction
                                    || (r.amount.is_some() && r.kind.is_some()) =>
                            {
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
                                        r.key
                                            .as_deref()
                                            .map(title)
                                            .unwrap_or_else(|| title(&m.address))
                                    } else {
                                        it.merchant.clone()
                                    }
                                });
                                if let Some(k) = &r.key {
                                    st.memory.insert(
                                        k.clone(),
                                        MerchantInfo {
                                            merchant: merchant.clone(),
                                            category: category.clone(),
                                        },
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
                                    merged: Vec::new(),
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
