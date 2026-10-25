import { Platform, StatusBar, useColorScheme } from "react-native";

const light = {
  bg: "#F6F1EA",
  card: "#FFFFFF",
  ink: "#2B2118",
  muted: "#5C4C3D",
  soft: "#6B5B4B",
  border: "#E6DCCD",
  line: "#EFE7DB",
  chip: "#EDE5D9",
  hero: "#2B2118",
  heroInk: "#F6F1EA",
  accent: "#F2B38A",
  accentInk: "#2B2118",
  good: "#1E6B47",
  goodStrong: "#1F9D6B",
  goodBg: "#E3F1E8",
  bad: "#A23E2B",
  badBg: "#FDF1EE",
  overlay: "rgba(43,33,24,0.5)",
  bar: "dark-content" as const,
};

const dark: typeof light = {
  bg: "#16110D",
  card: "#201914",
  ink: "#F3ECE3",
  muted: "#C9B9A8",
  soft: "#B3A291",
  border: "#3A2F27",
  line: "#2E251F",
  chip: "#2A221C",
  hero: "#2C221B",
  heroInk: "#F6F1EA",
  accent: "#F2B38A",
  accentInk: "#2B2118",
  good: "#6FD3A4",
  goodStrong: "#2FB57D",
  goodBg: "#16302A",
  bad: "#F2907A",
  badBg: "#321B16",
  overlay: "rgba(0,0,0,0.6)",
  bar: "light-content",
};

export type Theme = typeof light;

// follows the phone's light or dark setting
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export const TOP = (Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 44) + 16;
