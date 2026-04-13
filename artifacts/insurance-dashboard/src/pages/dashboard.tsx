import { useGetExecutiveSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, FileText, Shield, Target, BarChart3, Percent } from "lucide-react";
import USAMap from "@/components/USAMap";

export default function Dashboard() {
  const { data, isLoading } = useGetExecutiveSummary();

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl bg-card border-border" />)}
        </div>
        <Skeleton className="h-[400px] rounded-xl bg-card border-border" />
      </div>
    );
  }

  const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "#818cf8", "#a78bfa"];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Written Premium"
          value={formatCurrency(data.writtenPremium.current)}
          change={data.writtenPremium.changePercent}
          icon={DollarSign}
        />
        <KPICard
          title="Commission Revenue"
          value={formatCurrency(data.commissionRevenue.current)}
          change={data.commissionRevenue.changePercent}
          icon={BarChart3}
        />
        <KPICard
          title="Policies Bound"
          value={data.policiesBound.current.toLocaleString()}
          change={data.policiesBound.changePercent}
          icon={FileText}
        />
        <KPICard
          title="Renewal Rate"
          value={formatPercent(data.renewalRate)}
          icon={Shield}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniKPI title="Quote-to-Bind" value={formatPercent(data.quoteToBind)} icon={Target} />
        <MiniKPI title="YoY Book Growth" value={`+${(data.yoyBookGrowth * 100).toFixed(1)}%`} icon={TrendingUp} positive />
        <MiniKPI title="Avg Premium / Policy" value={formatCurrency(data.avgPremiumPerPolicy)} icon={DollarSign} />
        <MiniKPI title="Loss Ratio" value={formatPercent(data.lossRatio)} icon={Percent} alert={data.lossRatio > 0.5} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Premium & Commission Trends</CardTitle>
            <CardDescription className="text-muted-foreground">Monthly performance 2023</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthlyPremiumTrend} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPremium" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `$${(val / 1000000).toFixed(0)}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', color: '#fff' }}
                    formatter={(value: number) => [formatCurrency(value), 'Premium']}
                  />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} fillOpacity={1} fill="url(#colorPremium)" name="Written Premium" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Policy Mix</CardTitle>
            <CardDescription className="text-muted-foreground">Premium distribution by LOB</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.policyMix}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="premium"
                    nameKey="line"
                  >
                    {data.policyMix.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', color: '#fff' }}
                    formatter={(value: number) => [formatCurrency(value), 'Premium']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {data.policyMix.slice(0, 6).map((item, i) => (
                <div key={item.line} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i] }} />
                  <span className="text-muted-foreground truncate">{item.line}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Geographic Performance</CardTitle>
            <CardDescription className="text-muted-foreground">Written premium by state -- hover for details</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <USAMap />
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Top States by Premium</CardTitle>
            <CardDescription className="text-muted-foreground">Highest producing territories</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.topStatesByPremium.map((state, i) => {
                const max = data.topStatesByPremium[0].premium;
                const width = `${(state.premium / max) * 100}%`;
                return (
                  <div key={state.stateCode} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-foreground">{state.state}</span>
                      <span className="text-primary font-mono">{formatCurrency(state.premium)}</span>
                    </div>
                    <div className="h-1.5 w-full bg-sidebar-accent rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-1000"
                        style={{ width }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPICard({ title, value, change, icon: Icon }: { title: string; value: string; change?: number; icon: any }) {
  const isPositive = change !== undefined && change > 0;
  return (
    <Card className="bg-card border-border shadow-sm group hover:border-primary/30 transition-all">
      <CardContent className="p-5">
        <div className="flex justify-between items-start mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <div className="text-muted-foreground group-hover:text-primary transition-colors">
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight text-white mb-1">{value}</p>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${isPositive ? 'text-primary' : 'text-destructive'}`}>
            {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isPositive ? '+' : ''}{change.toFixed(1)}% YoY
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniKPI({ title, value, icon: Icon, positive, alert }: { title: string; value: string; icon: any; positive?: boolean; alert?: boolean }) {
  return (
    <Card className="bg-card border-border shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${alert ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className={`text-lg font-bold ${alert ? 'text-destructive' : positive ? 'text-primary' : 'text-white'}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
