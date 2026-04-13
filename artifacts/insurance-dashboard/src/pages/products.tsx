import { useGetProductAnalytics } from "@workspace/api-client-react";
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
    return <Skeleton className="h-[800px] w-full rounded-xl bg-card border-border" />;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Stacked Area Chart */}
      <Card className="bg-card border-border shadow-md">
        <CardHeader>
          <CardTitle className="text-white text-lg">Premium by Line of Business</CardTitle>
          <CardDescription className="text-muted-foreground">Monthly growth trajectory</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.premiumByLineTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val/1000}k`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', color: '#fff' }}
                />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }} />
                <Area type="monotone" dataKey="commercialProperty" stackId="1" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" name="Comm. Property" />
                <Area type="monotone" dataKey="generalLiability" stackId="1" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" name="Gen. Liability" />
                <Area type="monotone" dataKey="commercialAuto" stackId="1" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" name="Comm. Auto" />
                <Area type="monotone" dataKey="workersComp" stackId="1" stroke="hsl(var(--chart-4))" fill="hsl(var(--chart-4))" name="Workers Comp" />
                <Area type="monotone" dataKey="cyber" stackId="1" stroke="hsl(var(--chart-5))" fill="hsl(var(--chart-5))" name="Cyber" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* LOB Table */}
        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Lines of Business</CardTitle>
            <CardDescription className="text-muted-foreground">Performance and profitability</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader className="bg-sidebar">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-medium">Line</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Premium</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">YoY Change</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Loss Ratio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lineOfBusiness.map((line, i) => (
                    <TableRow key={line.line} className={`border-border hover:bg-sidebar-accent/50 ${i % 2 === 0 ? 'bg-transparent' : 'bg-sidebar/30'}`}>
                      <TableCell className="font-medium text-white">{line.line}</TableCell>
                      <TableCell className="text-right text-primary font-mono">{formatCurrency(line.premium2023)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={line.yoyChange > 0 ? "text-primary border-primary/30" : "text-destructive border-destructive/30"}>
                          {line.yoyChange > 0 ? "+" : ""}{line.yoyChange}%
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-medium ${line.lossRatio > 65 ? 'text-destructive' : 'text-foreground'}`}>
                        {formatPercent(line.lossRatio)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Carrier Table */}
        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-white text-lg">Carrier Performance</CardTitle>
            <CardDescription className="text-muted-foreground">Placement volume and ratios</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader className="bg-sidebar">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-medium">Carrier</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Placed Premium</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Bind Ratio</TableHead>
                    <TableHead className="text-right text-muted-foreground font-medium">Avg Turnaround</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.carriers.map((carrier, i) => (
                    <TableRow key={carrier.carrier} className={`border-border hover:bg-sidebar-accent/50 ${i % 2 === 0 ? 'bg-transparent' : 'bg-sidebar/30'}`}>
                      <TableCell className="font-medium text-white">{carrier.carrier}</TableCell>
                      <TableCell className="text-right text-primary font-mono">{formatCurrency(carrier.premiumPlaced)}</TableCell>
                      <TableCell className="text-right text-foreground">{formatPercent(carrier.bindRatio)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{carrier.avgQuoteTurnaround} days</TableCell>
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
