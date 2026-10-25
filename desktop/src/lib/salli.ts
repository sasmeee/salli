export type Pairing = {
  ip: string;
  port: number;
  code: string;
  expires_at: number;
};

export type Tx = {
  id: string;
  date: number;
  sender: string;
  body: string;
  amount: number;
  kind: "debit" | "credit";
  merchant: string;
  category: string;
  source: "rule" | "memory" | "ai" | "you";
  key: string | null;
};

export type View = {
  txs: Tx[];
  total_sms: number;
  pending: number;
  busy: boolean;
  paired: boolean;
  memory_size: number;
  last_error: string | null;
  onboarded: boolean;
  last_sync: number | null;
  last_export: number | null;
};

export const CATEGORIES = [
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

const CAT: Record<string, { bg: string; fg: string }> = {
  Groceries: { bg: "#E4EEDD", fg: "#4E7A3C" },
  Food: { bg: "#FBEBD3", fg: "#B7741A" },
  Transport: { bg: "#DDE9EE", fg: "#3E6D80" },
  Bills: { bg: "#EDE6DC", fg: "#7A6650" },
  Subscriptions: { bg: "#ECE3F2", fg: "#7D52A0" },
  Shopping: { bg: "#F6E0DA", fg: "#B24A35" },
  Health: { bg: "#DCF0E6", fg: "#1F8A5C" },
  Entertainment: { bg: "#F7E1E8", fg: "#B0466A" },
  Salary: { bg: "#E3F1E8", fg: "#1E6B47" },
  Transfer: { bg: "#E0EDF2", fg: "#3E7590" },
  Other: { bg: "#EFEAE3", fg: "#7D7064" },
};

export const catColor = (c: string) => CAT[c] ?? CAT.Other;

export const SOURCE_LABEL: Record<string, string> = {
  rule: "rule",
  memory: "from memory",
  ai: "read by Gemma",
  you: "fixed by you",
};

const DAY = 86400000;

export const num = (n: number) => Math.round(n).toLocaleString("en-LK");
export const lkr = (n: number) => "LKR " + num(n);
export const lkrExact = (n: number) =>
  "LKR " +
  n.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function relTime(sec: number | null): string {
  if (!sec) return "never";
  const d = Date.now() / 1000 - sec;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(sec * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export const monthKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
};

export const shiftMonth = (key: string, by: number) => {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + by, 1).getTime());
};

export type DayBar = {
  day: number;
  total: number;
  forecast: boolean;
  unusual: boolean;
};
export type CatRow = { name: string; total: number; pct: number };
export type ShopRow = {
  name: string;
  total: number;
  count: number;
  category: string;
};

export type Insights = {
  txs: Tx[];
  spent: number;
  income: number;
  delta: number | null;
  isCurrent: boolean;
  daysLeft: number;
  forecast: number;
  incomeUsed: number | null;
  daily: DayBar[];
  maxDay: number;
  cats: CatRow[];
  shops: ShopRow[];
  roast: string | null;
};

const sum = (xs: Tx[]) => xs.reduce((s, t) => s + t.amount, 0);

