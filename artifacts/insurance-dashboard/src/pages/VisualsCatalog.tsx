import { useState, useMemo } from "react";
import {
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ComposedChart,
  Treemap,
  FunnelChart, Funnel, LabelList,
  RadialBarChart, RadialBar,
  ResponsiveContainer, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Search, CheckCircle2, Database, Building2, AlertCircle,
  BarChart2,
} from "lucide-react";

// ─── Palette & shared styles ─────────────────────────────────────────────────
const C = [
  "hsl(213,94%,38%)",
  "hsl(199,89%,48%)",
  "hsl(159,60%,40%)",
  "hsl(38,92%,50%)",
  "hsl(0,72%,51%)",
  "hsl(270,60%,55%)",
  "hsl(14,80%,55%)",
];
const TIP = {
  contentStyle: {
    backgroundColor: "#fff",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "11px",
    padding: "6px 10px",
  },
};
const AX = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
const H = 182; // chart demo height

// ─── Categories ──────────────────────────────────────────────────────────────
const CATS = {
  comparison:   { label: "Comparison",     badge: "bg-blue-50 text-blue-700 border-blue-200"      },
  trend:        { label: "Trend & Time",   badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  composition:  { label: "Part-to-Whole",  badge: "bg-violet-50 text-violet-700 border-violet-200"  },
  distribution: { label: "Distribution",   badge: "bg-amber-50 text-amber-700 border-amber-200"    },
  flow:         { label: "Flow & Process", badge: "bg-orange-50 text-orange-700 border-orange-200" },
  relationship: { label: "Relationship",   badge: "bg-pink-50 text-pink-700 border-pink-200"       },
  performance:  { label: "KPIs & Metrics",    badge: "bg-teal-50 text-teal-700 border-teal-200"      },
  tabular:      { label: "Tables & Matrix",  badge: "bg-slate-50 text-slate-700 border-slate-200"   },
  interactive:  { label: "Slicers & Filters",badge: "bg-indigo-50 text-indigo-700 border-indigo-200"},
  geo:          { label: "Geographic",       badge: "bg-cyan-50 text-cyan-700 border-cyan-200"      },
  hierarchy:    { label: "Hierarchy & Tree", badge: "bg-lime-50 text-lime-700 border-lime-200"      },
} as const;
type CatKey = keyof typeof CATS;

type ChartDef = {
  id: string;
  name: string;
  category: CatKey;
  tagline: string;
  whenToUse: string;
  dataNeeded: string;
  bestFor: string;
  avoidWhen: string;
  biTools: string;
  tags: string[];
  Demo: () => React.ReactNode;
};

// ─── Shared sample data ───────────────────────────────────────────────────────
const monthly   = [{ m:"Jan",v:4200},{m:"Feb",v:5800},{m:"Mar",v:5100},{m:"Apr",v:7200},{m:"May",v:6400},{m:"Jun",v:8100}];
const regional  = [{r:"North",v:8400},{r:"South",v:6200},{r:"East",v:9100},{r:"West",v:7300},{r:"Central",v:5800}];
const stacked   = [{q:"Q1",a:2800,b:1800,c:1600},{q:"Q2",a:3200,b:2100,c:2800},{q:"Q3",a:2900,b:2500,c:2000},{q:"Q4",a:4100,b:2900,c:2200}];
const multiline = [{m:"Jan",rev:4200,cost:2800},{m:"Feb",rev:5800,cost:3300},{m:"Mar",rev:5100,cost:3100},{m:"Apr",rev:7200,cost:4000},{m:"May",rev:6400,cost:3700},{m:"Jun",rev:8100,cost:4400}];
const pieD      = [{n:"Product",v:42},{n:"Services",v:28},{n:"Subscription",v:20},{n:"Other",v:10}];
const scatter   = [{x:120,y:5200},{x:85,y:3800},{x:200,y:9400},{x:150,y:6800},{x:60,y:2200},{x:175,y:8100},{x:95,y:4200},{x:220,y:10200},{x:130,y:5900}];
const bubble    = [{x:40,y:3.2,z:400},{x:70,y:4.5,z:700},{x:55,y:2.8,z:250},{x:90,y:5.1,z:850},{x:25,y:1.9,z:150},{x:80,y:4.8,z:600}];
const radar     = [{m:"Revenue",v:82},{m:"Growth",v:67},{m:"Margin",v:74},{m:"Retention",v:91},{m:"NPS",v:58},{m:"Market",v:70}];
const funnel    = [{n:"Leads",v:1200},{n:"Qualified",v:820},{n:"Proposals",v:450},{n:"Negotiation",v:210},{n:"Closed",v:95}];
const treemap   = [{name:"Electronics",size:4800},{name:"Apparel",size:3200},{name:"Furniture",size:2100},{name:"Food",size:1800},{name:"Sports",size:1400},{name:"Beauty",size:950}];
const radialB   = [{name:"Sales",uv:82,fill:C[0]},{name:"Support",uv:67,fill:C[1]},{name:"Growth",uv:91,fill:C[2]},{name:"Margin",uv:74,fill:C[3]}];
const histogram = [{b:"0–10",f:12},{b:"10–20",f:28},{b:"20–30",f:45},{b:"30–40",f:62},{b:"40–50",f:48},{b:"50–60",f:31},{b:"60–70",f:18},{b:"70–80",f:8}];
const combo     = [{q:"Q1",rev:6200,growth:8},{q:"Q2",rev:8100,growth:14},{q:"Q3",rev:7400,growth:10},{q:"Q4",rev:9200,growth:18}];
const step      = [{m:"Jan",v:4200},{m:"Feb",v:4200},{m:"Mar",v:5800},{m:"Apr",v:5800},{m:"May",v:7200},{m:"Jun",v:7200}];
const percent   = [{q:"Q1",a:35,b:42,c:23},{q:"Q2",a:28,b:48,c:24},{q:"Q3",a:32,b:44,c:24},{q:"Q4",a:30,b:46,c:24}];

// Waterfall computed data
const wfBase = [
  {l:"Start",  base:0,    pos:5000, neg:0,    total:true},
  {l:"Sales+", base:5000, pos:2800, neg:0,    total:false},
  {l:"COGS−",  base:6600, pos:0,    neg:1200, total:false},
  {l:"OpEx−",  base:5400, pos:0,    neg:900,  total:false},
  {l:"Net",    base:0,    pos:4500, neg:0,    total:true},
];

// ─── Demo components (called as functions, no hooks needed) ─────────────────

function BarDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={monthly} margin={{top:8,right:10,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="m" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} formatter={(v:number)=>[`$${v.toLocaleString()}`,"Revenue"]} />
        <Bar dataKey="v" radius={[4,4,0,0]} fill={C[0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function HBarDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={regional} layout="vertical" margin={{top:4,right:30,left:10,bottom:4}}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="r" tick={AX} axisLine={false} tickLine={false} width={52} />
        <Tooltip {...TIP} formatter={(v:number)=>[`$${v.toLocaleString()}`,"Revenue"]} />
        <Bar dataKey="v" radius={[0,4,4,0]}>
          {regional.map((_,i)=><Cell key={i} fill={C[i%C.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GroupedBarDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={stacked} margin={{top:8,right:10,left:-10,bottom:0}} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="q" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} />
        <Bar dataKey="a" name="Product" fill={C[0]} radius={[3,3,0,0]} />
        <Bar dataKey="b" name="Services" fill={C[1]} radius={[3,3,0,0]} />
        <Bar dataKey="c" name="Subscriptions" fill={C[2]} radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function StackedBarDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={stacked} margin={{top:8,right:10,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="q" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} />
        <Bar dataKey="a" name="Product" fill={C[0]} stackId="s" />
        <Bar dataKey="b" name="Services" fill={C[1]} stackId="s" />
        <Bar dataKey="c" name="Subscriptions" fill={C[2]} stackId="s" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PercentStackedDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={percent} margin={{top:8,right:10,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="q" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} domain={[0,100]} />
        <Tooltip {...TIP} formatter={(v:number)=>[`${v}%`]} />
        <Bar dataKey="a" name="Brand A" fill={C[0]} stackId="s" />
        <Bar dataKey="b" name="Brand B" fill={C[1]} stackId="s" />
        <Bar dataKey="c" name="Brand C" fill={C[2]} stackId="s" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={monthly} margin={{top:8,right:16,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="m" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} formatter={(v:number)=>[`$${v.toLocaleString()}`,"Revenue"]} />
        <Line type="monotone" dataKey="v" stroke={C[0]} strokeWidth={2.5} dot={{ r:3,fill:C[0] }} activeDot={{ r:5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function AreaDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <AreaChart data={monthly} margin={{top:8,right:16,left:-10,bottom:0}}>
        <defs>
          <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={C[0]} stopOpacity={0.25}/>
            <stop offset="95%" stopColor={C[0]} stopOpacity={0.02}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="m" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} formatter={(v:number)=>[`$${v.toLocaleString()}`,"Revenue"]} />
        <Area type="monotone" dataKey="v" stroke={C[0]} strokeWidth={2} fill="url(#aGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StackedAreaDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <AreaChart data={multiline} margin={{top:8,right:16,left:-10,bottom:0}}>
        <defs>
          <linearGradient id="sg1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={C[0]} stopOpacity={0.3}/><stop offset="95%" stopColor={C[0]} stopOpacity={0.02}/>
          </linearGradient>
          <linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={C[2]} stopOpacity={0.3}/><stop offset="95%" stopColor={C[2]} stopOpacity={0.02}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="m" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} />
        <Area type="monotone" dataKey="rev" name="Revenue" stroke={C[0]} fill="url(#sg1)" strokeWidth={2} stackId="s" />
        <Area type="monotone" dataKey="cost" name="Cost" stroke={C[2]} fill="url(#sg2)" strokeWidth={2} stackId="s" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ComboDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ComposedChart data={combo} margin={{top:8,right:28,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="q" tick={AX} axisLine={false} tickLine={false} />
        <YAxis yAxisId="l" tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <YAxis yAxisId="r" orientation="right" tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} />
        <Tooltip {...TIP} />
        <Bar yAxisId="l" dataKey="rev" name="Revenue" fill={C[0]} opacity={0.85} radius={[4,4,0,0]} />
        <Line yAxisId="r" type="monotone" dataKey="growth" name="Growth %" stroke={C[3]} strokeWidth={2.5} dot={{ r:4, fill:C[3] }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function StepDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={step} margin={{top:8,right:16,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="m" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} formatter={(v:number)=>[`$${v.toLocaleString()}`,"Price"]} />
        <Line type="step" dataKey="v" stroke={C[4]} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PieDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <PieChart>
        <Pie data={pieD} dataKey="v" nameKey="n" cx="50%" cy="50%" outerRadius={72} paddingAngle={2} label={({n,v})=>`${n} ${v}%`} labelLine={false}>
          {pieD.map((_,i)=><Cell key={i} fill={C[i%C.length]} />)}
        </Pie>
        <Tooltip {...TIP} formatter={(v:number)=>[`${v}%`]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function DonutDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <PieChart>
        <Pie data={pieD} dataKey="v" nameKey="n" cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={3}>
          {pieD.map((_,i)=><Cell key={i} fill={C[i%C.length]} />)}
        </Pie>
        <Tooltip {...TIP} formatter={(v:number)=>[`${v}%`]} />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" style={{fontSize:14,fontWeight:700,fill:"hsl(var(--foreground))"}}>100%</text>
      </PieChart>
    </ResponsiveContainer>
  );
}

function TreemapDemo() {
  const CustomContent = (props: any) => {
    const { x, y, width, height, name, depth } = props;
    if (!width || !height || width < 20 || height < 14) return null;
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={C[depth % C.length]} stroke="#fff" strokeWidth={2} rx={3} />
        {width > 50 && height > 20 && (
          <text x={x+8} y={y+16} fontSize={10} fill="#fff" fontWeight={600} style={{pointerEvents:"none"}}>{name}</text>
        )}
      </g>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={H}>
      <Treemap data={treemap} dataKey="size" content={<CustomContent />}>
        <Tooltip {...TIP} formatter={(v:number)=>[`$${v.toLocaleString()}`,"Sales"]} />
      </Treemap>
    </ResponsiveContainer>
  );
}

function RadialBarDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <RadialBarChart cx="50%" cy="50%" innerRadius={20} outerRadius={75} data={radialB} startAngle={180} endAngle={-180}>
        <RadialBar dataKey="uv" cornerRadius={4} label={false} />
        <Tooltip {...TIP} formatter={(v:number)=>[`${v}%`]} />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

function HistogramDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={histogram} margin={{top:8,right:10,left:-10,bottom:0}} barCategoryGap={1}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="b" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} />
        <Tooltip {...TIP} formatter={(v:number)=>[v,"Frequency"]} />
        <Bar dataKey="f" fill={C[1]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScatterDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ScatterChart margin={{top:8,right:16,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="x" type="number" name="Ad Spend ($k)" tick={AX} axisLine={false} tickLine={false} />
        <YAxis dataKey="y" type="number" name="Revenue ($)" tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={scatter} fill={C[0]} opacity={0.8} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function BubbleDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ScatterChart margin={{top:8,right:16,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="x" type="number" name="Market Share %" tick={AX} axisLine={false} tickLine={false} />
        <YAxis dataKey="y" type="number" name="Growth Rate" tick={AX} axisLine={false} tickLine={false} />
        <ZAxis dataKey="z" range={[40, 400]} name="Revenue ($k)" />
        <Tooltip {...TIP} />
        <Scatter data={bubble}>
          {bubble.map((_,i)=><Cell key={i} fill={C[i%C.length]} opacity={0.8} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function BoxPlotDemo() {
  // Simplified box plot: show quartile representation via stacked bars
  const boxData = [
    { cat: "Q1", min:20, q1:35, med:8, q3:18, max:12 },
    { cat: "Q2", min:25, q1:30, med:10, q3:22, max:14 },
    { cat: "Q3", min:18, q1:28, med:12, q3:25, max:16 },
    { cat: "Q4", min:30, q1:25, med:11, q3:20, max:15 },
  ];
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={boxData} margin={{top:8,right:10,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="cat" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} />
        <Tooltip {...TIP} />
        <Bar dataKey="min" stackId="b" fill="transparent" />
        <Bar dataKey="q1" stackId="b" fill={C[1]} opacity={0.4} name="Q1–Median" />
        <Bar dataKey="med" stackId="b" fill={C[0]} name="Median" />
        <Bar dataKey="q3" stackId="b" fill={C[1]} opacity={0.6} name="Median–Q3" />
        <Bar dataKey="max" stackId="b" fill={C[1]} opacity={0.3} name="Q3–Max" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function FunnelDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <FunnelChart margin={{top:8,right:10,left:10,bottom:8}}>
        <Tooltip {...TIP} formatter={(v:number)=>[v.toLocaleString(),"Count"]} />
        <Funnel dataKey="v" data={funnel} isAnimationActive={false}>
          {funnel.map((_,i)=><Cell key={i} fill={C[i%C.length]} />)}
          <LabelList dataKey="n" position="right" style={{fontSize:10,fill:"hsl(var(--foreground))"}} />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}

function WaterfallDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={wfBase} margin={{top:8,right:10,left:-10,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="l" tick={AX} axisLine={false} tickLine={false} />
        <YAxis tick={AX} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
        <Tooltip {...TIP} formatter={(v:number)=>[v?`$${v.toLocaleString()}`:"","Value"]} />
        <Bar dataKey="base" stackId="wf" fill="transparent" />
        <Bar dataKey="pos" stackId="wf" fill={C[2]} name="Positive" radius={[4,4,0,0]} />
        <Bar dataKey="neg" stackId="wf" fill={C[4]} name="Negative" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function RadarDemo() {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <RadarChart data={radar} cx="50%" cy="50%" outerRadius={68}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis dataKey="m" tick={{fontSize:10,fill:"hsl(var(--muted-foreground))"}} />
        <PolarRadiusAxis tick={false} axisLine={false} domain={[0,100]} />
        <Radar dataKey="v" stroke={C[0]} fill={C[0]} fillOpacity={0.25} strokeWidth={2} />
        <Tooltip {...TIP} formatter={(v:number)=>[`${v}%`]} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function HeatmapDemo() {
  const days = ["Mon","Tue","Wed","Thu","Fri"];
  const hours = ["9am","11am","1pm","3pm","5pm"];
  const vals = [
    [12,34,45,38,21],[28,52,61,48,34],[18,43,70,55,29],[31,47,64,59,38],[22,41,53,44,26],
  ];
  const max = Math.max(...vals.flat());
  return (
    <div style={{height:H,padding:"8px 12px 8px 32px",position:"relative"}}>
      {/* Y axis labels */}
      <div style={{position:"absolute",left:4,top:8,height:"100%",display:"flex",flexDirection:"column",justifyContent:"space-around",paddingBottom:24}}>
        {days.map(d=><span key={d} style={{fontSize:9,color:"hsl(var(--muted-foreground))"}}>  {d}</span>)}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:2,height:"100%",paddingBottom:18}}>
        {vals.map((row,ri)=>(
          <div key={ri} style={{display:"flex",gap:2,flex:1}}>
            {row.map((v,ci)=>{
              const intensity = v/max;
              const r = Math.round(33 + intensity * (30-33));
              const g = Math.round(150 + intensity * (89-150));
              const b = Math.round(243 + intensity * (38-243));
              return (
                <div key={ci} title={`${days[ri]} ${hours[ci]}: ${v}`}
                  style={{flex:1,borderRadius:3,backgroundColor:`rgba(${r},${g},${b},${0.2+intensity*0.8})`}} />
              );
            })}
          </div>
        ))}
        {/* X axis labels */}
        <div style={{display:"flex",gap:2,marginTop:2}}>
          {hours.map(h=><div key={h} style={{flex:1,fontSize:9,color:"hsl(var(--muted-foreground))",textAlign:"center"}}>{h}</div>)}
        </div>
      </div>
    </div>
  );
}

function SlopeDemo() {
  const slopeData = [
    { label: "North", y2022: 42, y2023: 67 },
    { label: "South", y2022: 58, y2023: 51 },
    { label: "East",  y2022: 35, y2023: 71 },
    { label: "West",  y2022: 63, y2023: 59 },
  ];
  const W = 260, H2 = H - 16;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H2}`} style={{padding:"8px 0"}}>
      {slopeData.map((d,i)=>{
        const x1 = 50, x2 = 210;
        const yScale = (v:number) => H2 - 20 - (v / 100) * (H2 - 40);
        const y1 = yScale(d.y2022), y2 = yScale(d.y2023);
        const color = C[i];
        return (
          <g key={d.label}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} opacity={0.85} />
            <circle cx={x1} cy={y1} r={4} fill={color} />
            <circle cx={x2} cy={y2} r={4} fill={color} />
            <text x={x1-6} y={y1+4} fontSize={9} fill={color} textAnchor="end">{d.y2022}</text>
            <text x={x2+6} y={y2+4} fontSize={9} fill={color} textAnchor="start">{d.y2023}</text>
          </g>
        );
      })}
      <text x={50} y={H2-4} fontSize={9} fill="hsl(var(--muted-foreground))" textAnchor="middle">2022</text>
      <text x={210} y={H2-4} fontSize={9} fill="hsl(var(--muted-foreground))" textAnchor="middle">2023</text>
      {slopeData.map((d,i)=>(
        <text key={d.label} x={128} y={16+i*14} fontSize={9} fill={C[i]} textAnchor="middle">{d.label}</text>
      ))}
    </svg>
  );
}

function GaugeDemo() {
  const value = 72;
  const pct = value / 100;
  const cx = 130, cy = 105, r = 76;
  const startAngle = Math.PI, endAngle = 0;
  const angle = startAngle - pct * Math.PI;
  const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
  const xA = cx + r * Math.cos(angle),       yA = cy + r * Math.sin(angle);
  const largeArc = pct > 0.5 ? 0 : 1;
  const needleAngle = Math.PI - pct * Math.PI;
  const nx = cx + (r-10) * Math.cos(needleAngle), ny = cy + (r-10) * Math.sin(needleAngle);
  return (
    <svg width="100%" viewBox="0 0 260 130" style={{padding:"4px 0"}}>
      {/* Track */}
      <path d={`M${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2}`} fill="none" stroke="hsl(var(--muted))" strokeWidth={14} strokeLinecap="round" />
      {/* Fill */}
      <path d={`M${x1},${y1} A${r},${r} 0 ${largeArc},1 ${xA},${yA}`} fill="none" stroke={C[0]} strokeWidth={14} strokeLinecap="round" />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="hsl(var(--foreground))" strokeWidth={2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill="hsl(var(--foreground))" />
      {/* Labels */}
      <text x={cx} y={cy+22} textAnchor="middle" fontSize={22} fontWeight={700} fill="hsl(var(--foreground))">{value}%</text>
      <text x={cx} y={cy+36} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">Target Achievement</text>
      <text x={52} y={cy+8} fontSize={9} fill="hsl(var(--muted-foreground))" textAnchor="middle">0%</text>
      <text x={208} y={cy+8} fontSize={9} fill="hsl(var(--muted-foreground))" textAnchor="middle">100%</text>
    </svg>
  );
}

function KpiDemo() {
  const kpis = [
    { label: "Total Revenue", value: "$2.4M", change: "+12.3%", up: true },
    { label: "New Customers", value: "1,847", change: "+8.1%",  up: true },
    { label: "Churn Rate",    value: "3.2%",  change: "-0.4%",  up: false },
    { label: "Avg Deal Size", value: "$12.8k",change: "+5.7%",  up: true },
  ];
  return (
    <div style={{height:H, padding:"12px 8px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
      {kpis.map((k,i)=>(
        <div key={i} style={{
          background:`${C[i]}15`,
          borderRadius:8,
          padding:"10px 12px",
          borderLeft:`3px solid ${C[i]}`,
        }}>
          <div style={{fontSize:9,color:"hsl(var(--muted-foreground))",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{k.label}</div>
          <div style={{fontSize:18,fontWeight:700,color:"hsl(var(--foreground))",lineHeight:1.1}}>{k.value}</div>
          <div style={{fontSize:10,marginTop:4,fontWeight:600,color:k.up?"hsl(142,71%,35%)":"hsl(0,72%,51%)"}}>{k.change}</div>
        </div>
      ))}
    </div>
  );
}

function BulletDemo() {
  const bullets = [
    { label:"Sales", actual:73, target:80, poor:40, ok:65, good:100 },
    { label:"NPS",   actual:62, target:70, poor:30, ok:55, good:100 },
    { label:"Growth",actual:85, target:75, poor:40, ok:65, good:100 },
    { label:"Margin",actual:58, target:68, poor:35, ok:55, good:100 },
  ];
  return (
    <div style={{height:H, padding:"12px 16px 12px 48px", display:"flex", flexDirection:"column", gap:12, justifyContent:"center", position:"relative"}}>
      {bullets.map((b,i)=>(
        <div key={b.label} style={{position:"relative"}}>
          <span style={{position:"absolute",left:-44,top:0,fontSize:9,color:"hsl(var(--muted-foreground))",whiteSpace:"nowrap"}}>{b.label}</span>
          <div style={{position:"relative",height:18,borderRadius:3,overflow:"hidden"}}>
            {/* Background ranges */}
            <div style={{position:"absolute",inset:0,background:`${C[i]}22`,borderRadius:3}} />
            <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${b.ok}%`,background:`${C[i]}33`}} />
            <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${b.poor}%`,background:`${C[i]}44`}} />
            {/* Actual bar (centered vertically) */}
            <div style={{position:"absolute",top:"25%",left:0,height:"50%",width:`${b.actual}%`,background:C[i],borderRadius:"0 2px 2px 0"}} />
            {/* Target line */}
            <div style={{position:"absolute",top:0,height:"100%",left:`${b.target}%`,width:2,background:"hsl(var(--foreground))"}} />
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:1}}>
            <span style={{fontSize:9,color:C[i],fontWeight:600}}>{b.actual}</span>
            <span style={{fontSize:9,color:"hsl(var(--muted-foreground))"}}>Target: {b.target}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressBarDemo() {
  const items = [
    { label:"Q1 Sales",  pct:87, color:C[0] },
    { label:"Q2 Sales",  pct:62, color:C[1] },
    { label:"Q3 Sales",  pct:94, color:C[2] },
    { label:"Q4 Target", pct:45, color:C[3] },
    { label:"Annual",    pct:72, color:C[4] },
  ];
  return (
    <div style={{height:H, padding:"14px 12px", display:"flex", flexDirection:"column", gap:10, justifyContent:"center"}}>
      {items.map((it,i)=>(
        <div key={i}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{fontSize:10,color:"hsl(var(--muted-foreground))"}}>{it.label}</span>
            <span style={{fontSize:10,fontWeight:600,color:it.color}}>{it.pct}%</span>
          </div>
          <div style={{height:8,borderRadius:4,background:"hsl(var(--muted))"}}>
            <div style={{height:"100%",width:`${it.pct}%`,background:it.color,borderRadius:4,transition:"width 0.6s ease"}} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SparklineDemo() {
  const sparks = [
    { label:"Revenue",  data:[42,55,48,71,64,82], color:C[0], val:"$8.1M", chg:"+14%" },
    { label:"Users",    data:[120,145,138,162,175,189], color:C[2], val:"1,890", chg:"+8%" },
    { label:"Churn",    data:[5.2,4.8,5.1,4.3,4.0,3.8], color:C[4], val:"3.8%", chg:"-4%" },
    { label:"NPS",      data:[48,52,58,54,62,68], color:C[3], val:"68", chg:"+10pts" },
  ];
  return (
    <div style={{height:H, padding:"10px 8px", display:"flex", flexDirection:"column", gap:8, justifyContent:"center"}}>
      {sparks.map((s,i)=>{
        const min=Math.min(...s.data), max=Math.max(...s.data);
        const pts = s.data.map((v,j)=>{
          const x = (j/(s.data.length-1))*88+4;
          const y = 24 - ((v-min)/(max-min||1))*20;
          return `${x},${y}`;
        }).join(" ");
        return (
          <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"4px 8px",borderRadius:6,background:"hsl(var(--muted)/0.4)"}}>
            <span style={{fontSize:9,color:"hsl(var(--muted-foreground))",width:52,flexShrink:0}}>{s.label}</span>
            <svg width={96} height={28} viewBox={`0 0 96 28`} style={{flexShrink:0}}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={pts.split(" ").at(-1)!.split(",")[0]} cy={pts.split(" ").at(-1)!.split(",")[1]} r={2.5} fill={s.color} />
            </svg>
            <span style={{fontSize:12,fontWeight:700,color:"hsl(var(--foreground))",flex:1}}>{s.val}</span>
            <span style={{fontSize:10,fontWeight:600,color:s.color}}>{s.chg}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── New demo components ─────────────────────────────────────────────────────

function DataTableDemo() {
  const rows = [
    { region:"North",  q1:"$4.2M", q2:"$5.1M", chg:"+21%", up:true  },
    { region:"South",  q1:"$3.8M", q2:"$3.4M", chg:"-11%", up:false },
    { region:"East",   q1:"$5.1M", q2:"$6.8M", chg:"+33%", up:true  },
    { region:"West",   q1:"$4.9M", q2:"$5.7M", chg:"+16%", up:true  },
    { region:"Central",q1:"$2.8M", q2:"$2.9M", chg:"+4%",  up:true  },
  ];
  return (
    <div style={{height:H, overflow:"hidden", padding:"6px 8px"}}>
      <table style={{width:"100%", borderCollapse:"collapse", fontSize:10}}>
        <thead>
          <tr>
            {["Region","Q1","Q2","Growth"].map(h=>(
              <th key={h} style={{padding:"4px 8px", textAlign:"left", color:"hsl(var(--muted-foreground))", fontWeight:700, fontSize:9, borderBottom:"2px solid hsl(var(--border))"}}>
                {h}{h!=="Region"&&<span style={{marginLeft:3,opacity:0.45}}>▾</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i} style={{borderBottom:"1px solid hsl(var(--border))", background:i%2===0?"transparent":"hsl(var(--muted)/0.3)"}}>
              <td style={{padding:"5px 8px", fontWeight:500}}>{r.region}</td>
              <td style={{padding:"5px 8px", color:"hsl(var(--muted-foreground))"}}>{r.q1}</td>
              <td style={{padding:"5px 8px", color:"hsl(var(--muted-foreground))"}}>{r.q2}</td>
              <td style={{padding:"5px 8px"}}>
                <span style={{fontWeight:600, color:r.up?"hsl(142,71%,35%)":"hsl(0,72%,51%)", padding:"2px 6px", borderRadius:3, fontSize:10}}>
                  {r.chg}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{display:"flex", gap:3, marginTop:6, justifyContent:"center"}}>
        {["‹","1","2","3","›"].map((p,i)=>(
          <div key={i} style={{width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:4, border:"1px solid hsl(var(--border))", fontSize:9, background:p==="1"?C[0]:"transparent", color:p==="1"?"#fff":"hsl(var(--muted-foreground))"}}>
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatrixTableDemo() {
  const cols = ["Online","In-Store","Partner","Total"];
  const rowData = [
    { q:"Q1",    vals:[1.2,2.1,0.8, 4.1], isTotal:false },
    { q:"Q2",    vals:[1.5,2.4,0.9, 4.8], isTotal:false },
    { q:"Q3",    vals:[1.9,2.2,1.1, 5.2], isTotal:false },
    { q:"Q4",    vals:[2.3,2.8,1.4, 6.5], isTotal:false },
    { q:"Total", vals:[6.9,9.5,4.2,20.6], isTotal:true  },
  ];
  const maxVal = 9.5;
  return (
    <div style={{height:H, overflow:"hidden", padding:"6px 8px"}}>
      <table style={{width:"100%", borderCollapse:"collapse", fontSize:10}}>
        <thead>
          <tr style={{background:`${C[0]}15`}}>
            <th style={{padding:"5px 8px", textAlign:"left", fontSize:9, fontWeight:700, color:C[0], borderBottom:`2px solid ${C[0]}40`}}>Quarter</th>
            {cols.map(c=>(
              <th key={c} style={{padding:"5px 8px", textAlign:"right", fontSize:9, fontWeight:700, color:c==="Total"?C[0]:"hsl(var(--muted-foreground))", borderBottom:`2px solid ${C[0]}40`}}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowData.map((r,ri)=>(
            <tr key={ri} style={{background:r.isTotal?`${C[0]}10`:ri%2===0?"transparent":"hsl(var(--muted)/0.2)", borderTop:r.isTotal?`1px solid ${C[0]}40`:"1px solid hsl(var(--border))"}}>
              <td style={{padding:"4px 8px", fontWeight:r.isTotal?700:500, color:r.isTotal?C[0]:"hsl(var(--foreground))"}}>{r.q}</td>
              {r.vals.map((v,vi)=>{
                const heat = vi<3 ? v/maxVal : 0;
                return (
                  <td key={vi} style={{padding:"4px 8px", textAlign:"right", fontWeight:(r.isTotal||vi===3)?700:400, color:(r.isTotal||vi===3)?C[0]:"hsl(var(--foreground))", background:vi<3&&!r.isTotal?`rgba(59,130,246,${heat*0.22})`:"transparent"}}>
                    ${v}M
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlicerListDemo() {
  const items = [
    { label:"North Region",  checked:true  },
    { label:"South Region",  checked:true  },
    { label:"East Region",   checked:false },
    { label:"West Region",   checked:true  },
    { label:"Central",       checked:false },
    { label:"International", checked:false },
  ];
  return (
    <div style={{height:H, padding:"10px 12px"}}>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7}}>
        <div style={{fontSize:9, fontWeight:700, color:"hsl(var(--muted-foreground))", textTransform:"uppercase", letterSpacing:"0.06em"}}>Region</div>
        <div style={{fontSize:9, color:C[0], fontWeight:600}}>Select All</div>
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:3}}>
        {items.map((item,i)=>(
          <div key={i} style={{display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:5, background:item.checked?`${C[0]}10`:"transparent", border:`1px solid ${item.checked?C[0]+"30":"transparent"}`}}>
            <div style={{width:13, height:13, borderRadius:3, background:item.checked?C[0]:"transparent", border:`2px solid ${item.checked?C[0]:"hsl(var(--border))"}`, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center"}}>
              {item.checked && <svg width="7" height="5" viewBox="0 0 7 5"><polyline points="1,3 3,5 6,1" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <span style={{fontSize:11, color:item.checked?"hsl(var(--foreground))":"hsl(var(--muted-foreground))", fontWeight:item.checked?500:400}}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlicerDropdownDemo() {
  const filters = [
    { label:"Product Category", value:"Electronics",    active:true  },
    { label:"Sales Channel",    value:"All Channels",   active:false },
    { label:"Time Period",      value:"Last 12 months", active:false },
    { label:"Status",           value:"Active",         active:true  },
  ];
  return (
    <div style={{height:H, padding:"10px 12px", display:"flex", flexDirection:"column", gap:9}}>
      {filters.map((f,i)=>(
        <div key={i}>
          <div style={{fontSize:9, fontWeight:700, color:"hsl(var(--muted-foreground))", marginBottom:3, textTransform:"uppercase", letterSpacing:"0.06em"}}>{f.label}</div>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", padding:"5px 10px", borderRadius:6, border:`1px solid ${f.active?C[0]+"50":"hsl(var(--border))"}`, background:f.active?`${C[0]}08`:"hsl(var(--background))"}}>
            <span style={{fontSize:11, color:"hsl(var(--foreground))", fontWeight:f.active?500:400}}>{f.value}</span>
            <span style={{fontSize:10, color:"hsl(var(--muted-foreground))"}}>▾</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DateSlicerDemo() {
  return (
    <div style={{height:H, padding:"12px 14px"}}>
      <div style={{fontSize:9, fontWeight:700, color:"hsl(var(--muted-foreground))", marginBottom:10, textTransform:"uppercase", letterSpacing:"0.06em"}}>Date Range Filter</div>
      <div style={{position:"relative", margin:"0 6px 18px"}}>
        <div style={{height:4, borderRadius:2, background:"hsl(var(--muted))", position:"relative"}}>
          <div style={{position:"absolute", left:"20%", right:"28%", top:0, height:"100%", background:C[0], borderRadius:2}} />
        </div>
        <div style={{position:"absolute", top:-4, left:"20%", width:12, height:12, borderRadius:"50%", background:"#fff", border:`2px solid ${C[0]}`, transform:"translateX(-50%)", boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}} />
        <div style={{position:"absolute", top:-4, right:"28%", width:12, height:12, borderRadius:"50%", background:"#fff", border:`2px solid ${C[0]}`, transform:"translateX(50%)", boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}} />
      </div>
      <div style={{display:"flex", gap:8, marginBottom:10}}>
        <div style={{flex:1}}>
          <div style={{fontSize:8, color:"hsl(var(--muted-foreground))", marginBottom:3, fontWeight:600}}>FROM</div>
          <div style={{padding:"5px 10px", borderRadius:5, border:`1px solid ${C[0]}40`, background:`${C[0]}08`, fontSize:11, fontWeight:500}}>Mar 2024</div>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:8, color:"hsl(var(--muted-foreground))", marginBottom:3, fontWeight:600}}>TO</div>
          <div style={{padding:"5px 10px", borderRadius:5, border:`1px solid ${C[0]}40`, background:`${C[0]}08`, fontSize:11, fontWeight:500}}>Sep 2024</div>
        </div>
      </div>
      <div style={{display:"flex", flexWrap:"wrap", gap:4}}>
        {["Last 7d","Last 30d","Last 90d","YTD","All Time"].map((o,i)=>(
          <div key={i} style={{padding:"3px 8px", borderRadius:10, border:`1px solid ${i===1?C[0]:"hsl(var(--border))"}`, background:i===1?`${C[0]}12`:"transparent", fontSize:9, color:i===1?C[0]:"hsl(var(--muted-foreground))", fontWeight:i===1?600:400}}>
            {o}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChoroplethMapDemo() {
  const regions = [
    { id:"West",    path:"M12,22 L75,22 L72,100 L12,100 Z",     v:84, cx:42,  cy:62  },
    { id:"Midwest", path:"M75,22 L150,20 L147,95 L72,100 Z",    v:67, cx:110, cy:60  },
    { id:"South",   path:"M72,100 L147,95 L145,148 L12,148 Z",  v:72, cx:88,  cy:122 },
    { id:"NE",      path:"M150,20 L222,16 L220,62 L147,62 Z",   v:91, cx:183, cy:40  },
    { id:"SE",      path:"M147,62 L220,62 L218,148 L145,148 Z", v:78, cx:182, cy:108 },
  ];
  const getColor = (v: number) => {
    const t = (v - 60) / 40;
    return `rgba(37,${Math.round(99 + t*31)},235,${(0.25 + t*0.65).toFixed(2)})`;
  };
  return (
    <div style={{height:H, padding:"4px"}}>
      <svg width="100%" viewBox="0 0 240 168">
        <defs>
          <linearGradient id="choroGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={getColor(60)} />
            <stop offset="100%" stopColor={getColor(100)} />
          </linearGradient>
        </defs>
        {regions.map((r,i)=>(
          <g key={i}>
            <path d={r.path} fill={getColor(r.v)} stroke="#fff" strokeWidth={2} />
            <text x={r.cx} y={r.cy-4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">{r.id}</text>
            <text x={r.cx} y={r.cy+10} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">{r.v}%</text>
          </g>
        ))}
        <rect x={10} y={154} width={90} height={7} rx={2} fill="url(#choroGrad)" />
        <text x={10} y={152} fontSize={8} fill="hsl(var(--muted-foreground))">60%</text>
        <text x={100} y={152} fontSize={8} fill="hsl(var(--muted-foreground))" textAnchor="end">100%</text>
        <text x={112} y={160} fontSize={7} fill="hsl(var(--muted-foreground))">Market penetration by region</text>
      </svg>
    </div>
  );
}

function BubbleMapDemo() {
  const cities = [
    { name:"NY",  x:208, y:48,  r:17, color:C[0], val:94 },
    { name:"LA",  x:38,  y:98,  r:14, color:C[1], val:78 },
    { name:"CHI", x:155, y:58,  r:12, color:C[2], val:65 },
    { name:"HOU", x:128, y:118, r:13, color:C[3], val:72 },
    { name:"PHX", x:65,  y:100, r:9,  color:C[4], val:48 },
    { name:"SEA", x:42,  y:30,  r:10, color:C[5], val:55 },
    { name:"MIA", x:195, y:132, r:11, color:C[6], val:61 },
  ];
  return (
    <div style={{height:H, padding:"4px"}}>
      <svg width="100%" viewBox="0 0 250 158">
        <path d="M14,26 L228,20 L236,50 L238,82 L232,118 L212,140 L178,148 L98,150 L38,142 L10,112 L6,68 Z"
          fill="hsl(var(--muted)/0.35)" stroke="hsl(var(--border))" strokeWidth={1} />
        {cities.map((c,i)=>(
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={c.r} fill={c.color} opacity={0.72} stroke="#fff" strokeWidth={1.5} />
            <text x={c.x} y={c.y+4} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">{c.name}</text>
          </g>
        ))}
        <text x={8} y={156} fontSize={7} fill="hsl(var(--muted-foreground))">Bubble size = revenue · Value = market share %</text>
      </svg>
    </div>
  );
}

function TreeDiagramDemo() {
  const nodes = [
    { label:"CEO",        sub:"Executive",  x:92,  y:8,   depth:0 },
    { label:"VP Sales",   sub:"Revenue",    x:18,  y:54,  depth:1 },
    { label:"VP Tech",    sub:"Engineering",x:92,  y:54,  depth:1 },
    { label:"VP Ops",     sub:"Operations", x:166, y:54,  depth:1 },
    { label:"Sales Mgr",  sub:"Team A",     x:2,   y:106, depth:2 },
    { label:"Intl Sales", sub:"Team B",     x:62,  y:106, depth:2 },
    { label:"Dev Lead",   sub:"Backend",    x:128, y:106, depth:2 },
    { label:"Ops Lead",   sub:"Logistics",  x:188, y:106, depth:2 },
  ];
  const edges = [[0,1],[0,2],[0,3],[1,4],[1,5],[2,6],[3,7]];
  const nodeW = 60, nodeH = 22;
  const depthColor = [C[0], C[1], C[2]];
  return (
    <svg width="100%" viewBox="0 0 252 140" style={{height:H}}>
      {edges.map(([sI,tI],i)=>{
        const sn = nodes[sI], tn = nodes[tI];
        const sx2 = sn.x+nodeW/2, sy2 = sn.y+nodeH;
        const ex = tn.x+nodeW/2, ey = tn.y;
        const my = (sy2+ey)/2;
        return <path key={i} d={`M${sx2},${sy2} C${sx2},${my} ${ex},${my} ${ex},${ey}`} fill="none" stroke="hsl(var(--border))" strokeWidth={1.5} />;
      })}
      {nodes.map((n,i)=>(
        <g key={i}>
          <rect x={n.x} y={n.y} width={nodeW} height={nodeH} rx={4} fill={depthColor[n.depth]} />
          <text x={n.x+nodeW/2} y={n.y+9} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">{n.label}</text>
          <text x={n.x+nodeW/2} y={n.y+18} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.82)">{n.sub}</text>
        </g>
      ))}
    </svg>
  );
}

function SunburstDemo() {
  const cx = 125, cy = 90, r0 = 20, r1 = 52, r2 = 80;
  const arc = (ri: number, ro: number, start: number, end: number): string => {
    const s = start * 2 * Math.PI - Math.PI / 2;
    const e = end   * 2 * Math.PI - Math.PI / 2;
    const large = (end - start) > 0.5 ? 1 : 0;
    const x1i = cx+ri*Math.cos(s), y1i = cy+ri*Math.sin(s);
    const x2i = cx+ri*Math.cos(e), y2i = cy+ri*Math.sin(e);
    const x1o = cx+ro*Math.cos(s), y1o = cy+ro*Math.sin(s);
    const x2o = cx+ro*Math.cos(e), y2o = cy+ro*Math.sin(e);
    return `M${x1i},${y1i} A${ri},${ri} 0 ${large},1 ${x2i},${y2i} L${x2o},${y2o} A${ro},${ro} 0 ${large},0 ${x1o},${y1o} Z`;
  };
  const inner = [
    {start:0,    end:0.38, color:C[0], label:"Sales"},
    {start:0.38, end:0.68, color:C[1], label:"Ops"  },
    {start:0.68, end:1.0,  color:C[2], label:"Tech" },
  ];
  const outer = [
    {start:0,    end:0.22, color:`${C[0]}e0`, label:"Direct" },
    {start:0.22, end:0.38, color:`${C[0]}88`, label:"Partner"},
    {start:0.38, end:0.52, color:`${C[1]}e0`, label:"APAC"   },
    {start:0.52, end:0.68, color:`${C[1]}88`, label:"EMEA"   },
    {start:0.68, end:0.84, color:`${C[2]}e0`, label:"Backend"},
    {start:0.84, end:1.0,  color:`${C[2]}88`, label:"Front"  },
  ];
  return (
    <svg width="100%" viewBox="0 0 250 180" style={{height:H}}>
      {inner.map((s,i)=>{
        const mid = (s.start+s.end)/2*2*Math.PI - Math.PI/2;
        const lr = (r0+r1)/2;
        return (
          <g key={i}>
            <path d={arc(r0,r1,s.start,s.end)} fill={s.color} stroke="#fff" strokeWidth={1.5} />
            <text x={cx+lr*Math.cos(mid)} y={cy+lr*Math.sin(mid)+4} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">{s.label}</text>
          </g>
        );
      })}
      {outer.map((s,i)=>{
        const mid = (s.start+s.end)/2*2*Math.PI - Math.PI/2;
        const lr = (r1+r2)/2;
        return (
          <g key={i}>
            <path d={arc(r1,r2,s.start,s.end)} fill={s.color} stroke="#fff" strokeWidth={1.5} />
            {(s.end-s.start)>0.1 && (
              <text x={cx+lr*Math.cos(mid)} y={cy+lr*Math.sin(mid)+3} textAnchor="middle" fontSize={7} fill="#fff">{s.label}</text>
            )}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={r0} fill="hsl(var(--background))" />
      <text x={cx} y={cy+4} textAnchor="middle" fontSize={8} fontWeight={700} fill="hsl(var(--foreground))">Total</text>
    </svg>
  );
}

function SankeyDemo() {
  const sx = 52, tx = 190, nodeW = 10;
  const sources = [
    {label:"Direct",   pct:"35%", y:16,  h:32, color:C[0]},
    {label:"Organic",  pct:"28%", y:56,  h:26, color:C[1]},
    {label:"Paid",     pct:"22%", y:90,  h:20, color:C[3]},
    {label:"Referral", pct:"15%", y:118, h:14, color:C[2]},
  ];
  const targets = [
    {label:"Product A", y:14,  h:38, color:C[0]},
    {label:"Product B", y:60,  h:30, color:C[1]},
    {label:"Product C", y:98,  h:22, color:C[3]},
    {label:"Churn",     y:128, h:14, color:C[4]},
  ];
  const flows = [
    {si:0,sy:22, ti:0,ty:18, h:12},
    {si:0,sy:34, ti:1,ty:64, h:8 },
    {si:1,sy:60, ti:0,ty:28, h:14},
    {si:1,sy:70, ti:2,ty:102,h:8 },
    {si:2,sy:94, ti:1,ty:74, h:12},
    {si:2,sy:102,ti:3,ty:132,h:6 },
    {si:3,sy:122,ti:2,ty:110,h:8 },
  ];
  const mid = (sx+tx)/2;
  return (
    <svg width="100%" viewBox="0 0 252 155" style={{height:H}}>
      {flows.map((f,i)=>(
        <path key={i} d={`M${sx+nodeW},${f.sy} C${mid},${f.sy} ${mid},${f.ty} ${tx},${f.ty}`}
          fill="none" stroke={sources[f.si].color} strokeWidth={f.h} opacity={0.22} />
      ))}
      {sources.map((s,i)=>(
        <g key={i}>
          <rect x={sx} y={s.y} width={nodeW} height={s.h} rx={2} fill={s.color} />
          <text x={sx-5} y={s.y+s.h/2+3} textAnchor="end" fontSize={9} fill="hsl(var(--muted-foreground))">{s.label}</text>
          <text x={sx-5} y={s.y+s.h/2-4} textAnchor="end" fontSize={8} fill={s.color} fontWeight={600}>{s.pct}</text>
        </g>
      ))}
      {targets.map((t,i)=>(
        <g key={i}>
          <rect x={tx} y={t.y} width={nodeW} height={t.h} rx={2} fill={t.color} />
          <text x={tx+nodeW+5} y={t.y+t.h/2+4} fontSize={9} fill="hsl(var(--muted-foreground))">{t.label}</text>
        </g>
      ))}
    </svg>
  );
}

function GanttDemo() {
  const tasks = [
    {name:"Discovery", start:0, dur:2, prog:1.0,  color:C[0]},
    {name:"Design",    start:1, dur:3, prog:1.0,  color:C[1]},
    {name:"Sprint 1",  start:3, dur:3, prog:1.0,  color:C[2]},
    {name:"Sprint 2",  start:5, dur:3, prog:0.75, color:C[2]},
    {name:"Testing",   start:7, dur:2, prog:0.4,  color:C[3]},
    {name:"Launch",    start:9, dur:1, prog:0.0,  color:C[4]},
  ];
  const totalWks = 11, labelW = 66, rowH = 24, padTop = 22, padR = 8;
  const chartW = 252 - labelW - padR;
  return (
    <svg width="100%" viewBox={`0 0 252 ${padTop + tasks.length*rowH + 8}`} style={{height:H}}>
      {Array.from({length:totalWks},(_,i)=>(
        <g key={i}>
          <text x={labelW+(i+0.5)*chartW/totalWks} y={14} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))">W{i+1}</text>
          <line x1={labelW+i*chartW/totalWks} y1={16} x2={labelW+i*chartW/totalWks} y2={padTop+tasks.length*rowH} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="2,2" />
        </g>
      ))}
      {tasks.map((t,i)=>{
        const y = padTop + i*rowH;
        const x = labelW + (t.start/totalWks)*chartW;
        const w = (t.dur/totalWks)*chartW;
        return (
          <g key={i}>
            <text x={labelW-4} y={y+15} textAnchor="end" fontSize={9} fill="hsl(var(--muted-foreground))">{t.name}</text>
            <rect x={x} y={y+4} width={w} height={rowH-8} rx={3} fill={t.color} opacity={0.22} />
            <rect x={x} y={y+4} width={w*t.prog} height={rowH-8} rx={3} fill={t.color} opacity={0.88} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Chart catalog data ────────────────────────────────────────────────────
const CHARTS: ChartDef[] = [
  // ── Comparison ──────────────────────────────────────────────────────────
  {
    id:"bar", name:"Bar Chart", category:"comparison",
    tagline:"Compare values across discrete categories",
    whenToUse:"When ranking or comparing 3–12 discrete items side-by-side with a single measure.",
    dataNeeded:"1 categorical dimension (X-axis) + 1 numeric measure (Y-axis).",
    bestFor:"Monthly sales by region, revenue by product, headcount by department.",
    avoidWhen:"Continuous time-series data (use Line) or >15 categories (chart becomes unreadable).",
    biTools:"Power BI: Clustered Column • Tableau: Bar • Excel: Column • Looker: Column",
    tags:["bar","column","comparison","ranking","categorical"],
    Demo: BarDemo,
  },
  {
    id:"hbar", name:"Horizontal Bar Chart", category:"comparison",
    tagline:"Rank categories when labels are long or many",
    whenToUse:"Comparing 5–20 items where category names are long, or to show a clear ranking left-to-right.",
    dataNeeded:"1 categorical dimension + 1 numeric measure. Sort by value for clearest reading.",
    bestFor:"Top 10 customer segments, country revenue rankings, feature usage leaderboards.",
    avoidWhen:"Fewer than 4 items (a vertical bar is simpler) or data has a time component.",
    biTools:"Power BI: Clustered Bar • Tableau: Horizontal Bar • Excel: Bar Chart • Looker: Bar",
    tags:["horizontal bar","bar","ranking","comparison","leaderboard"],
    Demo: HBarDemo,
  },
  {
    id:"grouped", name:"Grouped Bar Chart", category:"comparison",
    tagline:"Compare multiple measures side-by-side per category",
    whenToUse:"When comparing 2–4 related measures across the same set of categories simultaneously.",
    dataNeeded:"1 categorical dimension + 2–4 numeric measures. Each measure becomes a bar group.",
    bestFor:"Actual vs budget vs forecast, multi-year comparisons, A/B test results by segment.",
    avoidWhen:"More than 4 measures per group (use Small Multiples or Stacked Bar instead).",
    biTools:"Power BI: Clustered Column • Tableau: Side-by-side bars • Excel: Clustered Column",
    tags:["grouped bar","multi-series","comparison","actual vs budget"],
    Demo: GroupedBarDemo,
  },
  {
    id:"stacked", name:"Stacked Bar Chart", category:"comparison",
    tagline:"Show composition and totals simultaneously",
    whenToUse:"When total size matters AND you want to show how each category contributes to that total.",
    dataNeeded:"1 categorical dimension + 2–5 numeric sub-categories that stack to a meaningful total.",
    bestFor:"Revenue breakdown by product line per quarter, headcount by role per region.",
    avoidWhen:"Comparing individual segments across bars (use Grouped Bar) or >6 stack layers.",
    biTools:"Power BI: Stacked Column • Tableau: Stacked Bar • Excel: Stacked Column • Looker: Stacked bar",
    tags:["stacked bar","composition","part-to-whole","comparison"],
    Demo: StackedBarDemo,
  },
  {
    id:"100pct", name:"100% Stacked Bar", category:"comparison",
    tagline:"Compare proportional composition across categories",
    whenToUse:"When relative proportions (not absolute values) need comparing across multiple groups.",
    dataNeeded:"Same as Stacked Bar; each bar is normalized to 100%, so absolute totals are lost.",
    bestFor:"Market share over time, survey Likert scale results, budget allocation by department.",
    avoidWhen:"Absolute totals matter (use Stacked Bar) or groups have very similar composition.",
    biTools:"Power BI: 100% Stacked Column • Tableau: Percent view • Excel: 100% Stacked • Looker: Normalized",
    tags:["100% stacked","normalized","proportion","market share","comparison"],
    Demo: PercentStackedDemo,
  },
  // ── Trend & Time ─────────────────────────────────────────────────────────
  {
    id:"line", name:"Line Chart", category:"trend",
    tagline:"Track continuous change over time",
    whenToUse:"Showing a metric's trend over time; ideal with ≥6 equally-spaced time periods.",
    dataNeeded:"1 time dimension (X-axis) + 1–4 numeric measures. Time must be continuous & ordered.",
    bestFor:"Stock prices, monthly revenue, website traffic, KPI trend monitoring.",
    avoidWhen:"Categorical (non-time) X-axis (use Bar Chart) or fewer than 5 data points.",
    biTools:"Power BI: Line chart • Tableau: Line • Excel: Line • Looker: Time series • Google Sheets: Line",
    tags:["line","trend","time series","continuous","tracking"],
    Demo: LineDemo,
  },
  {
    id:"area", name:"Area Chart", category:"trend",
    tagline:"Highlight volume and trend simultaneously",
    whenToUse:"Like a line chart but when the filled area adds meaningful context (volume, cumulative).",
    dataNeeded:"Same as Line Chart; the fill adds visual weight to the magnitude of the measure.",
    bestFor:"Cumulative revenue, user growth, bandwidth usage, inventory levels over time.",
    avoidWhen:"Multiple overlapping series (areas block each other). Use stacked area or lines instead.",
    biTools:"Power BI: Area chart • Tableau: Area mark • Excel: Area • Looker: Area",
    tags:["area","volume","trend","cumulative","time series"],
    Demo: AreaDemo,
  },
  {
    id:"stackedarea", name:"Stacked Area Chart", category:"trend",
    tagline:"Show composition trends without overlapping areas",
    whenToUse:"Tracking how multiple categories contribute to a total over time without overlap clutter.",
    dataNeeded:"1 time dimension + 2–5 numeric measures that form a logical total when stacked.",
    bestFor:"Revenue by product line over time, website traffic by source, energy consumption mix.",
    avoidWhen:"Comparing individual series values precisely (lower layers hard to read). Use Combo Chart.",
    biTools:"Power BI: Stacked area • Tableau: Area (stacked) • Excel: Stacked area • Looker: Stacked area",
    tags:["stacked area","composition","trend","cumulative","time series"],
    Demo: StackedAreaDemo,
  },
  {
    id:"combo", name:"Combo Chart (Bar + Line)", category:"trend",
    tagline:"Overlay two measures with different scales",
    whenToUse:"Comparing an absolute measure (bar) with a rate or ratio (line) that has a different scale.",
    dataNeeded:"1 time/category dimension + 1 bar measure + 1 line measure; uses dual Y-axes.",
    bestFor:"Revenue (bars) with growth rate (line), sales volume with average deal size, cost with margin%.",
    avoidWhen:"Both measures share the same scale (use grouped bars) or >2 measures (too cluttered).",
    biTools:"Power BI: Line and clustered column • Tableau: Dual-axis • Excel: Combo chart • Looker: Two-axis",
    tags:["combo","dual axis","bar and line","mixed","two measures"],
    Demo: ComboDemo,
  },
  {
    id:"step", name:"Step / Step-Line Chart", category:"trend",
    tagline:"Show discrete step-wise changes over time",
    whenToUse:"When a value holds constant between change events (pricing, thresholds, policy levels).",
    dataNeeded:"Same as Line Chart but the value is a discrete state that changes at specific moments.",
    bestFor:"Price changes, subscription tier upgrades, SLA threshold changes, interest rate history.",
    avoidWhen:"Gradual continuous changes (the flat steps suggest false stability between points).",
    biTools:"Power BI: Step Line mark • Tableau: Step line • Excel: (manual via helper columns) • Looker: Step",
    tags:["step","step-line","discrete","threshold","state change"],
    Demo: StepDemo,
  },
  // ── Part-to-Whole ─────────────────────────────────────────────────────────
  {
    id:"pie", name:"Pie Chart", category:"composition",
    tagline:"Show proportional share of a whole",
    whenToUse:"Displaying a few (≤5) part-to-whole shares where relative size is the key message.",
    dataNeeded:"1 categorical dimension + 1 numeric measure; values must logically sum to a meaningful whole.",
    bestFor:"Budget allocation, market share among 3–5 brands, revenue split by division.",
    avoidWhen:">5 slices (use Treemap), precise comparison needed (use Bar), or values are very similar.",
    biTools:"Power BI: Pie chart • Tableau: Pie mark • Excel: Pie • Looker: Pie • Google Data Studio: Pie",
    tags:["pie","proportion","part-to-whole","share","composition"],
    Demo: PieDemo,
  },
  {
    id:"donut", name:"Donut Chart", category:"composition",
    tagline:"Pie with center metric — proportion + headline",
    whenToUse:"Same as pie chart; the hollow center is used to display a key summary metric.",
    dataNeeded:"Same as Pie Chart. The center typically shows a total, percentage, or single KPI.",
    bestFor:"Customer segment breakdown showing total count, budget allocation with total spend.",
    avoidWhen:">5 segments, or the center value adds confusion rather than context.",
    biTools:"Power BI: Donut chart • Tableau: Pie (adjust inner radius) • Excel: Doughnut • Looker: Donut",
    tags:["donut","doughnut","ring","proportion","center metric"],
    Demo: DonutDemo,
  },
  {
    id:"treemap", name:"Treemap", category:"composition",
    tagline:"Hierarchical proportions encoded as nested rectangles",
    whenToUse:"Visualizing part-to-whole relationships for many items (>6) in a space-efficient way.",
    dataNeeded:"1–2 categorical dimensions (hierarchy) + 1 numeric measure for area size.",
    bestFor:"Product category sales breakdown, portfolio allocation, server disk space usage.",
    avoidWhen:"Precise comparison needed (areas are hard to compare) or fewer than 5 items.",
    biTools:"Power BI: Treemap • Tableau: Treemap • Excel: Treemap (2016+) • Looker: Treemap",
    tags:["treemap","hierarchy","proportional","nested","space-filling"],
    Demo: TreemapDemo,
  },
  {
    id:"radialbar", name:"Radial Bar Chart", category:"composition",
    tagline:"Progress toward multiple targets in circular layout",
    whenToUse:"Comparing progress or completion percentages for several categories in a compact circular layout.",
    dataNeeded:"1 categorical dimension + 1 numeric measure (percentage or ratio 0–100).",
    bestFor:"Multi-KPI performance dashboard, target achievement across departments, coverage rates.",
    avoidWhen:"Precise value comparison needed (arcs are harder to read than bars). Use Grouped Bar.",
    biTools:"Power BI: Decomposition/Radial gauge • Tableau: Circle views • Excel: (custom) • D3: Radial",
    tags:["radial bar","circular","progress","KPI","multi-metric"],
    Demo: RadialBarDemo,
  },
  // ── Distribution ──────────────────────────────────────────────────────────
  {
    id:"histogram", name:"Histogram", category:"distribution",
    tagline:"Reveal the frequency distribution of a numeric variable",
    whenToUse:"Exploring how a continuous numeric variable is distributed across predefined bins.",
    dataNeeded:"1 continuous numeric variable; the tool bins the data into ranges and counts occurrences.",
    bestFor:"Customer age distribution, deal size frequency, delivery time spread, test score spread.",
    avoidWhen:"Categorical data (use Bar Chart) or fewer than 20 data points (not statistically meaningful).",
    biTools:"Power BI: Histogram (custom visual) • Tableau: Histogram mark • Excel: Histogram analysis tool",
    tags:["histogram","distribution","frequency","bins","spread"],
    Demo: HistogramDemo,
  },
  {
    id:"scatter", name:"Scatter Plot", category:"distribution",
    tagline:"Reveal correlation between two numeric variables",
    whenToUse:"Exploring whether two continuous variables are correlated or finding outliers in a dataset.",
    dataNeeded:"2 continuous numeric variables (X and Y); each dot is one observation.",
    bestFor:"Marketing spend vs revenue, support tickets vs satisfaction, price vs units sold.",
    avoidWhen:"One variable is categorical (use Bar Chart) or data has fewer than 10 points.",
    biTools:"Power BI: Scatter chart • Tableau: Scatter plot • Excel: Scatter/X-Y • Looker: Scatter",
    tags:["scatter","correlation","outlier","two variables","regression"],
    Demo: ScatterDemo,
  },
  {
    id:"bubble", name:"Bubble Chart", category:"distribution",
    tagline:"Encode a third variable as bubble size in a scatter",
    whenToUse:"When you need to show relationships between 3 continuous variables simultaneously.",
    dataNeeded:"3 numeric variables: X position, Y position, and bubble size (Z). Optional: color = 4th dimension.",
    bestFor:"Product portfolio (x=growth, y=margin, size=revenue), country comparisons (x=GDP, y=HDI, size=population).",
    avoidWhen:"Precise size comparison needed (area perception is inaccurate) or bubbles overlap heavily.",
    biTools:"Power BI: Bubble chart • Tableau: Bubble (circle size) • Excel: Bubble chart • Looker: Bubble",
    tags:["bubble","three variables","size encoding","portfolio","scatter matrix"],
    Demo: BubbleDemo,
  },
  {
    id:"boxplot", name:"Box & Whisker Plot", category:"distribution",
    tagline:"Summarize statistical spread with quartiles and outliers",
    whenToUse:"Comparing statistical distributions (median, spread, skew, outliers) across multiple groups.",
    dataNeeded:"1 categorical dimension + 1 continuous numeric variable with ≥20 observations per group.",
    bestFor:"Salary distributions by department, call handling time by agent, product ratings by category.",
    avoidWhen:"Audience unfamiliar with statistical concepts, or fewer than 10 observations per group.",
    biTools:"Power BI: Box and Whisker chart • Tableau: Box plot • Excel: Box & Whisker (2016+) • R/Python: ggplot",
    tags:["box plot","whisker","quartile","outlier","statistical","IQR"],
    Demo: BoxPlotDemo,
  },
  // ── Flow & Process ────────────────────────────────────────────────────────
  {
    id:"funnel", name:"Funnel Chart", category:"flow",
    tagline:"Visualize conversion rates across pipeline stages",
    whenToUse:"Tracking how volume decreases across sequential stages in a pipeline or process.",
    dataNeeded:"Ordered stage names + numeric count or percentage per stage. Stages must be sequential.",
    bestFor:"Sales pipeline (leads→close), website conversion funnel, recruitment stages, onboarding steps.",
    avoidWhen:"Stages are not truly sequential, or you want to compare multiple funnels (use Small Multiples).",
    biTools:"Power BI: Funnel chart • Tableau: Funnel (bar mark sorted) • Excel: Funnel chart (2019+) • Looker: Funnel",
    tags:["funnel","pipeline","conversion","stages","dropout","sales"],
    Demo: FunnelDemo,
  },
  {
    id:"waterfall", name:"Waterfall Chart", category:"flow",
    tagline:"Show cumulative effect of sequential positive/negative values",
    whenToUse:"Explaining how an initial value is affected by a series of positive and negative changes.",
    dataNeeded:"Ordered labels with positive (increase) and negative (decrease) values. Start and end are totals.",
    bestFor:"P&L bridge (Revenue→EBITDA), cash flow statement, variance analysis, budget to actuals.",
    avoidWhen:"Values don't logically accumulate, or you have >10 steps (chart becomes cramped).",
    biTools:"Power BI: Waterfall chart • Tableau: Gantt bar (custom) • Excel: Waterfall (2016+) • Looker: Waterfall",
    tags:["waterfall","bridge chart","P&L","variance","cumulative","financial"],
    Demo: WaterfallDemo,
  },
  {
    id:"radar", name:"Radar / Spider Chart", category:"flow",
    tagline:"Multi-dimensional profiling across 5–8 axes",
    whenToUse:"Comparing an entity across 5–8 qualitative or quantitative dimensions simultaneously.",
    dataNeeded:"5–8 labeled axes + 1–3 numeric measures per axis (same scale or normalized 0–100).",
    bestFor:"Competitive benchmarking, employee performance reviews, product feature comparisons, team skills.",
    avoidWhen:">8 axes (unreadable), axes have very different scales without normalization, or precise values matter.",
    biTools:"Power BI: Radar chart • Tableau: Polygon/Radial • Excel: Radar chart • Looker: Custom vis",
    tags:["radar","spider","web","multi-dimensional","benchmark","polygon"],
    Demo: RadarDemo,
  },
  {
    id:"slope", name:"Slope Chart", category:"flow",
    tagline:"Compare rank or value changes between exactly two time points",
    whenToUse:"Highlighting which items increased, decreased, or stayed stable between two specific points.",
    dataNeeded:"1 categorical dimension + 1 numeric measure at exactly 2 time periods.",
    bestFor:"Before/after program impact, year-over-year performance change, pre/post survey results.",
    avoidWhen:"More than 2 time periods (use Line Chart), or too many overlapping lines (>10 items).",
    biTools:"Tableau: Slope chart (line with 2 columns) • Power BI: Line chart (2 points) • D3: Custom",
    tags:["slope","before after","change","two periods","ranking change"],
    Demo: SlopeDemo,
  },
  // ── Relationship ──────────────────────────────────────────────────────────
  {
    id:"heatmap", name:"Heatmap", category:"relationship",
    tagline:"Color-encode intensity across a two-dimensional matrix",
    whenToUse:"Revealing patterns, correlations, or concentrations across two categorical dimensions.",
    dataNeeded:"2 categorical dimensions (rows & columns) + 1 numeric measure encoded as cell color.",
    bestFor:"Website engagement by day/time, correlation matrix of variables, geo-demographic patterns.",
    avoidWhen:"Too few cells (use Scatter), or exact values matter more than patterns (use Table).",
    biTools:"Power BI: Matrix with conditional formatting • Tableau: Highlight table • Excel: Conditional format • D3: Heatmap",
    tags:["heatmap","matrix","density","intensity","two-dimensional","pattern"],
    Demo: HeatmapDemo,
  },
  // ── KPIs & Metrics ────────────────────────────────────────────────────────
  {
    id:"kpi", name:"KPI Metric Cards", category:"performance",
    tagline:"Display critical numbers at a glance with context",
    whenToUse:"Surfacing 4–8 headline numbers with change indicators on executive dashboards.",
    dataNeeded:"Single aggregated numeric value per card + optional comparison value for delta calculation.",
    bestFor:"Executive dashboards, daily standup boards, ops center screens, management summaries.",
    avoidWhen:"Precise trends needed (add sparklines) or too many cards fragment attention.",
    biTools:"Power BI: Card, KPI visual • Tableau: Text mark/KPI • Excel: Custom cells • Looker: Single value",
    tags:["KPI","metric card","scorecard","headline","executive"],
    Demo: KpiDemo,
  },
  {
    id:"gauge", name:"Gauge / Dial Chart", category:"performance",
    tagline:"Show progress toward a single target on a radial scale",
    whenToUse:"Communicating how a key metric performs relative to a target in a dashboard widget.",
    dataNeeded:"1 numeric value + target value; optional threshold ranges (red/yellow/green).",
    bestFor:"Sales quota achievement, NPS score, SLA compliance rate, capacity utilization.",
    avoidWhen:"Multiple metrics (use Bullet Chart or Radial Bar), or data changes frequently (needle hard to follow).",
    biTools:"Power BI: Gauge visual • Tableau: Gauge (custom) • Excel: Doughnut hack • Looker: Gauge",
    tags:["gauge","dial","speedometer","target","goal","single metric"],
    Demo: GaugeDemo,
  },
  {
    id:"bullet", name:"Bullet Chart", category:"performance",
    tagline:"Compare actual vs target with qualitative ranges",
    whenToUse:"Displaying performance vs target with additional context (poor/acceptable/good ranges).",
    dataNeeded:"Actual value + target value + 2–3 qualitative range thresholds (per metric).",
    bestFor:"Sales target tracking, agent performance scorecards, budget compliance, SLA compliance.",
    avoidWhen:"Audience unfamiliar with the format; use a simpler bar + reference line instead.",
    biTools:"Power BI: Bullet chart (custom) • Tableau: Bullet chart (bar type) • Plotly: Bullet • D3: Bullet",
    tags:["bullet","target","benchmark","performance","range","KPI"],
    Demo: BulletDemo,
  },
  {
    id:"progress", name:"Progress Bar Chart", category:"performance",
    tagline:"Linear completion tracking across multiple items",
    whenToUse:"Showing percentage completion or progress toward goals for multiple items at once.",
    dataNeeded:"1 categorical dimension + 1 numeric measure (percentage or ratio 0–100) per item.",
    bestFor:"Project milestone completion, sales goal tracking, onboarding checklist, adoption rates.",
    avoidWhen:"Values are not naturally percentage-based, or precise ranking between items matters.",
    biTools:"Power BI: Data bar conditional format • Tableau: Bar (normalized) • Excel: Data bars • Looker: Progress bar",
    tags:["progress","completion","percentage","goal","milestone","bar"],
    Demo: ProgressBarDemo,
  },
  {
    id:"sparkline", name:"Sparkline", category:"performance",
    tagline:"Inline micro-trend alongside a headline metric",
    whenToUse:"Showing trend context alongside a single number without consuming dashboard space.",
    dataNeeded:"1 numeric measure across ≥5 time points; displayed as a tiny line without labels.",
    bestFor:"Dashboard tables with trend indicators, financial reports, stock tickers, metric summaries.",
    avoidWhen:"Detailed trend analysis needed (use full Line Chart), or data has only 1–2 points.",
    biTools:"Power BI: Sparkline (table column) • Tableau: Sparklines (line mark) • Excel: Sparklines feature",
    tags:["sparkline","mini chart","inline","trend indicator","table"],
    Demo: SparklineDemo,
  },
  // ── Tables & Matrix ──────────────────────────────────────────────────────
  {
    id:"datatable", name:"Data Table", category:"tabular",
    tagline:"Display raw or aggregated data in sortable, paginated rows",
    whenToUse:"When users need to read, scan, or compare individual records with precision rather than spot a trend.",
    dataNeeded:"Any structured dataset with 2–10 columns; works best under 200 visible rows with pagination.",
    bestFor:"Claims detail, policy list, transaction history, agent performance detail, audit exports.",
    avoidWhen:"Patterns or trends matter more than individual values (use a chart). Avoid >20 columns.",
    biTools:"Power BI: Table visual • Tableau: Text table • Excel: Table / PivotTable • Looker: Look as Table",
    tags:["table","grid","rows","columns","data","sortable","paginated","detail"],
    Demo: DataTableDemo,
  },
  {
    id:"matrix", name:"Matrix / Pivot Table", category:"tabular",
    tagline:"Cross-tabulate measures across two dimensions with subtotals",
    whenToUse:"When you need to compare the same measure across two orthogonal dimensions simultaneously.",
    dataNeeded:"2 categorical dimensions (rows & columns) + 1–2 numeric measures; row/column totals optional.",
    bestFor:"Sales by region × product, loss ratio by line × quarter, claims by state × coverage type.",
    avoidWhen:"Only one dimension varies (use a table or bar chart). Avoid >10 row or column values.",
    biTools:"Power BI: Matrix visual • Tableau: Crosstab / Text table • Excel: PivotTable • Looker: Pivot",
    tags:["matrix","pivot","crosstab","cross-tabulation","two dimensions","subtotals","heat map table"],
    Demo: MatrixTableDemo,
  },
  // ── Slicers & Filters ────────────────────────────────────────────────────
  {
    id:"slicer-list", name:"Slicer — Checkbox List", category:"interactive",
    tagline:"Multi-select toggle filter for categorical dimensions",
    whenToUse:"When users frequently filter a dashboard by a categorical dimension with 3–15 values.",
    dataNeeded:"1 categorical dimension. The slicer broadcasts the selection to all connected visuals.",
    bestFor:"Filtering by region, product line, agent team, policy status, or coverage type.",
    avoidWhen:">15 values (use a searchable dropdown), or the dimension is numeric (use a range slicer).",
    biTools:"Power BI: Slicer (list) • Tableau: Quick filter • Looker: Dashboard filter • Sigma: Control",
    tags:["slicer","filter","checkbox","multi-select","interactive","categorical","panel"],
    Demo: SlicerListDemo,
  },
  {
    id:"slicer-dropdown", name:"Slicer — Dropdown Filter", category:"interactive",
    tagline:"Space-efficient dropdown for filtering one dimension at a time",
    whenToUse:"When multiple filter controls are needed on a space-constrained dashboard header.",
    dataNeeded:"1 categorical dimension per dropdown. Usually single-select; multi-select variant available.",
    bestFor:"Dashboard-level filters for time period, geography, business unit, or scenario selection.",
    avoidWhen:"Users need to see all options at a glance simultaneously (use a List Slicer or button bar).",
    biTools:"Power BI: Slicer (dropdown) • Tableau: Parameter control • Looker: Filter • Sigma: Select control",
    tags:["slicer","dropdown","filter","compact","interactive","select","parameter"],
    Demo: SlicerDropdownDemo,
  },
  {
    id:"date-slicer", name:"Date Range Slicer", category:"interactive",
    tagline:"Slider and quick-pick controls for filtering a time window",
    whenToUse:"When users need to dynamically adjust the reporting time window on a time-series dashboard.",
    dataNeeded:"A date/datetime column. The slicer passes start & end dates as parameters to connected visuals.",
    bestFor:"Policy effective date range, claim filing period, YTD vs custom period, rolling window analysis.",
    avoidWhen:"The report covers a fixed period; preset quick-pick buttons (MTD, YTD) may fully suffice.",
    biTools:"Power BI: Slicer (between dates) • Tableau: Date range filter • Looker: Date filter • Retool: Date range",
    tags:["date slicer","date range","filter","time","slider","calendar","period"],
    Demo: DateSlicerDemo,
  },
  // ── Geographic ───────────────────────────────────────────────────────────
  {
    id:"choropleth", name:"Choropleth / Filled Map", category:"geo",
    tagline:"Encode a measure as fill color over geographic regions",
    whenToUse:"When a business metric varies meaningfully by geographic region (state, country, territory).",
    dataNeeded:"Geographic dimension (state codes, country names, or GeoJSON polygons) + 1 numeric measure.",
    bestFor:"Market penetration by state, loss ratio by territory, policy count by ZIP, sales by country.",
    avoidWhen:"Regions vary wildly in physical size (large empty areas distort perception). Consider a cartogram.",
    biTools:"Power BI: Filled Map / Shape Map • Tableau: Filled Map • Looker: Map • Google Data Studio: Geo chart",
    tags:["choropleth","filled map","geographic","regional","territory","heat map","geo"],
    Demo: ChoroplethMapDemo,
  },
  {
    id:"bubblemap", name:"Bubble / Point Map", category:"geo",
    tagline:"Plot sized or colored markers at geographic coordinates",
    whenToUse:"When precise location matters and bubble size encodes a measure such as revenue by city.",
    dataNeeded:"Latitude/longitude or city/zip coordinates + 1 numeric measure (size) + optional 2nd (color).",
    bestFor:"Office or branch revenue comparison, claims density by city, agent coverage, event locations.",
    avoidWhen:"Dense overlapping bubbles obscure the map. Consider clustering or a hex-bin layer instead.",
    biTools:"Power BI: Map visual • Tableau: Symbol Map • Looker: Map (point) • Mapbox: Circle layer • Kepler.gl",
    tags:["bubble map","point map","geographic","location","symbol","scatter map","geo"],
    Demo: BubbleMapDemo,
  },
  // ── Hierarchy & Tree ─────────────────────────────────────────────────────
  {
    id:"tree", name:"Tree / Org Chart", category:"hierarchy",
    tagline:"Visualize parent–child hierarchies as connected nodes",
    whenToUse:"Displaying org structures, reporting chains, category taxonomies, account hierarchies, or decision trees.",
    dataNeeded:"Parent–child relationship data (id, parentId, label). Best at ≤4 levels of depth.",
    bestFor:"Org charts, account hierarchies, policy category trees, BOM structures, approval chains.",
    avoidWhen:"Relationships are network-like (many-to-many connections). Use a Network/Graph diagram instead.",
    biTools:"Power BI: Decomposition Tree / Org Chart visual • Tableau: Tree layout (custom) • D3: Tree layout",
    tags:["tree","org chart","hierarchy","parent child","node","organizational","decomposition"],
    Demo: TreeDiagramDemo,
  },
  {
    id:"sunburst", name:"Sunburst Chart", category:"hierarchy",
    tagline:"Radial multi-level breakdown from centre outward",
    whenToUse:"Showing multi-level part-to-whole breakdowns where hierarchy depth and proportion both matter.",
    dataNeeded:"2–3 level categorical hierarchy + 1 numeric measure for arc size at each level.",
    bestFor:"Revenue by division → department, claims by peril → sub-peril, portfolio by sector → stock.",
    avoidWhen:">3 hierarchy levels or >8 categories per ring (outer rings become unreadable slivers).",
    biTools:"Power BI: Sunburst custom visual • Tableau: Radial custom • Plotly: Sunburst • ECharts: Sunburst",
    tags:["sunburst","radial","hierarchy","drill-down","multi-level","donut","ring"],
    Demo: SunburstDemo,
  },
  // ── Flow & Process (additions) ───────────────────────────────────────────
  {
    id:"sankey", name:"Sankey Diagram", category:"flow",
    tagline:"Show volume flow and redistribution between source and target nodes",
    whenToUse:"Visualizing how volume flows and transforms between stages, sources, or categories.",
    dataNeeded:"Source–target pairs with a numeric flow value. Nodes appear from the links automatically.",
    bestFor:"Customer journey source → product, energy flow, budget allocation, web traffic attribution.",
    avoidWhen:">12 nodes or too many crossing links (becomes a 'spaghetti diagram'). Simplify or aggregate.",
    biTools:"Power BI: Sankey custom visual • Tableau: Sankey (custom) • D3: Sankey plugin • Google Charts: Sankey",
    tags:["sankey","flow","alluvial","stream","energy","attribution","source target"],
    Demo: SankeyDemo,
  },
  {
    id:"gantt", name:"Gantt / Timeline Chart", category:"flow",
    tagline:"Schedule tasks with progress bars along a horizontal time axis",
    whenToUse:"Planning or tracking project phases, milestones, or process steps across a time horizon.",
    dataNeeded:"Task name + start date + end date (or duration). Optional: % complete and dependency arrows.",
    bestFor:"Project roadmaps, sprint planning, claims processing SLA tracking, marketing campaign calendar.",
    avoidWhen:"Data has no time component, or >30 tasks (use phased views or a summary rollup instead).",
    biTools:"Power BI: Gantt custom visual • Tableau: Gantt mark • Excel: Stacked bar workaround • Jira: Roadmap",
    tags:["gantt","timeline","schedule","project","milestones","planning","roadmap"],
    Demo: GanttDemo,
  },
];

// ─── Category filter tabs ────────────────────────────────────────────────────
const ALL_CATS: { id: string; label: string }[] = [
  { id: "all", label: "All Charts" },
  ...Object.entries(CATS).map(([id, v]) => ({ id, label: v.label })),
];

// ─── Catalog card ────────────────────────────────────────────────────────────
function ChartCard({ chart }: { chart: ChartDef }) {
  const cat = CATS[chart.category];
  const Demo = chart.Demo;
  return (
    <Card className="overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col">
      {/* Demo area */}
      <div className="bg-muted/20 border-b flex-shrink-0">
        <Demo />
      </div>

      <CardContent className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight">{chart.name}</h3>
          <Badge variant="outline" className={`text-[10px] shrink-0 font-medium px-2 py-0.5 ${cat.badge}`}>
            {cat.label}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed -mt-1">{chart.tagline}</p>

        <Separator />

        {/* Info rows */}
        <div className="space-y-2 text-[11px]">
          <div className="flex gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
            <div><span className="font-semibold text-foreground">When to use: </span>
              <span className="text-muted-foreground">{chart.whenToUse}</span></div>
          </div>
          <div className="flex gap-2">
            <Database className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
            <div><span className="font-semibold text-foreground">Data needed: </span>
              <span className="text-muted-foreground">{chart.dataNeeded}</span></div>
          </div>
          <div className="flex gap-2">
            <Building2 className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
            <div><span className="font-semibold text-foreground">Best for: </span>
              <span className="text-muted-foreground">{chart.bestFor}</span></div>
          </div>
          <div className="flex gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div><span className="font-semibold text-foreground">Avoid when: </span>
              <span className="text-muted-foreground">{chart.avoidWhen}</span></div>
          </div>
        </div>

        <Separator />

        {/* BI tools */}
        <div className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground/70">BI Equivalents: </span>
          {chart.biTools}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VisualsCatalog() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CHARTS.filter(c => {
      const matchCat = cat === "all" || c.category === cat;
      if (!matchCat) return false;
      if (!q) return true;
      return [c.name, c.tagline, c.whenToUse, c.bestFor, c.biTools, ...c.tags]
        .some(s => s.toLowerCase().includes(q));
    });
  }, [search, cat]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: CHARTS.length };
    for (const c of CHARTS) m[c.category] = (m[c.category] ?? 0) + 1;
    return m;
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BarChart2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Visuals Catalog</h1>
            <p className="text-sm text-muted-foreground">
              {CHARTS.length} chart types used across Power BI, Tableau, Excel and Looker — with demo plots and guidance on when to use each.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search charts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="text-xs text-muted-foreground self-center">
          {filtered.length === CHARTS.length ? `${CHARTS.length} charts` : `${filtered.length} of ${CHARTS.length} charts`}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_CATS.map(c => {
          const active = cat === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-150 ${
                active
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {c.label}
              <span className={`ml-1.5 text-[10px] px-1 rounded ${active ? "bg-white/20" : "bg-muted"}`}>
                {counts[c.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No charts match your search. Try different keywords.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map(chart => (
            <ChartCard key={chart.id} chart={chart} />
          ))}
        </div>
      )}
    </div>
  );
}
