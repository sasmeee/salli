// run: bun run tools/bench.ts 100 (desktop app must be open)
import { existsSync, readFileSync } from "fs";

const N = Number(process.argv[2] ?? 200);
const HOST = "http://127.0.0.1:7777";
const DATA = `${process.env.APPDATA}/com.salli.desktop/salli.json`;

type Truth = {
  isTx: boolean;
  amount: number;
  kind: "debit" | "credit";
  merchant: string;
  category: string;
};

const SHOPS = [
  { raw: "KEELLS SUPER COLOMBO 07", merchant: "Keells", category: "Groceries" },
  {
    raw: "CARGILLS FOOD CITY KANDY",
    merchant: "Cargills",
    category: "Groceries",
  },
  { raw: "KFC MAJESTIC CITY", merchant: "KFC", category: "Food" },
  { raw: "PIZZA HUT NUGEGODA", merchant: "Pizza Hut", category: "Food" },
  { raw: "UBER EATS COLOMBO", merchant: "Uber Eats", category: "Food" },
  { raw: "ODEL ALEXANDRA PLACE", merchant: "Odel", category: "Shopping" },
  { raw: "DARAZ LK", merchant: "Daraz", category: "Shopping" },
  { raw: "NETFLIX.COM", merchant: "Netflix", category: "Subscriptions" },
  { raw: "SPOTIFY P1234", merchant: "Spotify", category: "Subscriptions" },
  { raw: "LANKA IOC KOTTAWA", merchant: "Lanka IOC", category: "Transport" },
  { raw: "OSU SALA COLOMBO 03", merchant: "Osu Sala", category: "Health" },
  {
    raw: "SCOPE CINEMAS CCC",
    merchant: "Scope Cinemas",
    category: "Entertainment",
  },
  { raw: "CEB ONLINE PAYMENT", merchant: "CEB", category: "Bills" },
];

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const amt = (min: number, max: number) =>
  Math.round((min + Math.random() * (max - min)) * 100) / 100;
const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2 });
const acct = () => String(1000 + Math.floor(Math.random() * 9000));

// makes one fake sms and the answer we expect back
function make(i: number) {
  const date = Date.now() - Math.floor(Math.random() * 60) * 86400000;
  const d = new Date(date).toLocaleDateString("en-GB");
  const bal = fmt(amt(5000, 200000));
  const r = Math.random();

  let address: string, body: string, truth: Truth;

  if (r < 0.6) {
    const s = pick(SHOPS);
    const a = amt(200, 15000);
    const t = pick([
      () => ({
        address: "COMBANK",
        body: `Your A/C ***${acct()} debited LKR ${fmt(a)} at ${s.raw} on ${d}. Avl Bal LKR ${bal}`,
      }),
      () => ({
        address: "BOC",
        body: `BOC: Rs.${fmt(a)} spent at ${s.raw} using card ending ${acct()} on ${d}. Bal Rs.${bal}`,
      }),
      () => ({
        address: "HNB",
        body: `HNB Alert: Purchase of LKR ${fmt(a)} at ${s.raw} on ${d}. Available Bal LKR ${bal}`,
      }),
      () => ({
        address: "SAMPATH",
        body: `Sampath Bank: Your card ***${acct()} was charged LKR ${fmt(a)} at ${s.raw} ${d}.`,
      }),
    ])();
    ({ address, body } = t);
    truth = {
      isTx: true,
      amount: a,
      kind: "debit",
      merchant: s.merchant,
      category: s.category,
    };
  } else if (r < 0.72) {
    const a = amt(150, 2500);
    if (Math.random() < 0.5) {
      address = "PickMe";
      body = `Your trip fare LKR ${fmt(a)} paid by card. Thank you for riding with PickMe.`;
      truth = {
        isTx: true,
        amount: a,
        kind: "debit",
        merchant: "PickMe",
        category: "Transport",
      };
    } else {
      address = "Uber";
      body = `Uber: Your trip LKR ${fmt(a)} has been paid. Thanks for riding.`;
      truth = {
        isTx: true,
        amount: a,
        kind: "debit",
        merchant: "Uber",
        category: "Transport",
      };
    }
  } else if (r < 0.82) {
    const salary = Math.random() < 0.5;
    const a = salary ? amt(60000, 250000) : amt(1000, 50000);
    address = pick(["BOC", "COMBANK", "NDB"]);
    body = `LKR ${fmt(a)} credited to A/C ***${acct()} ${salary ? "SALARY OCT" : "TRANSFER FROM K PERERA"}. Avl Bal LKR ${bal}`;
    truth = {
      isTx: true,
      amount: a,
      kind: "credit",
      merchant: salary ? "Salary" : "K Perera",
      category: salary ? "Salary" : "Transfer",
    };
  } else if (r < 0.9) {
    const a = amt(800, 12000);
    address = "Dialog";
    body = `Dialog: Your bill payment of Rs.${fmt(a)} has been received. Thank you.`;
    truth = {
      isTx: true,
      amount: a,
      kind: "debit",
      merchant: "Dialog",
      category: "Bills",
    };
  } else {
    address = pick(["CARGILLS", "ODEL", "KEELLS"]);
    body = pick([
      "Get 20% off at Cargills this weekend! Min spend Rs.5000. T&C apply.",
      "ODEL Mega Sale! Up to 50% off on all items. Shop now at odel.lk",
      "Keells Nexus: Earn double points on purchases above Rs.3000 this week!",
    ]);
    truth = {
      isTx: false,
      amount: 0,
      kind: "debit",
      merchant: "",
      category: "Other",
    };
  }

  return {
    sms: { id: `bench-${Date.now()}-${i}`, address, body, date },
    truth,
  };
}