export function insights(all: Tx[], month: string): Insights {
  const txs = all
    .filter((t) => monthKey(t.date) === month)
    .sort((a, b) => b.date - a.date);
  const debits = txs.filter((t) => t.kind === "debit");
  const spent = sum(debits);
  const income = sum(txs.filter((t) => t.kind === "credit"));
  const prev = sum(
    all.filter(
      (t) => t.kind === "debit" && monthKey(t.date) === shiftMonth(month, -1),
    ),
  );

  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = month === monthKey(Date.now());
  const today = new Date().getDate();
  const elapsed = isCurrent ? today : daysInMonth;
  const avg = elapsed > 0 ? spent / elapsed : 0;
  // simple average for now, tabpfn takes over later
  const forecast = isCurrent ? avg * daysInMonth : spent;

  const totals = Array.from({ length: daysInMonth }, (_, i) =>
    sum(debits.filter((t) => new Date(t.date).getDate() === i + 1)),
  );
  const real = totals.slice(0, elapsed).filter((v) => v > 0);
  const mean = real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
  const sd = real.length
    ? Math.sqrt(real.reduce((a, b) => a + (b - mean) ** 2, 0) / real.length)
    : 0;
  const daily: DayBar[] = totals.map((v, i) => {
    const future = isCurrent && i + 1 > today;
    return {
      day: i + 1,
      total: future ? avg : v,
      forecast: future,
      unusual: !future && real.length > 3 && v > mean + 2 * sd,
    };
  });

  const catMap = new Map<string, number>();
  for (const t of debits)
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + t.amount);
  const cats = [...catMap.entries()]
    .map(([name, total]) => ({
      name,
      total,
      pct: spent ? Math.round((total / spent) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const shopMap = new Map<string, ShopRow>();
  for (const t of debits) {
    const s = shopMap.get(t.merchant) ?? {
      name: t.merchant,
      total: 0,
      count: 0,
      category: t.category,
    };
    s.total += t.amount;
    s.count += 1;
    shopMap.set(t.merchant, s);
  }
  const shops = [...shopMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    txs,
    spent,
    income,
    delta: prev > 0 ? Math.round(((spent - prev) / prev) * 100) : null,
    isCurrent,
    daysLeft: isCurrent ? daysInMonth - today : 0,
    forecast,
    incomeUsed: income > 0 ? spent / income : null,
    daily,
    maxDay: Math.max(1, ...daily.map((d) => d.total)),
    cats,
    shops,
    roast: roast(debits),
  };
}

// placeholder roast until gemma writes them
function roast(debits: Tx[]): string | null {
  const m = new Map<string, ShopRow>();
  for (const t of debits) {
    if (t.category === "Bills" || t.category === "Subscriptions") continue;
    const s = m.get(t.merchant) ?? {
      name: t.merchant,
      total: 0,
      count: 0,
      category: t.category,
    };
    s.total += t.amount;
    s.count += 1;
    m.set(t.merchant, s);
  }
  const top = [...m.values()]
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count)[0];
  if (!top) return null;
  const k = `LKR ${Math.round(top.total / 1000)}k`;
  switch (top.category) {
    case "Food":
      return `Machan, ${top.count} ${top.name} orders this month. That's ${k} on food you didn't cook. Sloth approves, wallet doesn't.`;
    case "Transport":
      return `${top.count} ${top.name} rides this month, ${k}. Legs are free, machan.`;
    case "Groceries":
      return `${top.count} trips to ${top.name}, ${k}. At least you're eating.`;
    case "Shopping":
      return `${top.count} times at ${top.name}, ${k}. Did you need it, or did it just look nice?`;
    default:
      return `${top.count} payments to ${top.name} this month, ${k} total.`;
  }
}

export type Sub = {
  merchant: string;
  amount: number;
  next: number;
  rising: boolean;
};

// same shop charging about every month, or anything marked as a subscription
export function subscriptions(all: Tx[]): Sub[] {
  const by = new Map<string, Tx[]>();
  for (const t of all) {
    if (t.kind !== "debit") continue;
    by.set(t.merchant, [...(by.get(t.merchant) ?? []), t]);
  }
  const out: Sub[] = [];
  for (const [merchant, list] of by) {
    const xs = [...list].sort((a, b) => a.date - b.date);
    const gaps = xs.slice(1).map((t, i) => (t.date - xs[i].date) / DAY);
    const avgGap = gaps.length
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : 30;
    const monthly = gaps.length >= 1 && avgGap >= 25 && avgGap <= 35;
    const isSub = xs.some((t) => t.category === "Subscriptions");
    if (!monthly && !isSub) continue;
    const last = xs[xs.length - 1];
    const before = xs[xs.length - 2];
    out.push({
      merchant,
      amount: last.amount,
      next: last.date + (monthly ? avgGap : 30) * DAY,
      rising: !!before && last.amount > before.amount * 1.15,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export function dayLabel(ms: number): string {
  const d = new Date(ms);
  const t = new Date();
  const y = new Date(Date.now() - DAY);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const base = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  if (same(d, t)) return `Today, ${base}`;
  if (same(d, y)) return `Yesterday, ${base}`;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
