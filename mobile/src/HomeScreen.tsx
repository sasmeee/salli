import { useEffect, useRef, useState } from "react";
import { Modal, PermissionsAndroid, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { getInbox } from "../modules/sms-reader";
import { MONEY, OTP, ago, loadStats, post, saveStats, type Link, type Stats } from "./lib";
import { TOP, useTheme, type Theme } from "./theme";
import { Button, Card, Logo } from "./ui";

// small batches so the progress bar moves for real
const CHUNK = 25;

type Phase = "idle" | "sending" | "done";
type Result = { added: number; total: number; stopped: boolean };

export function HomeScreen({ link, onUnpair }: { link: Link; onUnpair: () => void }) {
  const t = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, found: 0, otps: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const [msg, setMsg] = useState("");
  const [askUnpair, setAskUnpair] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stop = useRef(false);

  useEffect(() => {
    loadStats().then(setStats);
  }, []);

  async function send() {
    setMsg("");
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (res !== PermissionsAndroid.RESULTS.GRANTED) {
      setMsg("Salli needs SMS permission to read bank messages.");
      return;
    }

    const all = await getInbox(3000, 0);
    const otps = all.filter((m) => OTP.test(m.body)).length;
    const money = all.filter((m) => MONEY.test(m.body) && !OTP.test(m.body));
    if (!money.length) {
      setMsg("No bank or card SMS found on this phone.");
      return;
    }

    stop.current = false;
    setStopping(false);
    setProgress({ done: 0, total: money.length, found: all.length, otps });
    setPhase("sending");

    let added = 0;
    let total = 0;
    try {
      for (let i = 0; i < money.length; i += CHUNK) {
        if (stop.current) break;
        const r = await post(`http://${link.ip}:${link.port}/sync`, { messages: money.slice(i, i + CHUNK) }, link.token);
        added += r.added;
        total = r.total;
        setProgress((p) => ({ ...p, done: Math.min(i + CHUNK, money.length) }));
      }
      const next: Stats = {
        lastSentAt: Date.now(),
        sent: money.length,
        otps,
        banks: new Set(money.map((m) => m.address)).size,
      };
      await saveStats(next);
      setStats(next);
      setResult({ added, total, stopped: stop.current });
      setPhase("done");
    } catch (e: any) {
      setPhase("idle");
      setMsg(e.message === "UNAUTHORIZED" ? "Your laptop forgot this phone. Unpair and connect again." : e.message);
    }
  }

  async function unpair() {
    setAskUnpair(false);
    await saveStats(null);
    onUnpair();
  }

  if (phase === "sending") return <Sending t={t} p={progress} stopping={stopping} onCancel={() => {
    stop.current = true;
    setStopping(true);
  }} />;
  if (phase === "done" && result) return <Done t={t} r={result} onClose={() => setPhase("idle")} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar barStyle={t.bar} backgroundColor={t.bg} />
      <ScrollView contentContainerStyle={[s.page, { paddingTop: TOP }]}>
        <View style={s.between}>
          <Logo t={t} />
          <View style={[s.chip, { backgroundColor: t.goodBg }]}>
            <View style={[s.dot, { backgroundColor: t.goodStrong }]} />
            <Text style={{ color: t.good, fontSize: 12, fontWeight: "700" }}>Connected</Text>
          </View>
        </View>

        <Card t={t} style={s.laptop}>
          <View style={[s.iconBox, { backgroundColor: t.chip }]}>
            <View style={[s.screen, { borderColor: t.ink }]} />
            <View style={[s.base, { backgroundColor: t.ink }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontSize: 15, fontWeight: "700" }}>Your laptop</Text>
            <Text style={{ color: t.soft, fontSize: 12, fontFamily: "monospace" }}>{link.ip}</Text>
          </View>
        </Card>

        <View style={[s.hero, { backgroundColor: t.hero, borderColor: t.border, borderWidth: t.bar === "light-content" ? 1 : 0 }]}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.heroInk, fontSize: 22, fontWeight: "800" }}>Send money SMS</Text>
            <Text style={{ color: t.heroInk, opacity: 0.8, fontSize: 14, lineHeight: 21 }}>
              Sends bank and card SMS to your laptop. OTPs stay on your phone.
            </Text>
          </View>
          <Button t={t} kind="accent" label="Send now" onPress={send} />
          <Text style={{ color: t.heroInk, opacity: 0.7, fontSize: 12, textAlign: "center" }}>{ago(stats?.lastSentAt ?? null)}</Text>
        </View>

        {!!msg && (
          <View style={[s.error, { backgroundColor: t.badBg }]}>
            <Text style={{ color: t.bad, fontSize: 14, fontWeight: "600" }}>{msg}</Text>
          </View>
        )}

        <View style={s.tiles}>
          <Tile t={t} n={stats?.sent ?? 0} label="SMS sent" />
          <Tile t={t} n={stats?.otps ?? 0} label="OTPs kept" />
          <Tile t={t} n={stats?.banks ?? 0} label="Senders" />
        </View>

        <Card t={t} style={{ padding: 16, gap: 10 }}>
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: "700" }}>What gets sent</Text>
          <Rule t={t} ok text="Bank, card and wallet alerts" />
          <Rule t={t} ok text="Salary, transfers and bills" />
          <Rule t={t} text="Never OTPs or personal chats" />
        </Card>

        <Card t={t} style={{ marginTop: "auto", overflow: "hidden" }}>
          <Row t={t} label="Pair with another laptop" onPress={unpair} />
          <View style={{ height: 1, backgroundColor: t.line }} />
          <Row t={t} label="Unpair this phone" danger onPress={() => setAskUnpair(true)} />
        </Card>
      </ScrollView>

      <Modal visible={askUnpair} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAskUnpair(false)}>
        <Pressable accessibilityLabel="Close" style={[s.overlay, { backgroundColor: t.overlay }]} onPress={() => setAskUnpair(false)} />
        <View style={[s.sheet, { backgroundColor: t.card }]}>
          <View style={[s.handle, { backgroundColor: t.border }]} />
          <View style={{ gap: 8 }}>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: "800" }}>Unpair this phone?</Text>
            <Text style={{ color: t.muted, fontSize: 15, lineHeight: 22 }}>
              Your laptop keeps everything it already read. To send SMS again, scan the code on your laptop.
            </Text>
          </View>
          <View style={{ gap: 10 }}>
            <Button t={t} kind="danger" label="Unpair" onPress={unpair} />
            <Button t={t} kind="light" label="Cancel" onPress={() => setAskUnpair(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Sending({ t, p, stopping, onCancel }: { t: Theme; p: { done: number; total: number; found: number; otps: number }; stopping: boolean; onCancel: () => void }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <View style={[s.full, { backgroundColor: t.bg, paddingTop: TOP }]}>
      <StatusBar barStyle={t.bar} backgroundColor={t.bg} />
      <Logo t={t} />
      <View style={s.center}>
        <View style={[s.bigCircle, { backgroundColor: t.hero }]}>
          <Text style={{ color: t.accent, fontSize: 34, fontWeight: "800" }}>{pct}%</Text>
        </View>
        <View style={{ gap: 8, alignItems: "center" }}>
          <Text style={[s.h1, { color: t.ink }]}>Sending to your laptop</Text>
          <Text style={{ color: t.muted, fontSize: 15 }}>Keep Salli open for a few seconds</Text>
        </View>
        <View style={{ alignSelf: "stretch", gap: 10 }}>
          <View style={[s.track, { backgroundColor: t.border }]}>
            <View style={[s.fill, { backgroundColor: t.goodStrong, width: `${pct}%` }]} />
          </View>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {p.done} of {p.total} SMS
          </Text>
        </View>
        <Card t={t} style={{ alignSelf: "stretch", padding: 16, gap: 10 }}>
          <Line t={t} label="Found in your inbox" value={p.found} />
          <Line t={t} label="Money SMS" value={p.total} />
          <Line t={t} label="OTPs kept on phone" value={p.otps} soft />
        </Card>
      </View>
      <Button t={t} kind="light" label={stopping ? "Stopping…" : "Cancel"} onPress={onCancel} disabled={stopping} />
    </View>
  );
}

function Done({ t, r, onClose }: { t: Theme; r: Result; onClose: () => void }) {
  return (
    <View style={[s.full, { backgroundColor: t.bg, paddingTop: TOP }]}>
      <StatusBar barStyle={t.bar} backgroundColor={t.bg} />
      <Logo t={t} />
      <View style={s.center}>
        <View style={[s.bigCircle, { backgroundColor: t.goodBg }]}>
          <Text style={{ color: t.good, fontSize: 40, fontWeight: "800" }}>✓</Text>
        </View>
        <View style={{ gap: 8, alignItems: "center" }}>
          <Text style={[s.h1, { color: t.ink }]}>{r.stopped ? "Stopped early" : "Sent to your laptop"}</Text>
          <Text style={{ color: t.muted, fontSize: 15, textAlign: "center", lineHeight: 22 }}>
            {r.added} new SMS · {r.total} on your laptop now.{"\n"}Open Salli on your laptop to see them.
          </Text>
        </View>
      </View>
      <Button t={t} label="Done" onPress={onClose} />
    </View>
  );
}

function Tile({ t, n, label }: { t: Theme; n: number; label: string }) {
  return (
    <Card t={t} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 14 }}>
      <Text style={{ color: t.ink, fontSize: 22, fontWeight: "800" }}>{n}</Text>
      <Text style={{ color: t.soft, fontSize: 12 }}>{label}</Text>
    </Card>
  );
}

