use std::time::Duration;

use serde::Deserialize;
use serde_json::json;

const MODEL: &str = "gemma3:4b";
const OLLAMA: &str = "http://127.0.0.1:11434/api/chat";

const SYSTEM: &str = "You are Salli, a lazy sloth who roasts people about how they spend money in Sri Lanka. \
Write one or two short sentences, at most 35 words. Be funny and cheeky, never cruel. \
Use the real shop names and numbers you are given, written like LKR 12k. \
Pick the most roastable habit, like many food orders, many rides or one big splurge. \
Fuel stations like Lanka IOC or Ceypetco are fuel, not rides. \
You may say machan once. No emoji, no hashtags, no quotes, no advice lists.";

#[derive(Deserialize)]
pub struct Shop {
    name: String,
    category: String,
    count: u32,
    total: f64,
}

#[derive(Deserialize)]
pub struct Cat {
    name: String,
    total: f64,
    pct: u32,
}

#[derive(Deserialize)]
pub struct RoastInput {
    month: String,
    spent: f64,
    income: f64,
    delta: Option<i64>,
    shops: Vec<Shop>,
    cats: Vec<Cat>,
}

#[tauri::command]
pub async fn roast(input: RoastInput) -> Result<String, String> {
    let mut facts = format!(
        "Month: {}\nSpent: LKR {:.0}\nIncome: LKR {:.0}\n",
        input.month, input.spent, input.income
    );
    if let Some(d) = input.delta {
        facts += &format!("Change vs last month: {d}%\n");
    }
    facts += "Top shops:\n";
    for s in input.shops.iter().take(5) {
        facts += &format!(
            "- {} ({}): {} times, LKR {:.0}\n",
            s.name, s.category, s.count, s.total
        );
    }
    facts += "Categories:\n";
    for c in input.cats.iter().take(5) {
        facts += &format!("- {}: LKR {:.0} ({}%)\n", c.name, c.total, c.pct);
    }

    let body = json!({
        "model": MODEL,
        "stream": false,
        "keep_alive": "30m",
        "options": { "temperature": 0.9, "num_predict": 80 },
        "messages": [
            { "role": "system", "content": SYSTEM },
            { "role": "user", "content": facts },
        ],
    });

    let res: serde_json::Value = reqwest::Client::new()
        .post(OLLAMA)
        .timeout(Duration::from_secs(60))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let text = res["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .to_string();

    if text.is_empty() {
        return Err("gemma had nothing to say".into());
    }
    Ok(text)
}
