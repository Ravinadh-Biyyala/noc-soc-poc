import { useMemo } from "react";
import { Link, Redirect } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, ArrowRight } from "lucide-react";

/**
 * Legacy `/upload` route landing.
 *
 * Files are now workspace-scoped, so the standalone Upload page is gone. If
 * the user has any workspaces, redirect to the most recently updated one's
 * Files tab. If there are none, show a friendly nudge to create one — we
 * don't surprise-create a workspace on their behalf.
 */
export default function UploadRedirect() {
  const { data, isLoading } = useListWorkspaces();

  const target = useMemo(() => {
    if (!data || data.length === 0) return null;
    // The list is ordered by updatedAt desc on the server, but defend against
    // future ordering changes by sorting again here.
    const sorted = [...data].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return sorted[0];
  }, [data]);

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto pt-16 space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (target) {
    return <Redirect to={`/workspaces/${target.id}/files`} replace />;
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-md" data-testid="upload-redirect-empty">
        <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Briefcase className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-base font-semibold">Pick a workspace first</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Files now live inside workspaces. Create one to start uploading data and generating dashboards.
            </p>
          </div>
          <Link href="/workspaces">
            <Button size="sm" data-testid="upload-redirect-cta">
              Go to Workspaces <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
