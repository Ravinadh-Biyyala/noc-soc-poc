import { useGetClaimsRisk } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { ShieldAlert, AlertCircle, FileText, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBody
} from "@/components/ui/table";

export default function ClaimsRisk() {
  const { data, isLoading } = useGetClaimsRisk();

  if (isLoading || !data) {
    return <Skeleton className="h-[800px] w-full rounded-xl bg-card border-border" />;
  }

  const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Overall Loss Ratio" value={formatPercent(data.lossRatio)} icon={ShieldAlert} isAlert={data.lossRatio > 65} />
        <MetricCard title="Open Claims" value={data.openClaims.toString()} icon={AlertCircle} />
        <MetricCard title="Avg Incurred Loss" value={formatCurrency(data.avgIncurredLoss)} icon={FileText} />
        <MetricCard title="Claim Severity" value={formatCurrency(data.severity)} icon={AlertCircle} isAlert={true} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Claims by Line */}
        <Card className="lg:col-span-2 bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Incurred Loss by Line of Business</CardTitle>
            <CardDescription className="text-muted-foreground">Distribution of claim severity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.claimsByLine} margin={{ top: 10, right: 10, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="line" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} angle={-15} textAnchor="end" />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val/1000}k`} />
                  <Tooltip 
                    cursor={{fill: 'hsl(var(--border))', opacity: 0.4}}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', color: '#fff' }}
                    formatter={(value: number) => [formatCurrency(value), 'Incurred Loss']}
                  />
                  <Bar dataKey="incurredLoss" radius={[4, 4, 0, 0]}>
                    {data.claimsByLine.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Claims by State Table */}
        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Top States by Risk</CardTitle>
            <CardDescription className="text-muted-foreground">Highest incurred losses</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.claimsByState.map((state, i) => {
                const max = Math.max(...data.claimsByState.map(s => s.incurredLoss));
                const width = `${(state.incurredLoss / max) * 100}%`;
                return (
                  <div key={state.stateCode} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-foreground">{state.state}</span>
                      <span className="text-destructive font-mono">{formatCurrency(state.incurredLoss)}</span>
                    </div>
                    <div className="h-1.5 w-full bg-sidebar-accent rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-destructive rounded-full" 
                        style={{ width }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Claims Table */}
      <Card className="bg-card border-border shadow-md">
        <CardHeader>
          <CardTitle className="text-white text-lg">Recent Claims Activity</CardTitle>
          <CardDescription className="text-muted-foreground">Latest filed claims</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader className="bg-sidebar">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">Claim ID</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Line</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Filed Date</TableHead>
                  <TableHead className="text-right text-muted-foreground font-medium">Incurred Loss</TableHead>
                  <TableHead className="text-center text-muted-foreground font-medium">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentClaims.map((claim, i) => (
                  <TableRow key={claim.claimId} className={`border-border hover:bg-sidebar-accent/50 ${i % 2 === 0 ? 'bg-transparent' : 'bg-sidebar/30'}`}>
                    <TableCell className="font-mono text-xs text-primary">{claim.claimId}</TableCell>
                    <TableCell className="font-medium text-foreground">{claim.policyLine}</TableCell>
                    <TableCell className="text-muted-foreground">{claim.filedDate}</TableCell>
                    <TableCell className="text-right text-white font-mono">{formatCurrency(claim.incurredLoss)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`
                        ${claim.status === 'Open' ? 'text-destructive border-destructive/50' : ''}
                        ${claim.status === 'Under Review' ? 'text-chart-4 border-chart-4/50' : ''}
                        ${claim.status === 'Closed' ? 'text-primary border-primary/50' : ''}
                      `}>
                        {claim.status}
                      </Badge>
                    </TableCell>
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

function MetricCard({ title, value, icon: Icon, isAlert = false }: any) {
  return (
    <Card className="bg-card border-border shadow-sm group hover:border-primary/30 transition-all">
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
