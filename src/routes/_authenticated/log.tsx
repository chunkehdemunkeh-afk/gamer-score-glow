import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getCompletedTitles, type XblTitle } from "@/lib/xbox.functions";
import { logCompletion } from "@/lib/completions.functions";
import { tierLabel, pointsForHours } from "@/lib/scoring";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/log")({ component: LogPage });

function LogPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchTitles = useServerFn(getCompletedTitles);
  const submit = useServerFn(logCompletion);

  const [selected, setSelected] = useState<XblTitle | null>(null);
  const [hours, setHours] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const profile = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("gamertag, xuid")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (profile.isSuccess && !profile.data) navigate({ to: "/onboarding" });
  }, [profile.isSuccess, profile.data, navigate]);

  const existing = useQuery({
    queryKey: ["my-title-ids", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("completions").select("title_id").eq("user_id", user!.id);
      return new Set((data ?? []).map((c) => c.title_id));
    },
  });

  const titles = useQuery({
    queryKey: ["xbl-completed", profile.data?.xuid],
    enabled: !!profile.data?.xuid,
    queryFn: () => fetchTitles({ data: { xuid: profile.data!.xuid } }),
  });

  const available = (titles.data?.titles ?? []).filter((t) => !existing.data?.has(t.titleId));
  const hrsNum = Number(hours);
  const validHours = hrsNum > 0 && hrsNum < 10000;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !validHours) return;
    setBusy(true);
    const res = await submit({
      data: {
        titleId: selected.titleId,
        gameName: selected.name,
        gameCoverUrl: selected.displayImage,
        hoursPlayed: hrsNum,
      },
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    if (res.flagged) {
      toast.warning(`Logged but flagged for review: ${res.flags.join("; ")}`);
    } else {
      toast.success(`+${pointsForHours(hrsNum)} points!`);
    }
    qc.invalidateQueries({ queryKey: ["my-completions"] });
    qc.invalidateQueries({ queryKey: ["my-title-ids"] });
    qc.invalidateQueries({ queryKey: ["leaderboard"] });
    qc.invalidateQueries({ queryKey: ["recent-completions"] });
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container mx-auto px-4 py-10">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Pick a 100%-completed game</CardTitle></CardHeader>
            <CardContent>
              {titles.isLoading ? (
                <p className="text-muted-foreground">Fetching your completed games from Xbox…</p>
              ) : titles.isError ? (
                <p className="text-destructive">Couldn't reach Xbox. Try again.</p>
              ) : available.length === 0 ? (
                <p className="text-muted-foreground">
                  No new fully-completed games found.
                </p>
              ) : (
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
                  {available.map((t) => (
                    <li key={t.titleId}>
                      <button
                        onClick={() => setSelected(t)}
                        className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors ${
                          selected?.titleId === t.titleId
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {t.displayImage ? (
                          <img src={t.displayImage} alt="" className="h-12 w-12 rounded object-cover" />
                        ) : (
                          <div className="h-12 w-12 rounded bg-secondary" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.currentGamerscore}/{t.maxGamerscore} G
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Hours played</CardTitle></CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-muted-foreground">Pick a game on the left.</p>
              ) : (
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="flex items-center gap-3">
                    {selected.displayImage && (
                      <img src={selected.displayImage} alt="" className="h-16 w-16 rounded border border-border object-cover" />
                    )}
                    <p className="font-semibold">{selected.name}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hrs">How many hours did the 100% take you?</Label>
                    <Input
                      id="hrs"
                      type="number"
                      min="0.1"
                      step="0.1"
                      required
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                    />
                    {validHours && (
                      <p className="text-sm text-primary">{tierLabel(hrsNum)}</p>
                    )}
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Heads up: we cross-check your reported hours against the time between your
                    first and last achievement unlock, the community baseline for this game, and
                    a gamerscore-per-hour sanity ceiling. Inflated numbers get flagged.
                  </div>
                  <Button type="submit" className="w-full" disabled={busy || !validHours}>
                    {busy ? "Logging…" : "Log completion"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
