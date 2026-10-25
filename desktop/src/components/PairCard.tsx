import { QRCodeSVG } from "qrcode.react";
import { Lock } from "lucide-react";
import type { Pairing } from "@/lib/salli";

export function PairCard({ pair, left, onClose }: { pair: Pairing | null; left: number; onClose?: () => void }) {
  // a link, so the normal phone camera can open salli and pair straight away
  const qr = pair ? `salli://pair?ip=${pair.ip}&port=${pair.port}&code=${pair.code}` : "";
  const pretty = pair ? `${pair.code.slice(0, 3)} ${pair.code.slice(3)}` : "--- ---";

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl border bg-card p-6 shadow-[0_20px_60px_-30px_rgba(43,33,24,0.35)] sm:p-8">
      <p className="text-[15px] font-semibold">Pair your phone</p>
      <div className="rounded-2xl border bg-white p-3.5">
        {pair ? <QRCodeSVG value={qr} size={196} fgColor="#000000" marginSize={0} /> : <div className="size-[196px]" />}
      </div>
      <div className="text-center">
        <p className="font-mono text-4xl font-bold tracking-[0.12em] sm:text-[44px]">{pretty}</p>
        <p className="mt-1 text-sm text-muted-foreground">{pair?.ip}</p>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground transition-all duration-300" style={{ width: `${(left / 30) * 100}%` }} />
        </div>
        <p className="text-center text-xs text-muted-foreground">New code in {left}s</p>
      </div>
      <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
        <Lock size={14} aria-hidden="true" />
        Same WiFi only · no cloud
      </div>
      {onClose && (
        <button type="button" onClick={onClose} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
          Close
        </button>
      )}
    </div>
  );
}
