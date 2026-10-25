import { Logo } from "@/components/Logo";
import { PairCard } from "@/components/PairCard";
import type { Pairing } from "@/lib/salli";

const STEPS = [
  "Open the Salli app on your Android phone",
  "Scan this code, or type the 6 digits",
  "Both devices must be on the same WiFi",
];

export function PairScreen({ pair, left }: { pair: Pairing | null; left: number }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground sm:px-8">
      <div className="flex w-full max-w-5xl flex-wrap items-center gap-12">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-7">
          <div className="flex items-center gap-3">
            <Logo size={48} />
            <span className="text-2xl font-bold">Salli</span>
          </div>
          <h1 className="text-[32px] leading-[1.1] font-bold tracking-tight sm:text-[44px]">
            Your bank SMS become a budget. You do nothing.
          </h1>
          <p className="text-[17px] leading-relaxed text-muted-foreground">
            Salli reads money SMS from your phone and sorts them on this laptop with a local AI. No account, no cloud,
            nothing leaves your WiFi.
          </p>
          <ol className="flex flex-col gap-3.5">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-start gap-3.5">
                <span className="flex size-7 flex-none items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-[15px]">{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-[0_1_400px] justify-center">
          <PairCard pair={pair} left={left} />
        </div>
      </div>
    </main>
  );
}