function Rule({ t, ok, text }: { t: Theme; ok?: boolean; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ width: 16, color: ok ? t.good : t.bad, fontSize: 15, fontWeight: "800" }}>{ok ? "✓" : "✕"}</Text>
      <Text style={{ color: ok ? t.ink : t.soft, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

function Row({ t, label, danger, onPress }: { t: Theme; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.chip }]}
    >
      <Text style={{ color: danger ? t.bad : t.ink, fontSize: 15, fontWeight: danger ? "700" : "500" }}>{label}</Text>
      <Text style={{ color: danger ? t.bad : t.soft, fontSize: 22 }}>›</Text>
    </Pressable>
  );
}

function Line({ t, label, value, soft }: { t: Theme; label: string; value: number; soft?: boolean }) {
  return (
    <View style={s.between}>
      <Text style={{ color: soft ? t.soft : t.ink, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: soft ? t.soft : t.ink, fontSize: 14, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 28, gap: 16 },
  full: { flex: 1, paddingHorizontal: 24, paddingBottom: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 22 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  laptop: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 2 },
  screen: { width: 18, height: 12, borderRadius: 2, borderWidth: 2 },
  base: { width: 22, height: 2, borderRadius: 1 },
  hero: { borderRadius: 22, padding: 22, gap: 16 },
  error: { borderRadius: 14, padding: 14 },
  tiles: { flexDirection: "row", gap: 10 },
  row: { height: 54, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  overlay: { flex: 1 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 18 },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3 },
  h1: { fontSize: 26, fontWeight: "800", letterSpacing: -0.3, textAlign: "center" },
  bigCircle: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  track: { height: 10, borderRadius: 5, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 5 },
});
