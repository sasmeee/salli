use crate::state::Sms;
use regex::Regex;
use std::sync::LazyLock;

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
    Regex::new(r"(?i)transfer(?:red)?\s+from\s+([A-Za-z .]{2,30}?)(?:[.,]|\s+avl|\s+on\s|$)")
        .unwrap()
});
static PROMO_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(\d+\s*%\s*off|\bsale\b|\bearn\b|\bpoints\b|\boffers?\b|t&c|shop now|\bwin\b|discount|promo)")
        .unwrap()
});
static RIDE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(trip|ride|riding|fare)\b").unwrap());

const BANKS: [&str; 18] = [
    "BOC",
    "COMBANK",
    "COMMERCIAL",
    "HNB",
    "SAMPATH",
    "NDB",
    "PEOPLES",
    "NSB",
    "DFCC",
    "SEYLAN",
    "NTB",
    "NATIONS",
    "PABC",
    "AMANA",
    "UNION",
    "HSBC",
    "SCB",
    "STANDARD",
];

pub(crate) struct Rules {
    pub(crate) amount: Option<f64>,
    pub(crate) kind: Option<String>,
    pub(crate) key: Option<String>,
    pub(crate) merchant: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) skip: bool,
}

// drops card numbers and refs so the same shop always gets the same key
fn norm(s: &str) -> String {
    s.split_whitespace()
        .filter(|w| w.chars().filter(|c| c.is_ascii_digit()).count() < 3)
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
}

pub(crate) fn title(s: &str) -> String {
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

pub(crate) fn rules(m: &Sms) -> Rules {
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
        return Rules {
            amount,
            kind: None,
            key: None,
            merchant: None,
            category: None,
            skip: true,
        };
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
        .or_else(|| {
            if is_bank(&m.address) {
                None
            } else {
                Some(norm(&m.address))
            }
        })
        .filter(|k| !k.is_empty());

    Rules {
        amount,
        kind,
        key,
        merchant,
        category,
        skip: false,
    }
}
