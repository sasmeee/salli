import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { loadLink, saveLink, type Link } from "./src/lib";
import { useTheme } from "./src/theme";
import { PairScreen } from "./src/PairScreen";
import { HomeScreen } from "./src/HomeScreen";

export default function App() {
  const t = useTheme();
  const [link, setLink] = useState<Link | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadLink().then((l) => {
      setLink(l);
      setReady(true);
    });
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

  return link ? <HomeScreen link={link} onUnpair={() => update(null)} /> : <PairScreen onPaired={update} />;
}
