import { useGetRenewalsRetention } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { ShieldAlert, RefreshCw, AlertTriangle, FileWarning, RotateCcw } from "lucide-react";
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
    return <Skeleton className="h-[800px] w-full rounded-xl bg-card border-border" />;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Renewal Rate" value={formatPercent(data.renewalRate)} icon={RefreshCw} isAlert={data.renewalRate < 85} />
        <MetricCard title="Retained Premium" value={formatCurrency(data.retainedPremium)} icon={RotateCcw} />
        <MetricCard title="Lost Premium" value={formatCurrency(data.lostPremium)} icon={FileWarning} isAlert={true} />
        <MetricCard title="Premium at Risk (90d)" value={formatCurrency(data.premiumAtRisk90)} icon={AlertTriangle} isAlert={true} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Retention Trend Chart */}
        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Retention Trend</CardTitle>
            <CardDescription className="text-muted-foreground">Monthly retention ratio %</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.retentionTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRet" x1="0" y1="0" x2="0" y2="1">
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
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorRet)" name="Retention %" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Churn by Producer */}
        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Churn by Producer</CardTitle>
            <CardDescription className="text-muted-foreground">Agents with highest lost premium</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader className="bg-sidebar">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-medium">Producer</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Lost Premium</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Lost Policies</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Retention</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.churnByProducer.map((prod, i) => (
                    <TableRow key={prod.producer} className={`border-border hover:bg-sidebar-accent/50 ${i % 2 === 0 ? 'bg-transparent' : 'bg-sidebar/30'}`}>
                      <TableCell className="font-medium text-white">{prod.producer}</TableCell>
                      <TableCell className="text-right text-destructive font-mono">{formatCurrency(prod.lostPremium)}</TableCell>
                      <TableCell className="text-right text-foreground">{prod.lostPolicies}</TableCell>
                      <TableCell className={`text-right ${prod.retentionRate < 85 ? 'text-destructive font-medium' : 'text-primary'}`}>
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
    <Card className="bg-card border-border shadow-sm group">
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <div className={isAlert ? "text-destructive" : "text-primary"}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <p className={`text-2xl font-bold tracking-tight ${isAlert ? 'text-destructive' : 'text-white'}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
