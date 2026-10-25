import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Logo } from "@/components/Logo";
import { ChevronLeft, ChevronRight, Lightbulb, Search, Settings, type LucideIcon } from "lucide-react";
import {
  CATEGORIES, SOURCE_LABEL, catColor, dayLabel, forecastInput, insights, lkr, lkrExact, monthKey, monthLabel,
  relTime, shiftMonth, subscriptions, type Tx, type View,
} from "@/lib/salli";

const card = "rounded-3xl border bg-card p-5 sm:p-6";

export function Dashboard({ view, onSettings }: { view: View; onSettings: () => void }) {
  const latest = useMemo(
    () => (view.txs.length ? monthKey(Math.max(...view.txs.map((t) => t.date))) : monthKey(Date.now())),
    [view.txs],
  );
  const earliest = useMemo(
    () => (view.txs.length ? monthKey(Math.min(...view.txs.map((t) => t.date))) : latest),
    [view.txs, latest],
  );
  const [month, setMonth] = useState(latest);
  const [cat, setCat] = useState("All");
  const [query, setQuery] = useState("");

  const ins = useMemo(() => insights(view.txs, month), [view.txs, month]);
  const subs = useMemo(() => subscriptions(view.txs), [view.txs]);
  const subTotal = subs.reduce((s, x) => s + x.amount, 0);
  const label = monthLabel(month);
  const shortMonth = label.split(" ")[0];
  const roast = useRoast(ins, label, view.busy);
  const fc = useForecast(view.txs, ins, view.busy);

  const shown = ins.txs.filter(
    (t) =>
      (cat === "All" || t.category === cat) &&
      (!query || `${t.merchant} ${t.amount} ${t.sender}`.toLowerCase().includes(query.toLowerCase())),
  );
  const groups = groupByDay(shown);

  return (
    <main className="min-h-screen bg-background text-foreground tabular-nums">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-8">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div>
              <p className="text-xl leading-tight font-bold">Salli</p>
              <p className="hidden text-[13px] text-muted-foreground sm:block">Your money, read on your own laptop</p>
            </div>
          </div>

          <div role="group" aria-label="Month" className="flex items-center gap-1 rounded-xl bg-muted p-1">
            <IconButton icon={ChevronLeft} label="Previous month" disabled={month <= earliest} onClick={() => setMonth(shiftMonth(month, -1))} />
            <div className="flex h-9 min-w-36 items-center justify-center rounded-lg bg-card px-3.5 text-sm font-semibold">{label}</div>
            <IconButton icon={ChevronRight} label="Next month" disabled={month >= monthKey(Date.now())} onClick={() => setMonth(shiftMonth(month, 1))} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 rounded-full bg-good-bg px-3 py-2 text-[13px] font-semibold text-good">
              <span className="size-2 rounded-full bg-good-strong" />
              Synced · {relTime(view.last_sync)}
            </span>
            <span className="hidden items-center gap-2 rounded-full border bg-card px-3 py-2 text-[13px] font-medium text-muted-foreground md:flex">
              {view.busy && view.pending > 0 ? `Gemma reading ${view.pending}…` : "Gemma 3 · offline"}
            </span>
            <button
              type="button"
              aria-label="Settings"
              onClick={onSettings}
              className="flex size-10 items-center justify-center rounded-xl border bg-card hover:bg-muted"
            >
              <Settings size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 pt-5 pb-16 sm:gap-6 sm:px-8 sm:pt-6">
        {view.last_error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bad-border bg-bad-bg px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">{view.last_error}</span>
            <button type="button" onClick={() => invoke("retry_parse")} className="h-9 rounded-lg border bg-card px-3 font-semibold">
              Retry
            </button>
          </div>
        )}

        <section aria-label="This month" className="grid gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-5 rounded-3xl border border-hero-accent/20 bg-hero p-5 text-hero-foreground sm:p-7 lg:col-span-2 dark:border-border">
            <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm opacity-75">
              <span>Spent in {shortMonth}</span>
              {ins.isCurrent && <span>{ins.daysLeft} days left</span>}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <p className="text-[40px] leading-none font-bold tracking-tight sm:text-[56px]">
                <span className="mr-1.5 text-lg font-semibold opacity-70 sm:text-[22px]">LKR</span>
                {Math.round(ins.spent).toLocaleString("en-LK")}
              </p>
              {ins.delta !== null && (
                <span className="text-sm font-semibold text-hero-accent">
                  {ins.delta >= 0 ? "▲" : "▼"} {Math.abs(ins.delta)}% vs last month
                </span>
              )}
            </div>
            {ins.incomeUsed !== null && (
              <div className="flex flex-col gap-2">
                <div className="relative h-3 overflow-hidden rounded-full bg-hero-foreground/10">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-hero-accent" style={{ width: `${Math.min(100, ins.incomeUsed * 100)}%` }} />
                  {ins.isCurrent && ins.income > 0 && (
                    <div
                      className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,var(--hero-accent)_0_6px,transparent_6px_12px)] opacity-40"
                      style={{
                        left: `${Math.min(100, ins.incomeUsed * 100)}%`,
                        width: `${Math.max(0, Math.min(100, (fc.total / ins.income) * 100) - ins.incomeUsed * 100)}%`,
                      }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-[13px] opacity-75">
                  <span>{Math.round(ins.incomeUsed * 100)}% of income used</span>
                  {ins.isCurrent && (
                    <span>
                      Forecast for {shortMonth}: <strong className="opacity-100">{lkr(fc.total)}</strong>
                      {fc.byTabpfn && <span className="ml-1.5 rounded-full bg-hero-foreground/10 px-2 py-0.5 text-[11px] font-semibold">TabPFN</span>}
                    </span>
                  )}
                </div>
                {ins.isCurrent && fc.byTabpfn && (
                  <p className="text-[13px] font-semibold text-hero-accent">
                    {fc.runsOut
                      ? `At this pace your money runs out around ${fc.runsOut} ${shortMonth.slice(0, 3)}`
                      : `At this pace you end ${shortMonth} with about ${lkr(ins.income - fc.total)} left`}
                  </p>
                )}
              </div>
            )}
            {roast.text && (
              <div className="flex items-start gap-3 rounded-2xl bg-hero-foreground/5 px-4 py-3.5">
                <Lightbulb size={20} className="mt-0.5 flex-none text-hero-accent" aria-hidden="true" />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className={`text-[15px] leading-relaxed ${roast.thinking ? "opacity-60" : ""}`}>{roast.text}</p>
                  {roast.byGemma && <p className="text-xs opacity-60">Roasted by Gemma, on this laptop</p>}
                </div>
              </div>
            )}
          </div>

          <div className="grid min-w-0 gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <Stat label="Income" value={lkr(ins.income)} note={`${ins.txs.filter((t) => t.kind === "credit").length} credits`} tone="good" />
            <Stat
              label="Left this month"
              value={lkr(ins.income - ins.spent)}
              note={ins.isCurrent && ins.daysLeft > 0 ? `About ${lkr(Math.max(0, ins.income - ins.spent) / ins.daysLeft)} per day is safe` : " "}
              tone={ins.income - ins.spent >= 0 ? "good" : "bad"}
            />
            <Stat label="Subscriptions" value={`${lkr(subTotal)} / mo`} note={subs.slice(0, 2).map((s) => s.merchant).join(", ") || "None found yet"} tone="warn" />
          </div>
        </section>

        <section aria-label="Daily spend" className={`${card} flex flex-col gap-4`}>
          <div>
            <h2 className="text-lg font-semibold">Daily spend</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {label}
              {ins.isCurrent ? ", forecast to month end" : ""}
            </p>
          </div>
          <div className="flex h-40 items-end gap-0.5 border-b pb-1 sm:h-52 sm:gap-1">
            {fc.daily.map((d) => (
              <div
                key={d.day}
                title={`${d.day} ${shortMonth}: ${lkr(d.total)}${d.forecast ? " (forecast)" : ""}`}
                className={`min-w-0 flex-1 rounded-t ${
                  d.forecast
                    ? "border-[1.5px] border-b-0 border-dashed border-good-strong bg-good-strong/10"
                    : d.unusual
                      ? "bg-bad-strong"
                      : d.total > 0
                        ? "bg-good-strong"
                        : "bg-border"
                }`}
                style={{ height: `${Math.max(2, (d.total / fc.maxDay) * 100)}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            {[1, 8, 15, 22, fc.daily.length].map((n) => (
              <span key={n}>
                {n} {shortMonth.slice(0, 3)}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-[13px] text-muted-foreground">
            <Legend className="bg-good-strong">Spent</Legend>
            {ins.isCurrent && <Legend className="border-[1.5px] border-dashed border-good-strong">Forecast</Legend>}
            <Legend className="bg-bad-strong">Unusual day</Legend>
          </div>
        </section>

        <section aria-label="Breakdown" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className={`${card} flex flex-col gap-4`}>
            <h2 className="text-lg font-semibold">Where it went</h2>
            {ins.cats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No spending this month.</p>
            ) : (
              <>
                <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full">
                  {ins.cats.map((c) => (
                    <div key={c.name} style={{ width: `${c.pct}%`, background: catColor(c.name).fg }} />
                  ))}
                </div>
                <div className="flex flex-col gap-3">
                  {ins.cats.map((c) => (
                    <div key={c.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="size-2.5 flex-none rounded-sm" style={{ background: catColor(c.name).fg }} />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="flex items-baseline gap-4 whitespace-nowrap">
                        <span className="font-mono text-[13px]">{lkr(c.total)}</span>
                        <span className="w-9 text-right text-[13px] text-muted-foreground">{c.pct}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={`${card} flex flex-col gap-4`}>
            <h2 className="text-lg font-semibold">Top shops</h2>
            {ins.shops.length === 0 && <p className="text-sm text-muted-foreground">No shops this month.</p>}
            {ins.shops.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <Avatar name={s.name} category={s.category} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">
                      {s.name} <span className="font-normal text-muted-foreground">· {s.count}×</span>
                    </span>
                    <span className="font-mono text-[13px] whitespace-nowrap">{lkr(s.total)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(s.total / ins.shops[0].total) * 100}%`, background: catColor(s.category).fg }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className={`${card} flex flex-col gap-3.5 md:col-span-2 lg:col-span-1`}>
            <div>
              <h2 className="text-lg font-semibold">Recurring charges</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Found from repeat SMS, no setup</p>
            </div>
            {subs.length === 0 && <p className="text-sm text-muted-foreground">Nothing recurring yet.</p>}
            {subs.slice(0, 4).map((s) => (
              <div
                key={s.merchant}
                className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 ${
                  s.rising ? "border border-warn-border bg-warn-bg" : "bg-muted/60"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.merchant}</p>
                  <p className={`text-xs ${s.rising ? "text-warn" : "text-muted-foreground"}`}>
                    {s.rising
                      ? "Went up since last time"
                      : `Next about ${new Date(s.next).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                  </p>
                </div>
                <span className="font-mono text-[13px] whitespace-nowrap">{lkr(s.amount)}</span>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Transactions" className={`${card} flex flex-col gap-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Transactions</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {ins.txs.length} in {shortMonth} · wrong category? change it once, Salli remembers
              </p>
            </div>
            <label className="flex h-10 w-full items-center gap-2 rounded-xl border bg-background px-3 text-muted-foreground sm:w-auto sm:min-w-60">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search transactions</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search shops, amounts"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </label>
          </div>

          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
            {["All", ...ins.cats.map((c) => c.name)].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium ${
                  cat === c ? "bg-foreground text-background" : "border bg-card hover:bg-muted"
                }`}
              >
                {c !== "All" && <span className="size-2 rounded-full" style={{ background: catColor(c).fg }} />}
                {c}
              </button>
            ))}
          </div>

          {groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>}
          {groups.map((g) => (
            <div key={g.label} className="flex flex-col">
              <div className="flex justify-between gap-3 border-b pt-3 pb-2 text-[13px] font-semibold text-muted-foreground">
                <span>{g.label}</span>
                <span className="font-mono font-medium whitespace-nowrap">
                  {g.net >= 0 ? "+ " : "− "}
                  {lkr(Math.abs(g.net))}
                </span>
              </div>
              {g.items.map((t) => (
                <TxRow key={t.id} t={t} />
              ))}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

// tabpfn predicts the days left, falls back to the simple average if python or tabpfn is missing
function useForecast(txs: Tx[], ins: ReturnType<typeof insights>, busy: boolean) {
  const input = useMemo(() => (ins.isCurrent ? forecastInput(txs) : null), [txs, ins.isCurrent]);
  const key = input ? `salli-fc:${input.history[input.history.length - 1]?.date}:${Math.round(ins.spent)}:${input.history.length}` : "";
  const [preds, setPreds] = useState<{ key: string; values: number[] } | null>(null);

  useEffect(() => {
    if (!input || busy || input.future.length === 0) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        setPreds({ key, values: JSON.parse(saved) });
        return;
      }
    } catch {
      // storage blocked, just run it
    }
    let alive = true;
    invoke<{ preds: number[] }>("forecast", { input })
      .then((r) => {
        try {
          localStorage.setItem(key, JSON.stringify(r.preds));
        } catch {
          // fine, runs again next time
        }
        if (alive) setPreds({ key, values: r.preds });
      })
      .catch((e) => console.info("tabpfn forecast skipped:", e));
    return () => {
      alive = false;
    };
  }, [key, busy]);

  const values = preds?.key === key ? preds.values : null;
  if (!values || !input) {
    return { total: ins.forecast, daily: ins.daily, maxDay: ins.maxDay, runsOut: null as number | null, byTabpfn: false };
  }

  // future days line up with the dashed bars after today
  const today = new Date().getDate();
  const daily = ins.daily.map((d) => (d.forecast ? { ...d, total: values[d.day - today - 1] ?? d.total } : d));
  const total = ins.spent + values.reduce((a, b) => a + b, 0);

  let runsOut: number | null = null;
  if (ins.income > 0 && ins.spent <= ins.income) {
    let sum = ins.spent;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (sum > ins.income) {
        runsOut = today + i + 1;
        break;
      }
    }
  }

  return { total, daily, maxDay: Math.max(1, ...daily.map((d) => d.total)), runsOut, byTabpfn: true };
}

// gemma writes the roast, saved per month so it only reruns when spending changes
function useRoast(ins: ReturnType<typeof insights>, label: string, busy: boolean) {
  const key = `salli-roast:${label}:${Math.round(ins.spent)}`;
  const [state, setState] = useState<{ key: string; text: string } | null>(null);
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    if (ins.spent === 0) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        setState({ key, text: saved });
        return;
      }
    } catch {
      // storage blocked, just ask gemma
    }
    // wait until sms reading is done so gemma isn't busy
    if (busy) return;

    let alive = true;
    setThinking(true);
    const timer = setTimeout(() => {
      invoke<string>("roast", {
        input: {
          month: label,
          spent: ins.spent,
          income: ins.income,
          delta: ins.delta,
          shops: ins.shops.map((s) => ({ name: s.name, category: s.category, count: s.count, total: s.total })),
          cats: ins.cats,
        },
      })
        .then((text) => {
          try {
            localStorage.setItem(key, text);
          } catch {
            // fine, we just ask again next time
          }
          if (alive) setState({ key, text });
        })
        .catch(() => {})
        .finally(() => alive && setThinking(false));
    }, 600);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, busy]);

  if (state?.key === key) return { text: state.text, byGemma: true, thinking: false };
  if (thinking) return { text: "Gemma is looking at your spending…", byGemma: false, thinking: true };
  return { text: ins.roast, byGemma: false, thinking: false };
}

function TxRow({ t }: { t: Tx }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border/60 py-3" title={t.body}>
      <Avatar name={t.merchant} category={t.category} />
      <div className="min-w-0 flex-[1_1_160px]">
        <p className="truncate text-[15px] font-semibold">{t.merchant}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {t.sender} · {SOURCE_LABEL[t.source] ?? t.source}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <label className="relative flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-[13px] font-medium hover:bg-muted">
          <span className="size-2 rounded-full" style={{ background: catColor(t.category).fg }} />
          <span className="sr-only">Category for {t.merchant}</span>
          <select
            value={t.category}
            onChange={(e) => invoke("fix_tx", { id: t.id, merchant: t.merchant, category: e.target.value })}
            className="cursor-pointer appearance-none bg-transparent pr-1 outline-none"
          >
            {CATEGORIES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <p className={`min-w-28 text-right font-mono text-sm font-semibold whitespace-nowrap ${t.kind === "credit" ? "text-good" : ""}`}>
          {t.kind === "credit" ? "+ " : "− "}
          {lkrExact(t.amount)}
        </p>
      </div>
    </div>
  );
}

function Avatar({ name, category }: { name: string; category: string }) {
  return (
    <div
      className="cat flex size-10 flex-none items-center justify-center rounded-xl text-[15px] font-bold"
      style={{ "--c": catColor(category).fg } as CSSProperties}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: "good" | "bad" | "warn" }) {
  const warn = tone === "warn";
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-warn";
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 rounded-3xl border p-5 ${warn ? "border-warn-border bg-warn-bg" : "bg-card"}`}>
      <p className={`text-[13px] ${warn ? color : "text-muted-foreground"}`}>{label}</p>
      <p className="truncate text-2xl leading-tight font-bold sm:text-[28px]">{value}</p>
      <p className={`truncate text-[13px] font-medium ${color}`}>{note}</p>
    </div>
  );
}

function IconButton({ icon: Icon, label, disabled, onClick }: { icon: LucideIcon; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-[3px] ${className}`} />
      {children}
    </span>
  );
}

function groupByDay(txs: Tx[]) {
  const out: { label: string; net: number; items: Tx[] }[] = [];
  for (const t of txs) {
    const label = dayLabel(t.date);
    let g = out.find((x) => x.label === label);
    if (!g) {
      g = { label, net: 0, items: [] };
      out.push(g);
    }
    g.items.push(t);
    g.net += t.kind === "credit" ? t.amount : -t.amount;
  }
  return out;
}
