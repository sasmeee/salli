import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { ChevronLeft, Monitor, Moon, Sun } from "lucide-react";
import { PairCard } from "@/components/PairCard";
import { relTime, type Pairing, type View } from "@/lib/salli";
import { getTheme, setTheme, type Theme } from "@/lib/theme";

type ExportResult = { txs: number; shops: number; sms: number };
type ImportResult = { added_txs: number; added_sms: number; shops: number };

const card = "flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:p-6";
const btn =
  "h-10 rounded-xl border bg-card px-3.5 text-sm font-semibold hover:bg-muted";

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function SettingsScreen({
  view,
  pair,
  left,
  onBack,
}: {
  view: View;
  pair: Pairing | null;
  left: number;
  onBack: () => void;
}) {
  const [showPair, setShowPair] = useState(false);
  const [dataMsg, setDataMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [theme, setThemeState] = useState<Theme>(getTheme());

  useEffect(() => {
    const un = listen("phone-paired", () => setShowPair(false));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const instantPct = view.txs.length
    ? Math.round(
        (view.txs.filter((t) => t.source === "rule" || t.source === "memory")
          .length /
          view.txs.length) *
          100,
      )
    : 0;
  const aiStatus = view.last_error
    ? "Needs attention"
    : view.busy
      ? `Reading ${view.pending}…`
      : "Ready";

  function pickTheme(t: Theme) {
    setTheme(t);
    setThemeState(t);
  }

  async function exportData() {
    setDataMsg(null);
    const date = new Date().toISOString().slice(0, 10);
    const path = await save({
      defaultPath: `salli-backup-${date}.json`,
      filters: [{ name: "Salli backup", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      const r = await invoke<ExportResult>("export_data", { path });
      setDataMsg({
        ok: true,
        text: `Saved ${r.txs} transactions and ${r.shops} shops`,
      });
    } catch (e) {
      setDataMsg({ ok: false, text: String(e) });
    }
  }

  async function importData() {
    setDataMsg(null);
    const path = await open({
      multiple: false,
      filters: [{ name: "Salli backup", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    try {
      const r = await invoke<ImportResult>("import_data", { path });
      setDataMsg({
        ok: true,
        text: `Added ${r.added_txs} transactions and ${r.shops} shops`,
      });
    } catch (e) {
      setDataMsg({ ok: false, text: String(e) });
    }
  }

  async function danger(command: string, question: string) {
    if (await confirm(question, { title: "Salli", kind: "warning" }))
      await invoke(command);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-7 pb-16 sm:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to dashboard"
            onClick={onBack}
            className="flex size-10 items-center justify-center rounded-xl border bg-card hover:bg-muted"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <section aria-label="Paired phones" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Paired phones</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Phones that can send SMS to this laptop over WiFi
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPair(true)}
              className="h-10 rounded-xl bg-foreground px-3.5 text-sm font-semibold text-background hover:opacity-90"
            >
              Pair a phone
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="size-2 rounded-full bg-good-strong" />
              <div>
                <p className="text-[15px] font-semibold">Phone paired</p>
                <p className="text-xs text-muted-foreground">
                  Last sync {relTime(view.last_sync)} · {view.total_sms} SMS
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                danger(
                  "unpair_all",
                  "Unpair all phones? They'll need to scan the code again.",
                )
              }
              className="h-9 rounded-lg border bg-card px-3 text-[13px] font-semibold text-bad hover:bg-muted"
            >
              Unpair
            </button>
          </div>
        </section>

        <section aria-label="Your data" className={card}>
          <div>
            <h2 className="text-lg font-semibold">Your data</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Everything lives on this laptop. Export a backup file to move
              Salli to a new computer. Paired phones are never included.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4">
              <div>
                <p className="text-[15px] font-semibold">Export backup</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {view.txs.length} transactions · {view.memory_size} shops ·{" "}
                  {view.total_sms} SMS
                </p>
              </div>
              <button
                type="button"
                onClick={exportData}
                className="h-10 rounded-xl bg-foreground text-sm font-semibold text-background hover:opacity-90"
              >
                Save backup file
              </button>
              <p className="text-xs text-muted-foreground">
                Last export: {relTime(view.last_export)}
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border-2 border-dashed bg-muted/30 p-4">
              <div>
                <p className="text-[15px] font-semibold">Import backup</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Merges with what's here, nothing is lost
                </p>
              </div>
              <button type="button" onClick={importData} className={btn}>
                Choose file
              </button>
            </div>
          </div>
          {dataMsg && (
            <p
              className={`text-sm font-semibold ${dataMsg.ok ? "text-good" : "text-bad"}`}
            >
              {dataMsg.text}
            </p>
          )}
        </section>

        <section aria-label="Appearance" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Appearance</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                System follows your Windows setting
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Theme"
              className="flex gap-1 rounded-xl bg-muted p-1"
            >
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  onClick={() => pickTheme(value)}
                  className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                    theme === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="AI model" className={card}>
          <div>
            <h2 className="text-lg font-semibold">AI on this laptop</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Only reads shops it hasn't seen before. Runs offline through
              Ollama.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Model" value="gemma3:4b" />
            <Tile
              label="Status"
              value={aiStatus}
              green={aiStatus === "Ready"}
            />
            <Tile label="Shops remembered" value={String(view.memory_size)} />
            <Tile label="Read instantly" value={`${instantPct}%`} />
          </div>
          {view.last_error && (
            <p className="text-sm text-bad">{view.last_error}</p>
          )}
        </section>

        <section
          aria-label="Start over"
          className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-bad-border bg-card p-5 sm:p-6"
        >
          <div>
            <h2 className="text-lg font-semibold">Start over</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Clear shop memory or wipe everything on this laptop
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() =>
                danger(
                  "reset_memory",
                  "Forget all remembered shops? Gemma will read them again next time.",
                )
              }
              className={btn}
            >
              Reset shop memory
            </button>
            <button
              type="button"
              onClick={() =>
                danger(
                  "delete_all_data",
                  "Delete all Salli data on this laptop? Export a backup first if you want to keep it.",
                )
              }
              className="h-10 rounded-xl border border-bad-border bg-bad-bg px-3.5 text-sm font-semibold text-bad hover:opacity-90"
            >
              Delete all data
            </button>
          </div>
        </section>
      </div>

      {showPair && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
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
    </main>
  );
}

function Tile({
  label,
  value,
  green,
}: {
  label: string;
  value: string;
  green?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/60 px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate font-semibold ${green ? "text-good" : ""}`}>
        {value}
      </p>
    </div>
  );
}
