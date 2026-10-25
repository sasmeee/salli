use crate::rules::is_bank;
use crate::state::Tx;

// sms about the same payment can arrive a bit apart
const WINDOW_MS: f64 = 60.0 * 60.0 * 1000.0;

// one payment often sends 2 to 4 sms (bank alert, shop receipt, wallet),
// keep one row and fold the rest into it. raw data is never touched.
pub(crate) fn merge_duplicates(mut txs: Vec<Tx>) -> Vec<Tx> {
    txs.sort_by(|a, b| a.date.total_cmp(&b.date));
    let mut out: Vec<Tx> = Vec::new();

    'next: for t in txs {
        for kept in out.iter_mut().rev() {
            if t.date - kept.date > WINDOW_MS {
                break;
            }
            let same_amount = (kept.amount - t.amount).abs() < 0.01;
            // two bank alerts with the same amount can be two real payments
            let has_receipt = !is_bank(&t.sender) || !is_bank(&kept.sender);
            if !same_amount || !has_receipt {
                continue;
            }
            // the bank's message is the most reliable, make it the main row
            if is_bank(&t.sender) && !is_bank(&kept.sender) {
                let old = std::mem::replace(kept, t);
                kept.merged.push(old.sender);
                kept.merged.extend(old.merged);
            } else {
                kept.merged.push(t.sender);
            }
            continue 'next;
        }
        out.push(t);
    }
    out
}
