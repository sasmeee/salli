import { useState } from "react";
import {
  Text,
  Pressable,
  FlatList,
  PermissionsAndroid,
  View,
  StyleSheet,
  StatusBar,
  Platform,
} from "react-native";
import { getInbox, Sms } from "./modules/sms-reader";

const MONEY =
  /(LKR|Rs\.?|debited|credited|purchase|payment|txn|transaction|withdraw)/i;
const OTP = /(OTP|one[- ]?time|verification code|password|PIN)/i;

export default function App() {
  const [list, setList] = useState<Sms[]>([]);
  const [status, setStatus] = useState("Tap scan to find money SMS");

  async function scan() {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    );
    if (res !== PermissionsAndroid.RESULTS.GRANTED)
      return setStatus("Permission denied");
    try {
      const all = await getInbox(3000, 0);
      const money = all.filter((s) => MONEY.test(s.body) && !OTP.test(s.body));
      setList(money);
      setStatus(`Found ${money.length} money SMS out of ${all.length}`);
    } catch (e: any) {
      setStatus("Error: " + e.message);
    }
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <Text style={s.title}>🦥 Salli</Text>
      <Text style={s.sub}>Your SMS never leave your WiFi.</Text>

      <Pressable
        style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]}
        onPress={scan}
      >
        <Text style={s.btnText}>Scan my SMS</Text>
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
  title: { fontSize: 32, fontWeight: "800", color: "#3D2E1F" },
  sub: { fontSize: 14, color: "#8A7A66", marginBottom: 20 },
  btn: {
    backgroundColor: "#3D2E1F",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: { color: "#FAF7F2", fontSize: 16, fontWeight: "700" },
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
