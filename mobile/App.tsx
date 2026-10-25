import { useEffect, useState } from "react";
import {
  Text,
  Pressable,
  FlatList,
  PermissionsAndroid,
  View,
  StyleSheet,
  StatusBar,
  Platform,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { getInbox, Sms } from "./modules/sms-reader";

type Link = { ip: string; port: number; token: string };

const MONEY =
  /(LKR|Rs\.?|debited|credited|purchase|payment|txn|transaction|withdraw)/i;
const OTP = /(OTP|one[- ]?time|verification code|password|PIN)/i;
const KEY = "salli-link";

async function post(url: string, body: unknown, token?: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-salli-token": token } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (r.status === 401) throw new Error("UNAUTHORIZED");
    if (!r.ok) throw new Error("Laptop said " + r.status);
    return r.json();
  } catch (e: any) {
    if (e.name === "AbortError" || /cancel|abort/i.test(e.message)) {
      throw new Error(
        "Can't reach laptop. Same WiFi? (Emulator: use 10.0.2.2)",
      );
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export default function App() {
  const [link, setLink] = useState<Link | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((v) => {
      if (v) setLink(JSON.parse(v));
      setReady(true);
    });
  }, []);

  async function saveLink(l: Link | null) {
    if (l) await SecureStore.setItemAsync(KEY, JSON.stringify(l));
    else await SecureStore.deleteItemAsync(KEY);
    setLink(l);
  }

  if (!ready)
    return (
      <View style={s.root}>
        <ActivityIndicator />
      </View>
    );
  return link ? (
    <Home link={link} onUnpair={() => saveLink(null)} />
  ) : (
    <Pair onPaired={saveLink} />
  );
}

function Pair({ onPaired }: { onPaired: (l: Link) => void }) {
  const [mode, setMode] = useState<"choose" | "scan" | "code">("choose");
  const [ip, setIp] = useState(__DEV__ ? "10.0.2.2" : "192.168.");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [perm, requestPerm] = useCameraPermissions();

  async function pair(ipAddr: string, port: number, c: string) {
    setBusy(true);
    setMsg("Pairing…");
    try {
      const { token } = await post(`http://${ipAddr}:${port}/pair`, {
        code: c.replace(/\s/g, ""),
      });
      onPaired({ ip: ipAddr, port, token });
    } catch (e: any) {
      setMsg(
        e.message === "UNAUTHORIZED"
          ? "Wrong or expired code. Try the new one."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    if (!perm?.granted) {
      const r = await requestPerm();
      if (!r.granted) return setMsg("Camera permission denied");
    }
    setMsg("");
    setMode("scan");
  }

  if (mode === "scan") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            busy
              ? undefined
              : ({ data }) => {
                  try {
                    const q = JSON.parse(data);
                    if (q.app !== "salli") throw new Error();
                    setMode("choose");
                    pair(q.ip, q.port, q.code);
                  } catch {
                    setMsg("Not a Salli code");
                  }
                }
          }
        />
        <Pressable
          style={[s.btn, s.floating]}
          onPress={() => setMode("choose")}
        >
          <Text style={s.btnText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={s.root}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <StatusBar barStyle="dark-content" />
        <Text style={s.title}>🦥 Salli</Text>
        <Text style={s.sub}>
          Pair with your laptop. SMS never leave your WiFi.
        </Text>

        {mode === "choose" && (
          <>
            <Pressable style={s.btn} onPress={startScan}>
              <Text style={s.btnText}>Scan QR on laptop</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnGhost]}
              onPress={() => {
                setMsg("");
                setMode("code");
              }}
            >
              <Text style={[s.btnText, { color: "#3D2E1F" }]}>
                Enter code instead
              </Text>
            </Pressable>
          </>
        )}

        {mode === "code" && (
          <>
            <Text style={s.label}>Laptop IP (emulator: 10.0.2.2)</Text>
            <TextInput
              style={s.input}
              value={ip}
              onChangeText={setIp}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="192.168.1.12"
            />
            <Text style={s.label}>6-digit code</Text>
            <TextInput
              style={[s.input, s.codeInput]}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholder="000000"
              maxLength={6}
              autoFocus
            />
            <Pressable
              style={[s.btn, (busy || code.length < 6) && { opacity: 0.5 }]}
              disabled={busy || code.length < 6}
              onPress={() => pair(ip.trim(), 7777, code)}
            >
              <Text style={s.btnText}>{busy ? "Pairing…" : "Pair"}</Text>
            </Pressable>
            <Pressable onPress={() => setMode("choose")}>
              <Text style={s.link}>Back</Text>
            </Pressable>
          </>
        )}

        {!!msg && <Text style={s.status}>{msg}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Home({ link, onUnpair }: { link: Link; onUnpair: () => void }) {
  const [list, setList] = useState<Sms[]>([]);
  const [status, setStatus] = useState(`Paired with ${link.ip}`);
  const [busy, setBusy] = useState(false);

  async function scan() {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    );
    if (res !== PermissionsAndroid.RESULTS.GRANTED) {
      setStatus("SMS permission denied");
      return [];
    }
    const all = await getInbox(3000, 0);
    const money = all.filter((m) => MONEY.test(m.body) && !OTP.test(m.body));
    setList(money);
    setStatus(`Found ${money.length} money SMS out of ${all.length}`);
    return money;
  }

  async function send() {
    setBusy(true);
    try {
      const money = await scan();
      if (!money.length) return;
      setStatus("Sending to laptop…");
      const r = await post(
        `http://${link.ip}:${link.port}/sync`,
        { messages: money },
        link.token,
      );
      setStatus(`Sent ✓ ${r.added} new · ${r.total} total on laptop`);
    } catch (e: any) {
      setStatus(
        e.message === "UNAUTHORIZED"
          ? "Laptop forgot this phone. Unpair and pair again."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <View style={s.headerRow}>
        <Text style={s.title}>🦥 Salli</Text>
        <Pressable onPress={onUnpair}>
          <Text style={s.link}>Unpair</Text>
        </Pressable>
      </View>
      <Text style={s.sub}>Your SMS never leave your WiFi.</Text>

      <Pressable
        style={[s.btn, busy && { opacity: 0.6 }]}
        onPress={send}
        disabled={busy}
      >
        <Text style={s.btnText}>
          {busy ? "Sending…" : "Send money SMS to laptop"}
        </Text>
      </Pressable>
      <Pressable style={[s.btn, s.btnGhost]} onPress={scan}>
        <Text style={[s.btnText, { color: "#3D2E1F" }]}>Preview SMS</Text>
      </Pressable>
      <Text style={s.status}>{status}</Text>

      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.sender}>{item.address}</Text>
              <Text style={s.date}>
                {new Date(item.date).toLocaleDateString()}
              </Text>
            </View>
            <Text style={s.body} numberOfLines={3}>
              {item.body}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const TOP =
  (Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 44) + 12;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FAF7F2",
    paddingHorizontal: 16,
    paddingTop: TOP,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 32, fontWeight: "800", color: "#3D2E1F" },
  sub: { fontSize: 14, color: "#8A7A66", marginBottom: 20 },
  btn: {
    backgroundColor: "#3D2E1F",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#3D2E1F",
  },
  btnText: { color: "#FAF7F2", fontSize: 16, fontWeight: "700" },
  floating: { position: "absolute", bottom: 40, left: 24, right: 24 },
  label: { color: "#5C4A36", fontSize: 13, marginBottom: 6, marginTop: 6 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E6DCCD",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: "#3D2E1F",
    marginBottom: 10,
  },
  codeInput: {
    fontSize: 28,
    letterSpacing: 8,
    textAlign: "center",
    fontWeight: "700",
  },
  link: {
    color: "#5B7F4A",
    fontWeight: "700",
    textAlign: "center",
    padding: 8,
  },
  status: { marginVertical: 12, color: "#5C4A36", fontSize: 13 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#EEE6DA",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sender: { fontWeight: "700", color: "#3D2E1F" },
  date: { color: "#A8998A", fontSize: 12 },
  body: { color: "#4A3C2E", fontSize: 13, lineHeight: 18 },
});
