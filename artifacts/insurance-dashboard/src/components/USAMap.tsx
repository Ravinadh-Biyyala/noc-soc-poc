import { useGetGeographyData } from "@workspace/api-client-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const SIMPLIFIED_STATES = [
  { code: 'WA', x: 10, y: 10, name: 'Washington' },
  { code: 'OR', x: 10, y: 25, name: 'Oregon' },
  { code: 'CA', x: 10, y: 40, name: 'California' },
  { code: 'ID', x: 25, y: 15, name: 'Idaho' },
  { code: 'NV', x: 25, y: 30, name: 'Nevada' },
  { code: 'UT', x: 25, y: 45, name: 'Utah' },
  { code: 'AZ', x: 25, y: 60, name: 'Arizona' },
  { code: 'MT', x: 40, y: 15, name: 'Montana' },
  { code: 'WY', x: 40, y: 30, name: 'Wyoming' },
  { code: 'CO', x: 40, y: 45, name: 'Colorado' },
  { code: 'NM', x: 40, y: 60, name: 'New Mexico' },
  { code: 'ND', x: 55, y: 20, name: 'North Dakota' },
  { code: 'SD', x: 55, y: 35, name: 'South Dakota' },
  { code: 'NE', x: 55, y: 50, name: 'Nebraska' },
  { code: 'KS', x: 55, y: 65, name: 'Kansas' },
  { code: 'OK', x: 55, y: 80, name: 'Oklahoma' },
  { code: 'TX', x: 55, y: 95, name: 'Texas' },
  { code: 'MN', x: 70, y: 20, name: 'Minnesota' },
  { code: 'IA', x: 70, y: 35, name: 'Iowa' },
  { code: 'MO', x: 70, y: 50, name: 'Missouri' },
  { code: 'AR', x: 70, y: 65, name: 'Arkansas' },
  { code: 'LA', x: 70, y: 80, name: 'Louisiana' },
  { code: 'WI', x: 85, y: 20, name: 'Wisconsin' },
  { code: 'IL', x: 85, y: 35, name: 'Illinois' },
  { code: 'MI', x: 85, y: 50, name: 'Michigan' },
  { code: 'IN', x: 85, y: 65, name: 'Indiana' },
  { code: 'OH', x: 100, y: 35, name: 'Ohio' },
  { code: 'KY', x: 100, y: 50, name: 'Kentucky' },
  { code: 'TN', x: 100, y: 65, name: 'Tennessee' },
  { code: 'MS', x: 85, y: 80, name: 'Mississippi' },
  { code: 'AL', x: 100, y: 80, name: 'Alabama' },
  { code: 'GA', x: 115, y: 80, name: 'Georgia' },
  { code: 'FL', x: 130, y: 80, name: 'Florida' },
  { code: 'SC', x: 130, y: 65, name: 'South Carolina' },
  { code: 'NC', x: 130, y: 50, name: 'North Carolina' },
  { code: 'VA', x: 130, y: 35, name: 'Virginia' },
  { code: 'WV', x: 115, y: 35, name: 'West Virginia' },
  { code: 'MD', x: 115, y: 20, name: 'Maryland' },
  { code: 'DE', x: 130, y: 20, name: 'Delaware' },
  { code: 'PA', x: 130, y: 5, name: 'Pennsylvania' },
  { code: 'NJ', x: 145, y: 20, name: 'New Jersey' },
  { code: 'NY', x: 145, y: 5, name: 'New York' },
  { code: 'CT', x: 145, y: 35, name: 'Connecticut' },
  { code: 'RI', x: 160, y: 35, name: 'Rhode Island' },
  { code: 'MA', x: 160, y: 20, name: 'Massachusetts' },
  { code: 'VT', x: 175, y: 20, name: 'Vermont' },
  { code: 'NH', x: 160, y: 5, name: 'New Hampshire' },
  { code: 'ME', x: 175, y: 5, name: 'Maine' },
  { code: 'HI', x: 25, y: 100, name: 'Hawaii' },
];

export default function USAMap() {
  const { data, isLoading } = useGetGeographyData();

  if (isLoading || !data) {
    return <Skeleton className="w-full h-full min-h-[300px] rounded-xl" />;
  }

  const maxPremium = Math.max(...data.states.map(s => s.writtenPremium));
  const minPremium = Math.min(...data.states.map(s => s.writtenPremium));

  const getColor = (premium: number) => {
    const ratio = (premium - minPremium) / (maxPremium - minPremium || 1);
    const r = Math.round(210 - ratio * 190);
    const g = Math.round(230 - ratio * 100);
    const b = Math.round(245 - ratio * 40);
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="w-full aspect-[4/3] max-w-[600px] relative mt-4">
      <svg viewBox="0 0 200 120" className="w-full h-full">
        {SIMPLIFIED_STATES.map((state) => {
          const stateData = data.states.find(s => s.stateCode === state.code);
          const premium = stateData?.writtenPremium || 0;
          const color = stateData ? getColor(premium) : '#e8ecf0';
          
          return (
            <TooltipProvider key={state.code} delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <g className="cursor-pointer transition-all duration-300 hover:opacity-80">
                    <rect 
                      x={state.x} 
                      y={state.y} 
                      width="14" 
                      height="14" 
                      rx="2"
                      fill={color}
                      stroke="#c4cdd5"
                      strokeWidth="0.5"
                      className="hover:stroke-[hsl(var(--chart-1))] hover:stroke-2 transition-all"
                    />
                    <text 
                      x={state.x + 7} 
                      y={state.y + 9} 
                      textAnchor="middle" 
                      fill={stateData ? (premium > (maxPremium * 0.5) ? '#fff' : '#2a3a5c') : '#8896a8'} 
                      fontSize="5" 
                      fontWeight="600"
                      className="pointer-events-none"
                    >
                      {state.code}
                    </text>
                  </g>
                </TooltipTrigger>
                {stateData && (
                  <TooltipContent className="bg-white border border-border text-foreground p-3 rounded-lg shadow-lg min-w-[200px]">
                    <div className="font-semibold text-foreground mb-2 pb-2 border-b border-border">{stateData.stateName}</div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Premium</span>
                        <span className="font-medium text-primary">{formatCurrency(stateData.writtenPremium)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Growth</span>
                        <span className="font-medium text-emerald-600">+{stateData.yoyGrowth.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Retention</span>
                        <span className="font-medium text-foreground">{formatPercent(stateData.retentionRate)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Policies</span>
                        <span className="font-medium text-foreground">{stateData.policyCount.toLocaleString()}</span>
                      </div>
                    </div>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </svg>
    </div>
  );
}
