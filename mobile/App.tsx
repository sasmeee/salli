import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { loadLink, parsePairLink, saveLink, type Link, type PairLink } from "./src/lib";
import { useTheme } from "./src/theme";
import { PairScreen } from "./src/PairScreen";
import { HomeScreen } from "./src/HomeScreen";

export default function App() {
  const t = useTheme();
  const [link, setLink] = useState<Link | null>(null);
  const [ready, setReady] = useState(false);
  const [incoming, setIncoming] = useState<PairLink | null>(null);

  useEffect(() => {
    loadLink().then((l) => {
      setLink(l);
      setReady(true);
    });
  }, []);

  // the laptop qr is a salli:// link, scanning it with the camera opens us here
  useEffect(() => {
    const take = (url: string | null) => {
      const q = url ? parsePairLink(url) : null;
      if (q) setIncoming(q);
    };
    Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener("url", (e) => take(e.url));
    return () => sub.remove();
  }, []);

  async function update(l: Link | null) {
    await saveLink(l);
    setLink(l);
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.ink} />
      </View>
    );
  }

  return link ? <HomeScreen link={link} onUnpair={() => update(null)} /> : <PairScreen onPaired={update} incoming={incoming} />;
}
