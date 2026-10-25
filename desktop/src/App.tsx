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
type Sms = { id: string; address: string; body: string; date: number };

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
  const [inbox, setInbox] = useState<Sms[]>([]);
  const [left, setLeft] = useState(30);
  const [paired, setPaired] = useState(false);
  const [showPair, setShowPair] = useState(false);

  const loadPair = () => invoke<Pairing>("pairing_info").then(setPair);
  const loadInbox = () => invoke<Sms[]>("get_inbox").then(setInbox);

  useEffect(() => {
    loadPair();
    loadInbox();
    const subs = [
      listen("code-changed", loadPair),
      listen("sms-synced", loadInbox),
      listen("phone-paired", () => {
        setPaired(true);
        setShowPair(false);
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

  const sorted = [...inbox].sort((a, b) => b.date - a.date);

  // First run: only pairing, centered
  if (!paired) {
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

  // Paired: dashboard takes over
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

      <Card>
        <CardHeader>
          <CardTitle>Received SMS</CardTitle>
          <CardDescription>
            {inbox.length} money messages synced
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sorted.length === 0 && (
            <p className="text-muted-foreground">
              Nothing yet. Tap Send on your phone. 🦥
            </p>
          )}
          {sorted.map((m) => (
            <div key={m.id} className="rounded-lg border p-3">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{m.address}</span>
                <span className="text-muted-foreground">
                  {new Date(m.date).toLocaleString()}
                </span>
              </div>
              <p className="text-sm mt-1">{m.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
