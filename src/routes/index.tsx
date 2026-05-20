import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CompletionDex — Xbox 100% Completions Leaderboard" },
      { name: "description", content: "See who's grinding the hardest 100% Xbox completions. Points scored by time and effort." },
    ],
  }),
  component: HomePage,
});

type LeaderRow = { user_id: string; gamertag: string; gamerpic: string | null; total_points: number; completions: number };
type RecentRow = {
  id: string;
  game_name: string;
  game_cover_url: string | null;
  points: number;
  completed_at: string;
  hours_played: number;
  profile: { gamertag: string; gamerpic: string | null } | null;
};

function HomePage() {
  const leaderboard = useQuery({
    queryKey: ["leaderboard"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<LeaderRow[]> => {
      const [{ data: comps, error: e1 }, { data: profs, error: e2 }] = await Promise.all([
        supabase.from("completions").select("user_id, points").eq("status", "approved"),
        supabase.from("profiles").select("user_id, gamertag, gamerpic"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const profileMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
      const agg = new Map<string, LeaderRow>();
      for (const row of (comps as any[]) ?? []) {
        const prof = profileMap.get(row.user_id);
        if (!prof) continue;
        const prev = agg.get(row.user_id) ?? {
          user_id: row.user_id,
          gamertag: prof.gamertag,
          gamerpic: prof.gamerpic,
          total_points: 0,
          completions: 0,
        };
        prev.total_points += row.points;
        prev.completions += 1;
        agg.set(row.user_id, prev);
      }
      return [...agg.values()].sort((a, b) => b.total_points - a.total_points).slice(0, 50);
    },
  });

  const recent = useQuery({
    queryKey: ["recent-completions"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<RecentRow[]> => {
      const { data: comps, error: e1 } = await supabase
        .from("completions")
        .select("id, game_name, game_cover_url, points, completed_at, hours_played, user_id")
        .eq("status", "approved")
        .order("completed_at", { ascending: false })
        .limit(20);
      if (e1) throw e1;
      if (!comps?.length) return [];
      const userIds = [...new Set(comps.map((c) => c.user_id))];
      const { data: profs, error: e2 } = await supabase
        .from("profiles")
        .select("user_id, gamertag, gamerpic")
        .in("user_id", userIds);
      if (e2) throw e2;
      const profileMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
      return comps.map((c) => {
        const prof = profileMap.get(c.user_id) ?? null;
        return { ...c, profile: prof ? { gamertag: prof.gamertag, gamerpic: prof.gamerpic } : null };
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container mx-auto px-4 py-10">
        <section className="mb-12 text-center">
          <h1 className="bg-gradient-to-r from-primary to-foreground bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-6xl">
            Every 100% counts.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Log your fully-completed Xbox games. Earn points scaled by time and effort.
            Climb the leaderboard.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
              {leaderboard.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : leaderboard.data?.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No completions yet. Be the first — <Link to="/signup" className="text-primary underline">sign up</Link>.
                </p>
              ) : (
                <ol className="divide-y divide-border">
                  {leaderboard.data?.map((row, i) => (
                    <li key={row.user_id} className="flex items-center gap-4 py-3">
                      <span className="w-6 text-right font-mono text-sm text-muted-foreground">{i + 1}</span>
                      {row.gamerpic ? (
                        <img src={row.gamerpic} alt="" className="h-10 w-10 rounded-full border border-border" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-secondary" />
                      )}
                      <Link to="/u/$gamertag" params={{ gamertag: row.gamertag }} className="flex-1 font-medium hover:text-primary">
                        {row.gamertag}
                      </Link>
                      <span className="text-sm text-muted-foreground">{row.completions} games</span>
                      <span className="font-mono text-lg font-bold text-primary">{row.total_points}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent completions</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : recent.data?.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="space-y-3">
                  {recent.data?.map((r) => (
                    <li key={r.id} className="flex items-start gap-3">
                      {r.game_cover_url ? (
                        <img src={r.game_cover_url} alt="" className="h-12 w-12 rounded border border-border object-cover" />
                      ) : (
                        <div className="h-12 w-12 rounded bg-secondary" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.game_name}</p>
                        <p className="text-xs text-muted-foreground">
                          <Link to="/u/$gamertag" params={{ gamertag: r.profile?.gamertag ?? "" }} className="hover:text-primary">
                            {r.profile?.gamertag}
                          </Link>
                          {" · "}
                          {new Date(r.completed_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">{r.points} pts</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
