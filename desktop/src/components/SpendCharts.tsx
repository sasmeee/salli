import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ChartTx = {
  date: number;
  amount: number;
  kind: string;
  category: string;
  merchant: string;
};

const COLORS: Record<string, string> = {
  Food: "#D99A2B",
  Groceries: "#5B7F4A",
  Transport: "#4F7A8C",
  Bills: "#8A7A66",
  Shopping: "#C2553F",
  Subscriptions: "#9B6FB0",
  Health: "#2F9E6A",
  Entertainment: "#D4708A",
  Transfer: "#7FA8B8",
  Salary: "#3F5B33",
  Other: "#A8998A",
};

const DAY = 86400000;

const lkr = (n: number) =>
  "LKR " + n.toLocaleString("en-LK", { maximumFractionDigits: 0 });

const short = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${Math.round(n)}`;

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

export function SpendCharts({ txs }: { txs: ChartTx[] }) {
  const since = Date.now() - 30 * DAY;
  const spends = txs.filter((t) => t.kind === "debit" && t.date >= since);

  // one bar per day, empty days stay at zero
  const daily = Array.from({ length: 30 }, (_, i) => {
    const start = new Date(Date.now() - (29 - i) * DAY);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + DAY;
    const total = spends
      .filter((t) => t.date >= start.getTime() && t.date < end)
      .reduce((s, t) => s + t.amount, 0);
    return {
      day: start.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      }),
      total,
    };
  });

  const byCat = Object.entries(
    spends.reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount;
      return acc;
    }, {}),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const topShops = Object.entries(
    spends.reduce<
      Record<string, { total: number; count: number; category: string }>
    >((acc, t) => {
      const s = acc[t.merchant] ?? { total: 0, count: 0, category: t.category };
      s.total += t.amount;
      s.count += 1;
      acc[t.merchant] = s;
      return acc;
    }, {}),
  )
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const total = byCat.reduce((s, c) => s + c.value, 0);
  const maxShop = topShops[0]?.total ?? 1;

  if (spends.length === 0) return null;

  return (
    <div className="mb-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily spend</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                interval={4}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                tickFormatter={short}
                width={40}
                stroke="var(--muted-foreground)"
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                formatter={(v) => [lkr(Number(v)), "Spent"]}
                contentStyle={tooltipStyle}
              />
              <Bar
                dataKey="total"
                fill="var(--chart-1)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
            <CardDescription>
              {lkr(total)} across {byCat.length} categories
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <div className="h-48 w-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byCat}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {byCat.map((c) => (
                      <Cell
                        key={c.name}
                        fill={COLORS[c.name] ?? COLORS.Other}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, n) => [lkr(Number(v)), String(n)]}
                    contentStyle={tooltipStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2 text-sm">
              {byCat.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: COLORS[c.name] ?? COLORS.Other }}
                    />
                    {c.name}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {Math.round((c.value / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top shops</CardTitle>
            <CardDescription>Where your money goes most</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {topShops.map((s) => (
              <div key={s.name}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">
                    {s.name}{" "}
                    <span className="text-muted-foreground">· {s.count}×</span>
                  </span>
                  <span className="font-mono">{lkr(s.total)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(s.total / maxShop) * 100}%`,
                      background: COLORS[s.category] ?? COLORS.Other,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
