use crate::rules::title;
use serde::Deserialize;

pub(crate) const MODEL: &str = "gemma3:4b";
pub(crate) const OLLAMA: &str = "http://127.0.0.1:11434";
// one sms per call, bigger batches made gemma mix up lines
pub(crate) const BATCH: usize = 1;
pub(crate) const CATEGORIES: [&str; 11] = [
    "Food",
    "Groceries",
    "Transport",
    "Bills",
    "Shopping",
    "Salary",
    "Transfer",
    "Entertainment",
    "Health",
    "Subscriptions",
    "Other",
];

#[derive(Deserialize)]
pub(crate) struct AiItem {
    pub(crate) i: usize,
    #[serde(default)]
    shop_text: String,
    pub(crate) is_transaction: bool,
    pub(crate) amount: f64,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) merchant: String,
    pub(crate) category: String,
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
A taxi ride or trip from Uber is merchant 'Uber', never 'Uber Eats'. Uber Eats is only for food orders. \
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

pub(crate) async fn ask_gemma_batch(
    client: &reqwest::Client,
    sms: &[&str],
) -> Result<Vec<AiItem>, String> {
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
                .map(|w| {
                    if w.len() <= 4 {
                        w.to_uppercase()
                    } else {
                        title(w)
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
        }
    }
    Ok(batch.items)
}
