import { useGetClaimsRisk } from "@workspace/api-client-react";
import CustomChartsSection from "@/components/custom-charts-section";
import { useCopilot } from "@/lib/copilot-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { ShieldAlert, AlertCircle, FileText } from "lucide-react";
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
  const { askCopilot } = useCopilot();

  if (isLoading || !data) {
    return <Skeleton className="h-[800px] w-full rounded-xl" />;
  }

  const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "#6366f1"];

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Overall Loss Ratio" value={formatPercent(data.lossRatio)} icon={ShieldAlert} isAlert={data.lossRatio > 0.55} onClick={() => askCopilot("Summarize our Overall Loss Ratio — current level, trend, and which lines have the highest loss ratios.")} />
        <MetricCard title="Open Claims" value={data.openClaims.toString()} icon={AlertCircle} onClick={() => askCopilot("How many open claims do we have? Break down by line and state.")} />
        <MetricCard title="Avg Incurred Loss" value={formatCurrency(data.avgIncurredLoss)} icon={FileText} onClick={() => askCopilot("Summarize Average Incurred Loss per claim and how it compares across lines of business.")} />
        <MetricCard title="Claim Severity" value={formatCurrency(data.severity)} icon={AlertCircle} isAlert onClick={() => askCopilot("Analyze Claim Severity — which lines and states have the highest severity?")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Incurred Loss by Line of Business</CardTitle>
            <CardDescription className="text-xs">Distribution of claim severity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.claimsByLine} margin={{ top: 10, right: 10, left: 20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="line" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${(val / 1000000).toFixed(0)}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    formatter={(value: number) => [formatCurrency(value), 'Incurred Loss']}
                  />
                  <Bar dataKey="incurredLoss" radius={[4, 4, 0, 0]}>
                    {data.claimsByLine.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top States by Risk</CardTitle>
            <CardDescription className="text-xs">Highest incurred losses</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.claimsByState.map((state) => {
                const max = Math.max(...data.claimsByState.map(s => s.incurredLoss));
                const width = `${(state.incurredLoss / max) * 100}%`;
                return (
                  <div key={state.stateCode} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-foreground">{state.state}</span>
                      <span className="text-red-500 font-mono font-medium">{formatCurrency(state.incurredLoss)}</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full" style={{ width }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Recent Claims Activity</CardTitle>
          <CardDescription className="text-xs">Latest filed claims</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-xs font-medium text-muted-foreground">Claim ID</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">Line</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">Filed</TableHead>
                  <TableHead className="text-right text-xs font-medium text-muted-foreground">Incurred</TableHead>
                  <TableHead className="text-center text-xs font-medium text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentClaims.map((claim, i) => (
                  <TableRow key={claim.claimId} className={`${i % 2 === 1 ? 'bg-muted/20' : ''} cursor-pointer hover:bg-primary/5`} onClick={() => askCopilot(`Tell me about claim ${claim.claimId} — ${claim.policyLine} claim filed ${claim.filedDate} with ${formatCurrency(claim.incurredLoss)} incurred loss, status: ${claim.status}. What should we know?`)}>
                    <TableCell className="font-mono text-xs text-primary font-medium">{claim.claimId}</TableCell>
                    <TableCell className="text-sm">{claim.policyLine}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{claim.filedDate}</TableCell>
                    <TableCell className="text-right text-sm font-mono font-medium">{formatCurrency(claim.incurredLoss)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`text-[10px] ${
                        claim.status === 'Open' ? 'text-amber-600 border-amber-200 bg-amber-50' :
                        claim.status === 'Under Review' ? 'text-blue-600 border-blue-200 bg-blue-50' :
                        'text-emerald-600 border-emerald-200 bg-emerald-50'
                      }`}>
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

      <CustomChartsSection section="/claims" />
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, isAlert = false, onClick }: any) {
  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
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
