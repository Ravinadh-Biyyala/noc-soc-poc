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
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-xl bg-card border-border" />
        <Skeleton className="h-[400px] w-full rounded-xl bg-card border-border" />
      </div>
    );
  }

  const FUNNEL_COLORS = ["#1e293b", "#334155", "#475569", "#14b8a6", "#0d9488"];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard title="Quote Rate" value={formatPercent(data.quoteRate)} icon={Target} />
        <MetricCard title="Bind Rate" value={formatPercent(data.bindRate)} icon={Award} />
        <MetricCard title="Closing Ratio" value={formatPercent(data.closingRatio)} icon={Filter} />
        <MetricCard title="Avg Days to Bind" value={data.avgDaysToBind.toString()} icon={Clock} suffix="days" />
        <MetricCard title="New Business Premium" value={formatCurrency(data.newBusinessPremium)} icon={Users} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Funnel */}
        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Sales Pipeline</CardTitle>
            <CardDescription className="text-muted-foreground">Lead to Bind conversion stages</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.funnelStages} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis dataKey="stage" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    cursor={{fill: 'hsl(var(--border))', opacity: 0.4}}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', color: '#fff' }}
                    formatter={(value: number) => [formatNumber(value), 'Count']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {data.funnelStages.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Bind Trend */}
        <Card className="lg:col-span-2 bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Monthly Bind Trend</CardTitle>
            <CardDescription className="text-muted-foreground">Historical bound policies</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthlyBindTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBind" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorBind)" name="Bound Policies" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Producer Leaderboard Table */}
      <Card className="bg-card border-border shadow-md">
        <CardHeader>
          <CardTitle className="text-white text-lg">Producer Leaderboard</CardTitle>
          <CardDescription className="text-muted-foreground">Top performing agents by written premium</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader className="bg-sidebar">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">Producer</TableHead>
                  <TableHead className="text-right text-muted-foreground font-medium">Written Premium</TableHead>
                  <TableHead className="text-right text-muted-foreground font-medium">Commission</TableHead>
                  <TableHead className="text-right text-muted-foreground font-medium">Bind Rate</TableHead>
                  <TableHead className="text-right text-muted-foreground font-medium">Retention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.producerLeaderboard.map((producer, i) => (
                  <TableRow key={producer.name} className={`border-border hover:bg-sidebar-accent/50 ${i % 2 === 0 ? 'bg-transparent' : 'bg-sidebar/30'}`}>
                    <TableCell className="font-medium text-white">{producer.name}</TableCell>
                    <TableCell className="text-right text-primary font-mono">{formatCurrency(producer.writtenPremium)}</TableCell>
                    <TableCell className="text-right text-foreground font-mono">{formatCurrency(producer.commissionRevenue)}</TableCell>
                    <TableCell className="text-right text-foreground">{formatPercent(producer.bindRate)}</TableCell>
                    <TableCell className="text-right text-foreground">{formatPercent(producer.renewalRetention)}</TableCell>
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
    <Card className="bg-card border-border shadow-sm hover:border-primary/30 transition-all group">
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <div className="text-muted-foreground group-hover:text-primary transition-colors">
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-1">
          <p className="text-2xl font-bold tracking-tight text-white">{value}</p>
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
