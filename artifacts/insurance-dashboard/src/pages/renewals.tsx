import { useGetRenewalsRetention } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { RefreshCw, AlertTriangle, FileWarning, RotateCcw } from "lucide-react";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBody
} from "@/components/ui/table";

export default function RenewalsRetention() {
  const { data, isLoading } = useGetRenewalsRetention();

  if (isLoading || !data) {
    return <Skeleton className="h-[800px] w-full rounded-xl" />;
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Renewal Rate" value={formatPercent(data.renewalRate)} icon={RefreshCw} />
        <MetricCard title="Retained Premium" value={formatCurrency(data.retainedPremium)} icon={RotateCcw} />
        <MetricCard title="Lost Premium" value={formatCurrency(data.lostPremium)} icon={FileWarning} isAlert />
        <MetricCard title="Premium at Risk (90d)" value={formatCurrency(data.premiumAtRisk90)} icon={AlertTriangle} isAlert />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Retention Trend</CardTitle>
            <CardDescription className="text-xs">Monthly retention ratio</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.retentionTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Retention']} />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-2))" strokeWidth={2} fillOpacity={1} fill="url(#colorRet)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Churn by Producer</CardTitle>
            <CardDescription className="text-xs">Agents with highest lost premium</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium text-muted-foreground">Producer</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Lost Premium</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Policies</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Retention</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.churnByProducer.map((prod, i) => (
                    <TableRow key={prod.producer} className={i % 2 === 1 ? 'bg-muted/20' : ''}>
                      <TableCell className="font-medium text-sm">{prod.producer}</TableCell>
                      <TableCell className="text-right text-sm text-red-500 font-mono font-medium">{formatCurrency(prod.lostPremium)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{prod.lostPolicies}</TableCell>
                      <TableCell className={`text-right text-sm font-medium ${prod.retentionRate < 0.90 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {formatPercent(prod.retentionRate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, isAlert = false }: any) {
  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
          <div className={isAlert ? "text-red-400" : "text-primary/60"}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <p className={`text-xl font-bold ${isAlert ? 'text-red-500' : 'text-foreground'}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
