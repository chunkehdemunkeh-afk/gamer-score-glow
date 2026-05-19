import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { deleteCompletion } from "@/lib/completions.functions";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const del = useServerFn(deleteCompletion);

  const profile = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("gamertag, gamerpic, xuid")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (profile.isSuccess && !profile.data) navigate({ to: "/onboarding" });
  }, [profile.isSuccess, profile.data, navigate]);

  const completions = useQuery({
    queryKey: ["my-completions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("completions")
        .select("*")
        .eq("user_id", user!.id)
        .order("completed_at", { ascending: false });
      return data ?? [];
    },
  });

  const totalPoints = completions.data?.filter((c) => c.status === "approved").reduce((s, c) => s + c.points, 0) ?? 0;
  const approvedCount = completions.data?.filter((c) => c.status === "approved").length ?? 0;

  async function onDelete(id: string) {
    if (!confirm("Delete this completion?")) return;
    const res = await del({ data: { id } });
    if (!res.ok) return toast.error(res.error);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["my-completions"] });
    qc.invalidateQueries({ queryKey: ["leaderboard"] });
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container mx-auto px-4 py-10">
        <div className="mb-6 flex items-center gap-4">
          {profile.data?.gamerpic ? (
            <img src={profile.data.gamerpic} alt="" className="h-16 w-16 rounded-full border border-border" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-secondary" />
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{profile.data?.gamertag ?? "…"}</h1>
            <p className="text-sm text-muted-foreground">
              {approvedCount} completed · {totalPoints} pts
            </p>
          </div>
          <Link to="/log"><Button>Log completion</Button></Link>
        </div>

        <Card>
          <CardHeader><CardTitle>My completions</CardTitle></CardHeader>
          <CardContent>
            {completions.isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : completions.data?.length === 0 ? (
              <p className="text-muted-foreground">
                No completions yet. <Link to="/log" className="text-primary underline">Log your first one</Link>.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Game</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Points</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completions.data?.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="flex items-center gap-3">
                        {c.game_cover_url && (
                          <img src={c.game_cover_url} alt="" className="h-10 w-10 rounded border border-border object-cover" />
                        )}
                        <span className="font-medium">{c.game_name}</span>
                      </TableCell>
                      <TableCell>{new Date(c.completed_at).toLocaleDateString()}</TableCell>
                      <TableCell>{c.hours_played}</TableCell>
                      <TableCell className="font-mono font-bold text-primary">{c.points}</TableCell>
                      <TableCell>
                        {c.status === "approved" && <Badge variant="secondary">Approved</Badge>}
                        {c.status === "flagged" && (
                          <Badge variant="destructive" title={c.flag_reason ?? ""}>Flagged</Badge>
                        )}
                        {c.status === "rejected" && <Badge variant="outline">Rejected</Badge>}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => onDelete(c.id)}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
