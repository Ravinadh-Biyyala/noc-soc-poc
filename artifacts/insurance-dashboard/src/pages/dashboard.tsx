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
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "#6366f1", "#8b5cf6"];

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI title="Quote-to-Bind" value={formatPercent(data.quoteToBind)} icon={Target} />
        <MiniKPI title="YoY Book Growth" value={`+${(data.yoyBookGrowth * 100).toFixed(1)}%`} icon={TrendingUp} positive />
        <MiniKPI title="Avg Premium / Policy" value={formatCurrency(data.avgPremiumPerPolicy)} icon={DollarSign} />
        <MiniKPI title="Loss Ratio" value={formatPercent(data.lossRatio)} icon={Percent} alert={data.lossRatio > 0.5} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Premium & Commission Trends</CardTitle>
            <CardDescription className="text-xs">Monthly performance 2023</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthlyPremiumTrend} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPremium" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${(val / 1000000).toFixed(0)}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    formatter={(value: number) => [formatCurrency(value), 'Premium']}
                  />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-2))" strokeWidth={2} fillOpacity={1} fill="url(#colorPremium)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Policy Mix</CardTitle>
            <CardDescription className="text-xs">Premium by line of business</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.policyMix}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="premium"
                    nameKey="line"
                  >
                    {data.policyMix.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    formatter={(value: number) => [formatCurrency(value), 'Premium']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              {data.policyMix.slice(0, 6).map((item, i) => (
                <div key={item.line} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i] }} />
                  <span className="text-muted-foreground truncate">{item.line}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Geographic Performance</CardTitle>
            <CardDescription className="text-xs">Written premium by state -- hover for details</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <USAMap />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Top States by Premium</CardTitle>
            <CardDescription className="text-xs">Highest producing territories</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3.5">
              {data.topStatesByPremium.map((state) => {
                const max = data.topStatesByPremium[0].premium;
                const width = `${(state.premium / max) * 100}%`;
                return (
                  <div key={state.stateCode} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-foreground">{state.state}</span>
                      <span className="text-primary font-mono font-medium">{formatCurrency(state.premium)}</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{ width, background: 'linear-gradient(90deg, hsl(var(--chart-2)), hsl(var(--chart-1)))' }}
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
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
          <div className="w-7 h-7 rounded-md bg-primary/8 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
        </div>
        <p className="text-xl font-bold text-foreground mb-0.5">{value}</p>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-[10px] font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? '+' : ''}{change.toFixed(1)}% YoY
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniKPI({ title, value, icon: Icon, positive, alert }: { title: string; value: string; icon: any; positive?: boolean; alert?: boolean }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-3 flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${alert ? 'bg-red-50 text-red-500' : 'bg-primary/8 text-primary'}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">{title}</p>
          <p className={`text-sm font-bold ${alert ? 'text-red-500' : positive ? 'text-emerald-600' : 'text-foreground'}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
