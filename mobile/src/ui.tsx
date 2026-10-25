import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { Theme } from "./theme";

export function Logo({ t }: { t: Theme }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={[s.logo, { backgroundColor: t.ink }]}>
        <Text style={{ color: t.bg, fontWeight: "800", fontSize: 18 }}>S</Text>
      </View>
      <Text style={{ color: t.ink, fontSize: 20, fontWeight: "700" }}>Salli</Text>
    </View>
  );
}

type BtnProps = {
  t: Theme;
  label: string;
  onPress: () => void;
  kind?: "dark" | "light" | "accent" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function Button({ t, label, onPress, kind = "dark", disabled, style, children }: BtnProps) {
  const bg = { dark: t.ink, light: t.card, accent: t.accent, danger: t.bad }[kind];
  const fg = { dark: t.bg, light: t.ink, accent: t.accentInk, danger: "#FFFFFF" }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        kind === "light" && { borderWidth: 1, borderColor: t.border },
        style,
      ]}
    >
      {children}
      <Text style={{ color: fg, fontSize: 16, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

export function Card({ t, children, style }: { t: Theme; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

const s = StyleSheet.create({
  logo: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  btn: {
    height: 54,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  card: { borderRadius: 16, borderWidth: 1 },
});
