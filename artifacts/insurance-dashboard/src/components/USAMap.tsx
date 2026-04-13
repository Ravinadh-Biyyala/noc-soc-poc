import { useGetGeographyData } from "@workspace/api-client-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// Simplified d3-geo compatible paths for US States (Albers USA projection)
const statePaths: Record<string, string> = {
  AL: "M103.5,234.6c-4.4-1.2-8.5,0.8-12.7,2.2c-1.3,0.4-3.3-0.5-4.1,0.9c-0.6,1-0.2,2.4-0.1,3.6c0.4,3.7-0.7,7.7-2.3,11.2 c-1.2,2.8-2.6,5.5-4.3,8c-1.5,2.1-4,3.6-5.8,5.6c-3,3.3-4.1,7.8-6,11.8c-1.4,2.5-1.9,5.5-3.1,8.1c-1.3,2.6-3.8,4.5-5.6,6.9 c-1.3,1.7-1.4,4.2-2.7,6c-0.6,0.9-1.9,1.1-2.9,1.6c0.5-0.7,0.7-1.7,1.3-2.3c3.4-3.4,7.4-6.4,11-9.7c3.9-3.5,7.9-6.9,11.8-10.4 c1.2-1,2.3-2.1,3.5-3.1c1.5-1.3,3-2.6,4.6-3.8c1.3-0.9,2.8-1.5,4-2.6c0.9-0.8,1.6-1.8,2.2-2.8c2-3.1,4.5-5.9,6.7-8.9 c1.2-1.5,2.3-3.1,3.4-4.6c0.7-1,1.7-1.7,2.4-2.7c1-1.3,1.9-2.7,2.9-4c0.8-1,1.8-1.9,2.6-3c0.7-1,1-2.3,1.7-3.2 C106.6,240.2,105,236.8,103.5,234.6z M117.8,225.4c0.6,0.5,1.2,1.3,1.5,2c0.7,1.4,0.6,3.1,1.1,4.6c0.5,1.4,1.8,2.3,2.5,3.6 c0.8,1.3,1.1,2.9,1.8,4.3c0.8,1.5,2.1,2.6,3,4.1c1.1,1.9,1.6,4,2.6,5.9c0.9,1.6,2.2,2.8,3,4.4c1,1.9,1.5,4.1,2.5,6 c0.8,1.5,2,2.7,2.8,4.2c1.1,2.1,1.7,4.3,2.7,6.3c1,1.9,2.5,3.4,3.5,5.2c1.2,2,1.7,4.4,2.9,6.4c1.1,1.8,2.6,3.1,3.7,5 c0.8,1.4,1.2,3.1,2,4.5c0.6,1.2,1.6,2,2.2,3.2c0.5,1.1,0.5,2.4,1.1,3.5c0.8,1.6,2.3,2.7,3.1,4.3c0.9,1.7,1,3.8,1.9,5.5 c0.9,1.7,2.2,2.9,3.1,4.6c0.7,1.3,1.2,2.9,2,4.2c1.5-2,3-4,4.5-6.1c1.3-1.8,2.6-3.6,3.9-5.4c1.2-1.7,2.4-3.3,3.5-5 C164.2,284.1,141.4,255.4,117.8,225.4z M175.7,268.4c-0.8-1.5-1.2-3.1-2-4.5c-0.8-1.5-2-2.7-2.9-4.1 c-1.1-1.8-1.7-3.9-2.7-5.8c-1-1.9-2.4-3.4-3.4-5.3c-1.1-2.1-1.7-4.4-2.8-6.5c-0.9-1.6-2.3-2.8-3.2-4.4c-0.8-1.5-1.3-3.2-2.1-4.7 c-1.1-1.9-2.4-3.4-3.5-5.3c-0.9-1.5-1.4-3.3-2.3-4.8c-0.8-1.4-2-2.6-2.8-3.9c-1.2-1.9-1.9-4.1-3-6c-1-1.7-2.3-3.1-3.3-4.8 c-0.6-1-1.2-2.1-1.7-3.2c-0.4-0.8-0.9-1.4-1.3-2.2c0.2,0,0.4,0,0.6,0c0,0,0,0,0,0.1c0,0,0,0,0,0.1c4.5,1.2,8.8,3,13.2,4.4 c3.9,1.3,7.9,2.4,11.8,3.5c3.6,1,7.2,2.2,10.9,3.1c4.2,1,8.5,1.7,12.7,2.5c3.5,0.7,7,1.4,10.6,2c4,0.7,8,1.4,12,2 c2.6,0.4,5.3,0.8,7.9,1.2c1.7,0.3,3.5,0.4,5.2,0.6c0.4,0,0.9-0.1,1.3,0.2c0.6,0.3,0.4,1,0.4,1.5c-0.1,0.5-0.1,1-0.2,1.5 c-0.3,1.3-1,2.4-1.3,3.7c-0.3,1.3-0.5,2.6-0.8,3.9c-0.4,1.4-1.1,2.6-1.5,4c-0.4,1.4-0.7,2.8-1.1,4.2c-0.3,1.4-1,2.6-1.3,4 c-0.3,1.3-0.6,2.7-0.9,4c-0.3,1.3-0.9,2.6-1.2,3.9c-0.2,1.3-0.5,2.5-0.8,3.8c-0.4,1.4-1,2.7-1.4,4.1c-0.4,1.4-0.7,2.9-1.1,4.3 c-0.3,1.4-0.9,2.7-1.3,4.1c-0.4,1.3-0.7,2.7-1.1,4c-0.4,1.3-1,2.5-1.4,3.8c-0.3,1.2-0.5,2.5-0.8,3.8c-0.5,2-1.3,3.8-1.9,5.8 c-0.4,1.4-0.9,2.7-1.3,4.1c-0.3,1.2-0.6,2.4-0.9,3.7c-0.3,1.2-0.8,2.3-1.1,3.5c-0.4,1.4-0.7,2.8-1.1,4.2c-0.3,1.1-0.6,2.2-0.9,3.4 c-0.6,2.2-1.5,4.3-2.1,6.5c-0.4,1.2-0.7,2.4-1,3.7c-0.4,1.5-1,2.9-1.4,4.3c-0.3,1.3-0.6,2.6-1,3.9c-0.5,1.7-1.1,3.4-1.6,5.1 C193.3,272.7,185.2,270.7,175.7,268.4z",
  // We'll use a simplified rectangular grid approach for demo since full SVG paths are 100kb+
  // In a real app, you would import 'us-atlas' or similar d3-geo data
};

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
  { code: 'AK', x: 190, y: -10, name: 'Alaska' }, // using AK for ME actually... wait, let's just make it a stylized grid
  { code: 'HI', x: 25, y: 100, name: 'Hawaii' },
];

