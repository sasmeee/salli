import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { scanQr } from "../modules/sms-reader";
import { parsePairLink, post, type Link, type PairLink } from "./lib";
import { TOP, useTheme } from "./theme";
import { Button, Logo } from "./ui";

export function PairScreen({ onPaired, incoming }: { onPaired: (l: Link) => void; incoming: PairLink | null }) {
  const t = useTheme();
  const [ip, setIp] = useState(__DEV__ ? "10.0.2.2" : "192.168.");
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const codeRef = useRef<TextInput>(null);

  async function pair(ipAddr: string, port: number, c: string) {
    setBusy(true);
    setMsg("");
    try {
      const { token } = await post(`http://${ipAddr}:${port}/pair`, { code: c.replace(/\s/g, "") });
      onPaired({ ip: ipAddr, port, token });
    } catch (e: any) {
      setMsg(e.message === "UNAUTHORIZED" ? "That code just changed. Try the new one on your laptop." : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setMsg("");
    try {
      const data = await scanQr();
      if (!data) return;
      const q = parsePairLink(data);
      if (q) pair(q.ip, q.port, q.code);
      else setMsg("That's not a Salli code. Scan the one on your laptop.");
    } catch (e: any) {
      setMsg("Scanner isn't available on this phone. Type the code below instead.");
    }
  }

  // opened from a salli:// link, pair right away
  useEffect(() => {
    if (incoming) {
      setIp(incoming.ip);
      setCode(incoming.code);
      pair(incoming.ip, incoming.port, incoming.code);
    }
  }, [incoming]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar barStyle={t.bar} backgroundColor={t.bg} />
      <ScrollView contentContainerStyle={[s.page, { paddingTop: TOP }]} keyboardShouldPersistTaps="handled">
        <Logo t={t} />

        <View style={{ gap: 10 }}>
          <Text style={[s.h1, { color: t.ink }]}>Connect to your laptop</Text>
          <Text style={[s.lead, { color: t.muted }]}>Open Salli on your laptop. It shows a QR code and a 6-digit code.</Text>
        </View>

        <View style={{ gap: 10 }}>
          <Button t={t} label={busy ? "Connecting…" : "Scan QR code"} onPress={scan} disabled={busy} />
          {busy && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <ActivityIndicator color={t.ink} />
              <Text style={{ color: t.muted, fontSize: 14 }}>Connecting to your laptop…</Text>
            </View>
          )}
        </View>

        <View style={s.divider}>
          <View style={[s.rule, { backgroundColor: t.border }]} />
          <Text style={{ color: t.soft, fontSize: 13, fontWeight: "500" }}>or type it in</Text>
          <View style={[s.rule, { backgroundColor: t.border }]} />
        </View>

        <View style={{ gap: 18 }}>
          <View style={{ gap: 8 }}>
            <Text style={[s.label, { color: t.muted }]}>Laptop address</Text>
            <TextInput
              accessibilityLabel="Laptop address"
              value={ip}
              onChangeText={setIp}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              placeholder="192.168.1.12"
              placeholderTextColor={t.soft}
              style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.ink }]}
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[s.label, { color: t.muted }]}>6-digit code</Text>
            <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={() => codeRef.current?.focus()} style={s.boxes}>
              {Array.from({ length: 6 }).map((_, i) => {
                const active = focused && i === Math.min(code.length, 5);
                return (
                  <View
                    key={i}
                    style={[
                      s.box,
                      { backgroundColor: t.card, borderColor: active ? t.ink : t.border, borderWidth: active ? 2 : 1 },
                      i === 3 && { marginLeft: 8 },
                    ]}
                  >
                    <Text style={[s.digit, { color: t.ink }]}>{code[i] ?? ""}</Text>
                  </View>
                );
              })}
            </Pressable>
            <TextInput
              ref={codeRef}
              accessibilityLabel="6-digit code"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              caretHidden
              style={s.hidden}
            />
            <Text style={{ color: t.soft, fontSize: 12 }}>The code changes every 30 seconds on your laptop</Text>
          </View>
        </View>

        <Button
          t={t}
          kind="light"
          label={busy ? "Connecting…" : "Connect"}
          disabled={busy || code.length < 6 || !ip.trim()}
          onPress={() => pair(ip.trim(), 7777, code)}
        />

        {!!msg && (
          <View style={[s.error, { backgroundColor: t.badBg }]}>
            <Text style={{ color: t.bad, fontSize: 14, fontWeight: "600" }}>{msg}</Text>
          </View>
        )}

        <View style={[s.pill, { backgroundColor: t.chip }]}>
          <View style={[s.dot, { backgroundColor: t.goodStrong }]} />
          <Text style={{ color: t.muted, fontSize: 12, fontWeight: "600" }}>Same WiFi only · nothing goes online</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, gap: 24 },
  h1: { fontSize: 30, lineHeight: 35, fontWeight: "800", letterSpacing: -0.5 },
  lead: { fontSize: 15, lineHeight: 22 },
  num: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  rule: { flex: 1, height: 1 },
  label: { fontSize: 13, fontWeight: "600" },
  input: { height: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, fontFamily: "monospace" },
  boxes: { flexDirection: "row", gap: 8 },
  box: { flex: 1, height: 56, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  digit: { fontSize: 22, fontWeight: "700", fontFamily: "monospace" },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
  error: { borderRadius: 14, padding: 14 },
  pill: {
    marginTop: "auto",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
