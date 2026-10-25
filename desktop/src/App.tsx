import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { QRCodeSVG } from "qrcode.react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import "./App.css";

type Pairing = { ip: string; port: number; code: string; expires_at: number };
type Tx = {
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
type View = {
  txs: Tx[];
  total_sms: number;
  pending: number;
  busy: boolean;
  paired: boolean;
  memory_size: number;
  last_error: string | null;
};

const CATEGORIES = [
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
const EMOJI: Record<string, string> = {
  Food: "🍛",
  Groceries: "🛒",
  Transport: "🛺",
  Bills: "💡",
  Shopping: "🛍️",
  Salary: "💰",
  Transfer: "🔁",
  Entertainment: "🎬",
  Health: "💊",
  Subscriptions: "📺",
  Other: "🦥",
};
const SOURCE: Record<string, string> = {
  rule: "⚡ rule",
  memory: "⚡ memory",
  ai: "🧠 Gemma",
  you: "✋ you",
};

const lkr = (n: number) =>
  "LKR " +
  n.toLocaleString("en-LK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

function PairCard({
  pair,
  left,
  onClose,
}: {
  pair: Pairing | null;
  left: number;
  onClose?: () => void;
}) {
  const qr = pair
    ? JSON.stringify({
        app: "salli",
        ip: pair.ip,
        port: pair.port,
        code: pair.code,
      })
    : "";
  const pretty = pair
    ? `${pair.code.slice(0, 3)} ${pair.code.slice(3)}`
    : "--- ---";
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Pair your phone</CardTitle>
        <CardDescription>
          Scan the QR, or type the code in the Salli app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {pair && (
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG value={qr} size={200} />
          </div>
        )}
        <div className="text-center">
          <p className="font-mono text-4xl font-bold tracking-widest">
            {pretty}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {pair?.ip}:{pair?.port}
          </p>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(left / 30) * 100}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">New code in {left}s</p>
        <Badge variant="secondary">Same WiFi only · no cloud</Badge>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function App() {
  const [pair, setPair] = useState<Pairing | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [left, setLeft] = useState(30);
  const [showPair, setShowPair] = useState(false);

  const loadPair = () => invoke<Pairing>("pairing_info").then(setPair);
  const loadView = () => invoke<View>("get_state").then(setView);

  useEffect(() => {
    loadPair();
    loadView();
    const subs = [
      listen("code-changed", loadPair),
      listen("sms-synced", loadView),
      listen("tx-updated", loadView),
      listen("phone-paired", () => {
        setShowPair(false);
        loadView();
      }),
    ];
    return () => subs.forEach((p) => p.then((f) => f()));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (pair)
        setLeft(Math.max(0, pair.expires_at - Math.floor(Date.now() / 1000)));
    }, 250);
    return () => clearInterval(t);
  }, [pair]);

  if (!view) return null;

  if (!view.paired) {
    return (
      <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-6 p-8">
        <div className="text-center">
          <h1 className="text-5xl font-bold">🦥 Salli</h1>
          <p className="text-muted-foreground mt-2">
            Your money, read by AI on your own laptop.
          </p>
        </div>
        <PairCard pair={pair} left={left} />
      </main>
    );
  }

  const txs = [...view.txs].sort((a, b) => b.date - a.date);
  const spent = txs
    .filter((t) => t.kind === "debit")
    .reduce((s, t) => s + t.amount, 0);
  const income = txs
    .filter((t) => t.kind === "credit")
    .reduce((s, t) => s + t.amount, 0);
  const bySource = (s: string) => txs.filter((t) => t.source === s).length;

  const fix = (t: Tx, category: string) =>
    invoke("fix_tx", { id: t.id, merchant: t.merchant, category });

  return (
    <main className="min-h-screen bg-background text-foreground p-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold">🦥 Salli</h1>
          <p className="text-muted-foreground">
            Your money, read by AI on your own laptop.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-income text-white">📱 Phone paired</Badge>
          <Button variant="outline" size="sm" onClick={() => setShowPair(true)}>
            Pair another
          </Button>
        </div>
      </header>

      {showPair && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setShowPair(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PairCard
              pair={pair}
              left={left}
              onClose={() => setShowPair(false)}
            />
          </div>
        </div>
      )}

      {view.busy && view.pending > 0 && (
        <div className="mb-6 rounded-lg border bg-accent px-4 py-3 text-sm text-accent-foreground">
          🧠 Gemma is reading {view.pending} SMS on your laptop…
        </div>
      )}
      {view.last_error && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-spend/40 bg-spend/10 px-4 py-3 text-sm">
          <span>⚠️ {view.last_error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => invoke("retry_parse")}
          >
            Retry
          </Button>
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Spent</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-spend">{lkr(spent)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Income</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-income">{lkr(income)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{txs.length}</p>
            <p className="text-xs text-muted-foreground">
              from {view.total_sms} SMS
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>How they were read</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>⚡ {bySource("rule")} instant by rules</p>
            <p>⚡ {bySource("memory")} instant from memory</p>
            <p>🧠 {bySource("ai")} by Gemma</p>
            <p>✋ {bySource("you")} fixed by you</p>
            <p className="text-xs text-muted-foreground">
              {view.memory_size} shops remembered
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>
            Wrong category? Change it once, Salli remembers forever.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {txs.length === 0 && (
            <p className="text-muted-foreground py-4">
              Nothing yet. Tap Send on your phone. 🦥
            </p>
          )}
          {txs.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-4 py-3"
              title={t.body}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">{EMOJI[t.category] ?? "🦥"}</span>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{t.merchant}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.sender} · {new Date(t.date).toLocaleDateString()} ·{" "}
                    {SOURCE[t.source] ?? ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <select
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  value={t.category}
                  onChange={(e) => fix(t, e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {EMOJI[c]} {c}
                    </option>
                  ))}
                </select>
                <p
                  className={`w-36 text-right font-mono font-semibold ${t.kind === "credit" ? "text-income" : "text-spend"}`}
                >
                  {t.kind === "credit" ? "+" : "−"} {lkr(t.amount)}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
