import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, Download, Smartphone } from "lucide-react";
import type { View } from "@/lib/salli";

type ImportResult = { added_txs: number; added_sms: number; shops: number };

export function WelcomeScreen({ view }: { view: View }) {
  const [msg, setMsg] = useState<string | null>(null);

  const done = view.total_sms - view.pending;
  const instant = view.txs.filter(
    (t) => t.source === "rule" || t.source === "memory",
  ).length;
  const finished = view.total_sms > 0 && view.pending === 0 && !view.busy;
  const pct = view.total_sms ? Math.round((done / view.total_sms) * 100) : 0;

  async function importFile() {
    setMsg(null);
    const path = await open({
      multiple: false,
      filters: [{ name: "Salli backup", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    try {
      await invoke<ImportResult>("import_data", { path });
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground sm:px-8">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col items-center gap-3.5 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-good-bg text-good">
            <Check size={28} strokeWidth={2.5} aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Your phone is paired
          </h1>
          <p className="text-muted-foreground">How do you want to start?</p>
        </div>

        <div className="flex flex-wrap gap-5">
          <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-3xl border-2 border-foreground bg-card p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <div className="flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
                <Smartphone size={22} aria-hidden="true" />
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                Recommended
              </span>
            </div>
            <div>
              <h2 className="text-xl font-semibold">Read my SMS</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Tap <strong className="text-foreground">Send money SMS</strong>{" "}
                on your phone. Salli picks out bank and payment messages and
                skips OTPs.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 rounded-2xl bg-muted/60 p-4">
              {view.total_sms === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Waiting for your phone…
                </p>
              ) : (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">
                      {finished ? "All read" : "Reading your SMS"}
                    </span>
                    <span className="font-mono">{view.total_sms} SMS</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-good-strong transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {finished
                      ? `${view.txs.length} transactions found · ${instant} read instantly`
                      : `Reading ${done} of ${view.total_sms} · ${instant} instant from rules and memory`}
                  </p>
                </>
              )}
            </div>
            {finished && (
              <button
                type="button"
                onClick={() => invoke("finish_onboarding")}
                className="h-11 rounded-xl bg-foreground text-sm font-semibold text-background hover:opacity-90"
              >
                Open dashboard
              </button>
            )}
          </section>

          <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-3xl border bg-card p-6 sm:p-7">
            <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
              <Download size={22} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">
                Bring back an old backup
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Moving from another laptop? Import a{" "}
                <span className="font-mono text-[13px]">salli-backup.json</span>{" "}
                and keep your history and fixed categories.
              </p>
            </div>
            <button
              type="button"
              onClick={importFile}
              className="flex min-h-30 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-muted/40 p-4 hover:bg-muted/70"
            >
              <span className="text-sm font-semibold">Choose backup file</span>
              <span className="text-[13px] text-muted-foreground">
                .json from Settings → Export
              </span>
            </button>
            {msg && <p className="text-sm text-bad">{msg}</p>}
          </section>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => invoke("finish_onboarding")}
            className="text-sm font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Skip for now, go to dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
