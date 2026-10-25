import * as SecureStore from "expo-secure-store";

export type Link = { ip: string; port: number; token: string };
export type Stats = { lastSentAt: number | null; sent: number; otps: number; banks: number };

export const MONEY = /(LKR|Rs\.?|debited|credited|purchase|payment|txn|transaction|withdraw)/i;
export const OTP = /(OTP|one[- ]?time|verification code|password|PIN)/i;

const LINK_KEY = "salli-link";
const STATS_KEY = "salli-stats";
const EMPTY: Stats = { lastSentAt: null, sent: 0, otps: 0, banks: 0 };

export async function loadLink(): Promise<Link | null> {
  const v = await SecureStore.getItemAsync(LINK_KEY);
  return v ? JSON.parse(v) : null;
}

export async function saveLink(l: Link | null) {
  if (l) await SecureStore.setItemAsync(LINK_KEY, JSON.stringify(l));
  else await SecureStore.deleteItemAsync(LINK_KEY);
}

export async function loadStats(): Promise<Stats> {
  const v = await SecureStore.getItemAsync(STATS_KEY);
  return v ? { ...EMPTY, ...JSON.parse(v) } : EMPTY;
}

export async function saveStats(s: Stats | null) {
  if (s) await SecureStore.setItemAsync(STATS_KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(STATS_KEY);
}

export async function post(url: string, body: unknown, token?: string) {
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
    if (e.name === "AbortError" || /cancel|abort|network request failed/i.test(e.message)) {
      throw new Error("Can't reach your laptop. Is it on the same WiFi with Salli open?");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function ago(ms: number | null): string {
  if (!ms) return "Not sent yet";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "Last sent just now";
  if (s < 3600) return `Last sent ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `Last sent ${Math.floor(s / 3600)} h ago`;
  return `Last sent ${new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}
