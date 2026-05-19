import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/u/$gamertag")({
  component: PublicProfile,
  head: ({ params }) => ({
    meta: [
      { title: `${params.gamertag} — CompletionDex` },
      { name: "description", content: `${params.gamertag}'s 100% Xbox completions on CompletionDex.` },
    ],
  }),
});

function PublicProfile() {
  const { gamertag } = Route.useParams();

  const profile = useQuery({
    queryKey: ["profile-public", gamertag],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, gamertag, gamerpic")
        .eq("gamertag", gamertag)
        .maybeSingle();
      return data;
    },
  });

  const completions = useQuery({
    queryKey: ["public-completions", profile.data?.user_id],
    enabled: !!profile.data?.user_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("completions")
        .select("*")
        .eq("user_id", profile.data!.user_id)
        .eq("status", "approved")
        .order("completed_at", { ascending: false });
      return data ?? [];
    },
  });

  if (profile.isLoading) return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  if (!profile.data) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold">Profile not found</h1>
        </main>
      </div>
    );
  }

  const totalPoints = completions.data?.reduce((s, c) => s + c.points, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container mx-auto px-4 py-10">
        <div className="mb-6 flex items-center gap-4">
          {profile.data.gamerpic ? (
            <img src={profile.data.gamerpic} alt="" className="h-16 w-16 rounded-full border border-border" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-secondary" />
          )}
          <div>
            <h1 className="text-2xl font-bold">{profile.data.gamertag}</h1>
            <p className="text-sm text-muted-foreground">
              {completions.data?.length ?? 0} completions · {totalPoints} pts
            </p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Completed games</CardTitle></CardHeader>
          <CardContent>
            {completions.data?.length === 0 ? (
              <p className="text-muted-foreground">No approved completions yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Game</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Points</TableHead>
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
                      <TableCell className="font-mono font-bold text-primary">
                        <Badge variant="secondary">{c.points}</Badge>
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
