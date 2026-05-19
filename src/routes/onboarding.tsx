import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { lookupGamertag } from "@/lib/xbox.functions";
import { createProfile } from "@/lib/completions.functions";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const lookup = useServerFn(lookupGamertag);
  const create = useServerFn(createProfile);

  const [gamertag, setGamertag] = useState("");
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<{ gamertag: string; xuid: string; gamerpic: string | null } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("gamertag")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) navigate({ to: "/dashboard" }); });
  }, [user, navigate]);

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await lookup({ data: { gamertag } });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setMatch({ gamertag: res.gamertag, xuid: res.xuid, gamerpic: res.gamerpic });
  }

  async function onConfirm() {
    if (!match) return;
    setBusy(true);
    const res = await create({ data: match });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Profile created");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container mx-auto px-4 py-16">
        <Card className="mx-auto max-w-md">
          <CardHeader><CardTitle>Link your gamertag</CardTitle></CardHeader>
          <CardContent>
            {!match ? (
              <form onSubmit={onLookup} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter your Xbox gamertag. We'll verify it and link it to your account.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="gt">Gamertag</Label>
                  <Input id="gt" required value={gamertag} onChange={(e) => setGamertag(e.target.value)} placeholder="e.g. Major Nelson" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Looking up…" : "Find me"}
                </Button>
              </form>
            ) : (
              <div className="space-y-4 text-center">
                {match.gamerpic && <img src={match.gamerpic} alt="" className="mx-auto h-24 w-24 rounded-full border border-border" />}
                <div>
                  <p className="text-lg font-semibold">{match.gamertag}</p>
                  <p className="text-xs text-muted-foreground">XUID {match.xuid}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setMatch(null)}>Not me</Button>
                  <Button className="flex-1" onClick={onConfirm} disabled={busy}>
                    {busy ? "Linking…" : "That's me"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
