import { useGetSalesPerformance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { Target, Users, Filter, Award, Clock } from "lucide-react";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBody
} from "@/components/ui/table";

export default function SalesPerformance() {
  const { data, isLoading } = useGetSalesPerformance();

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  const FUNNEL_COLORS = ["#c7d2fe", "#93a7f8", "#6480f0", "#3b5de7", "#1a3fd0"];

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard title="Quote Rate" value={formatPercent(data.quoteRate)} icon={Target} />
        <MetricCard title="Bind Rate" value={formatPercent(data.bindRate)} icon={Award} />
        <MetricCard title="Closing Ratio" value={formatPercent(data.closingRatio)} icon={Filter} />
        <MetricCard title="Avg Days to Bind" value={data.avgDaysToBind.toString()} icon={Clock} suffix="days" />
        <MetricCard title="New Business" value={formatCurrency(data.newBusinessPremium)} icon={Users} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Sales Pipeline</CardTitle>
            <CardDescription className="text-xs">Lead to Bind conversion</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.funnelStages} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis dataKey="stage" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={65} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    formatter={(value: number) => [formatNumber(value), 'Count']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {data.funnelStages.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Monthly Bind Trend</CardTitle>
            <CardDescription className="text-xs">Bound policies per month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthlyBindTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBind" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} fillOpacity={1} fill="url(#colorBind)" name="Bound Policies" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Producer Leaderboard</CardTitle>
          <CardDescription className="text-xs">Top performing agents by written premium</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-xs font-medium text-muted-foreground">Producer</TableHead>
                  <TableHead className="text-right text-xs font-medium text-muted-foreground">Written Premium</TableHead>
                  <TableHead className="text-right text-xs font-medium text-muted-foreground">Commission</TableHead>
                  <TableHead className="text-right text-xs font-medium text-muted-foreground">Bind Rate</TableHead>
                  <TableHead className="text-right text-xs font-medium text-muted-foreground">Retention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.producerLeaderboard.map((producer, i) => (
                  <TableRow key={producer.name} className={i % 2 === 1 ? 'bg-muted/20' : ''}>
                    <TableCell className="font-medium text-sm text-foreground">{producer.name}</TableCell>
                    <TableCell className="text-right text-sm text-primary font-mono font-medium">{formatCurrency(producer.writtenPremium)}</TableCell>
                    <TableCell className="text-right text-sm font-mono text-muted-foreground">{formatCurrency(producer.commissionRevenue)}</TableCell>
                    <TableCell className="text-right text-sm">{formatPercent(producer.bindRate)}</TableCell>
                    <TableCell className="text-right text-sm">{formatPercent(producer.renewalRetention)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, suffix }: any) {
  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <div className="flex justify-between items-center mb-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
          <Icon className="w-3.5 h-3.5 text-primary/60" />
        </div>
        <div className="flex items-baseline gap-1">
          <p className="text-lg font-bold text-foreground">{value}</p>
          {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
