import { useState } from "react";
import { useGetDataset, getGetDatasetQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, FileSpreadsheet, AlertTriangle } from "lucide-react";
import UnderstandingView from "./UnderstandingView";
import QualityView from "./QualityView";

interface DatasetDetailViewProps {
  workspaceId: number;
  datasetId: number;
  onBack: () => void;
}

export default function DatasetDetailView({ workspaceId, datasetId, onBack }: DatasetDetailViewProps) {
  const [tab, setTab] = useState<"understanding" | "quality">("understanding");
  const { data, isLoading, error } = useGetDataset(datasetId, {
    query: { queryKey: getGetDatasetQueryKey(datasetId) },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <p className="text-sm">Could not load this file.</p>
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to files
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="dataset-detail">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
            data-testid="dataset-back"
          >
            <ArrowLeft className="w-3 h-3" /> Files
          </button>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{data.fileName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sheet <span className="font-medium">{data.sheetName}</span> · {data.rowCount.toLocaleString()} rows ·{" "}
              {data.columns.length} columns
            </p>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="understanding" data-testid="subtab-understanding">
            Understanding
          </TabsTrigger>
          <TabsTrigger value="quality" data-testid="subtab-quality">
            Quality
          </TabsTrigger>
        </TabsList>
        <TabsContent value="understanding" className="mt-4">
          <UnderstandingView dataset={data} />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          <QualityView dataset={data} workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
