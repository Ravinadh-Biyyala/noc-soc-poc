import { useGetProductAnalytics } from "@workspace/api-client-react";
import CustomChartsSection from "@/components/custom-charts-section";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBody
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function ProductAnalytics() {
  const { data, isLoading } = useGetProductAnalytics();

  if (isLoading || !data) {
    return <Skeleton className="h-[800px] w-full rounded-xl" />;
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Premium by Line of Business</CardTitle>
          <CardDescription className="text-xs">Monthly growth by line</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.premiumByLineTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${(val / 1000000).toFixed(1)}M`} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '10px' }} />
                <Area type="monotone" dataKey="commercialProperty" stackId="1" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.7} name="Comm. Property" />
                <Area type="monotone" dataKey="generalLiability" stackId="1" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.7} name="Gen. Liability" />
                <Area type="monotone" dataKey="commercialAuto" stackId="1" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.7} name="Comm. Auto" />
                <Area type="monotone" dataKey="workersComp" stackId="1" stroke="hsl(var(--chart-4))" fill="hsl(var(--chart-4))" fillOpacity={0.7} name="Workers Comp" />
                <Area type="monotone" dataKey="cyber" stackId="1" stroke="hsl(var(--chart-5))" fill="hsl(var(--chart-5))" fillOpacity={0.7} name="Cyber" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Lines of Business</CardTitle>
            <CardDescription className="text-xs">Performance and profitability by line</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium text-muted-foreground">Line</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Premium</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">YoY</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Loss Ratio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lineOfBusiness.map((line, i) => (
                    <TableRow key={line.line} className={i % 2 === 1 ? 'bg-muted/20' : ''}>
                      <TableCell className="font-medium text-sm">{line.line}</TableCell>
                      <TableCell className="text-right text-sm text-primary font-mono font-medium">{formatCurrency(line.premium2023)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={`text-[10px] ${line.yoyChange > 0 ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-red-500 border-red-200 bg-red-50"}`}>
                          {line.yoyChange > 0 ? "+" : ""}{line.yoyChange}%
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right text-sm font-medium ${line.lossRatio > 0.55 ? 'text-red-500' : 'text-foreground'}`}>
                        {formatPercent(line.lossRatio)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Carrier Performance</CardTitle>
            <CardDescription className="text-xs">Placement and efficiency metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium text-muted-foreground">Carrier</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Placed</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Bind</TableHead>
                    <TableHead className="text-right text-xs font-medium text-muted-foreground">Turnaround</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.carriers.map((carrier, i) => (
                    <TableRow key={carrier.carrier} className={i % 2 === 1 ? 'bg-muted/20' : ''}>
                      <TableCell className="font-medium text-sm">{carrier.carrier}</TableCell>
                      <TableCell className="text-right text-sm text-primary font-mono font-medium">{formatCurrency(carrier.premiumPlaced)}</TableCell>
                      <TableCell className="text-right text-sm">{formatPercent(carrier.bindRatio)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{carrier.avgQuoteTurnaround}d</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <CustomChartsSection section="/products" />
    </div>
  );
}