// "Keells" and "Keells Super" both count as right
const loose = (a: string, b: string) => {
  const x = a.toLowerCase().trim(),
    y = b.toLowerCase().trim();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
};

const code = prompt("Enter the 6-digit pairing code shown on desktop:");
const pairRes = await fetch(`${HOST}/pair`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code }),
});
if (!pairRes.ok) throw new Error("Pairing failed (code expired?)");
const { token } = await pairRes.json();

const cases = Array.from({ length: N }, (_, i) => make(i));

console.log(`Sending ${N} fake SMS…`);
const t0 = Date.now();
await fetch(`${HOST}/sync`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-salli-token": token },
  body: JSON.stringify({ messages: cases.map((c) => c.sms) }),
});

// wait until salli has read every fake sms
let store: any;
while (true) {
  await Bun.sleep(1000);
  if (!existsSync(DATA)) continue;
  try {
    store = JSON.parse(readFileSync(DATA, "utf8"));
  } catch {
    continue;
  }
  const done = cases.filter(
    (c) =>
      store.txs.some((t: any) => t.id === c.sms.id) ||
      store.skipped.includes(c.sms.id),
  ).length;
  process.stdout.write(
    `\r  parsed ${done}/${N}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  if (done >= N) break;
}
const secs = (Date.now() - t0) / 1000;

let amountOk = 0,
  kindOk = 0,
  catOk = 0,
  merchOk = 0,
  txCount = 0,
  promoOk = 0,
  promoCount = 0;
const sources: Record<string, number> = {};
const mistakes: any[] = [];
for (const c of cases) {
  const tx = store.txs.find((t: any) => t.id === c.sms.id);
  const tr = c.truth;
  if (!tr.isTx) {
    promoCount++;
    if (!tx) promoOk++;
    else mistakes.push({ what: "promo kept", sms: c.sms.body.slice(0, 50) });
    continue;
  }
  txCount++;
  if (!tx) {
    mistakes.push({ what: "missed tx", sms: c.sms.body.slice(0, 50) });
    continue;
  }
  sources[tx.source] = (sources[tx.source] ?? 0) + 1;
  if (Math.abs(tx.amount - tr.amount) < 0.01) amountOk++;
  else
    mistakes.push({
      what: "amount",
      expected: tr.amount,
      got: tx.amount,
      sms: c.sms.body.slice(0, 50),
    });
  if (tx.kind === tr.kind) kindOk++;
  else
    mistakes.push({
      what: "kind",
      expected: tr.kind,
      got: tx.kind,
      sms: c.sms.body.slice(0, 50),
    });
  if (tx.category === tr.category) catOk++;
  else
    mistakes.push({
      what: "category",
      merchant: tx.merchant,
      expected: tr.category,
      got: tx.category,
      via: tx.source,
    });
  if (loose(tx.merchant, tr.merchant)) merchOk++;
  else
    mistakes.push({
      what: "merchant",
      expected: tr.merchant,
      got: tx.merchant,
    });
}
const pct = (a: number, b: number) =>
  `${((a / Math.max(b, 1)) * 100).toFixed(1)}%`;

console.log(
  `\n\n🦥 Salli benchmark — ${N} SMS in ${secs.toFixed(1)}s (${((secs / N) * 1000).toFixed(0)} ms/SMS)`,
);
console.table({
  Amount: pct(amountOk, txCount),
  "Debit/credit": pct(kindOk, txCount),
  Merchant: pct(merchOk, txCount),
  Category: pct(catOk, txCount),
  "Ads/promos ignored": pct(promoOk, promoCount),
});
console.log("Read by:", sources);
if (mistakes.length) {
  // same mistake repeated is shown once
  const uniq = [
    ...new Map(
      mistakes.map((m) => [JSON.stringify({ ...m, sms: undefined }), m]),
    ).values(),
  ];
  console.log(`\nMistakes (${mistakes.length} total, ${uniq.length} unique):`);
  console.table(uniq.slice(0, 25));
}
console.log(
  "\nTip: bench SMS are now in your data. Delete salli.json before the real demo.",
);