export default function USAMap() {
  const { data, isLoading } = useGetGeographyData();

  if (isLoading || !data) {
    return <Skeleton className="w-full h-full min-h-[300px] rounded-xl bg-card border-border" />;
  }

  const maxPremium = Math.max(...data.states.map(s => s.writtenPremium));
  const minPremium = Math.min(...data.states.map(s => s.writtenPremium));

  const getColor = (premium: number) => {
    // Teal scale: #14b8a6 (var(--primary)) to very dark
    const ratio = (premium - minPremium) / (maxPremium - minPremium || 1);
    // return rgba with primary color
    return `rgba(20, 184, 166, ${0.2 + (ratio * 0.8)})`;
  };

  return (
    <div className="w-full aspect-[4/3] max-w-[600px] relative mt-4">
      {/* We use a highly stylized hex-grid map for modern dashboard feel instead of exact geographic paths to save bundle size while looking premium */}
      <svg viewBox="0 0 200 120" className="w-full h-full drop-shadow-lg">
        {SIMPLIFIED_STATES.map((state) => {
          const stateData = data.states.find(s => s.stateCode === state.code);
          const premium = stateData?.writtenPremium || 0;
          const color = stateData ? getColor(premium) : 'rgba(42, 48, 85, 0.5)'; // default empty state
          
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
                      stroke="rgba(20, 184, 166, 0.5)"
                      strokeWidth="0.5"
                      className="hover:stroke-[rgba(20,184,166,1)] hover:stroke-2 transition-all drop-shadow-[0_0_4px_rgba(20,184,166,0.3)]"
                    />
                    <text 
                      x={state.x + 7} 
                      y={state.y + 9} 
                      textAnchor="middle" 
                      fill="white" 
                      fontSize="5" 
                      fontWeight="bold"
                      className="pointer-events-none opacity-80"
                    >
                      {state.code}
                    </text>
                  </g>
                </TooltipTrigger>
                {stateData && (
                  <TooltipContent className="bg-card border-border text-foreground p-3 rounded-lg shadow-xl shadow-primary/10 min-w-[200px]">
                    <div className="font-semibold text-white mb-2 pb-2 border-b border-border/50">{stateData.stateName}</div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Premium</span>
                        <span className="font-medium text-primary">{formatCurrency(stateData.writtenPremium)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Growth</span>
                        <span className="font-medium text-white">+{stateData.yoyGrowth.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Retention</span>
                        <span className="font-medium text-white">{formatPercent(stateData.retentionRate)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Policies</span>
                        <span className="font-medium text-white">{stateData.policyCount.toLocaleString()}</span>
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
