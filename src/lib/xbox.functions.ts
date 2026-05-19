import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const XBL_BASE = "https://xbl.io/api/v2";

function xblHeaders() {
  const key = process.env.OPENXBL_API_KEY;
  if (!key) throw new Error("OPENXBL_API_KEY not configured");
  return {
    "X-Authorization": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  } as Record<string, string>;
}

// Look up a gamertag → xuid + gamerpic
export const lookupGamertag = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ gamertag: z.string().trim().min(1).max(15) }).parse(input),
  )
  .handler(async ({ data }) => {
    const res = await fetch(`${XBL_BASE}/search/${encodeURIComponent(data.gamertag)}`, {
      headers: xblHeaders(),
    });
    if (!res.ok) {
      return { ok: false as const, error: `Lookup failed (${res.status})` };
    }
    const json = (await res.json()) as { people?: Array<{ xuid: string; gamertag: string; displayPicRaw?: string }> };
    const person = json.people?.[0];
    if (!person) return { ok: false as const, error: "Gamertag not found" };
    return {
      ok: true as const,
      xuid: person.xuid,
      gamertag: person.gamertag,
      gamerpic: person.displayPicRaw ?? null,
    };
  });

export type XblTitle = {
  titleId: string;
  name: string;
  displayImage: string | null;
  currentGamerscore: number;
  maxGamerscore: number;
  earliestUnlock: string | null;
  latestUnlock: string | null;
  isComplete: boolean;
};

// Fetch all titles for a given xuid and return ONLY 100%-completed ones.
export const getCompletedTitles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ xuid: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<{ titles: XblTitle[] }> => {
    const url = `${XBL_BASE}/achievements/player/${encodeURIComponent(data.xuid)}`;
    const res = await fetch(url, { headers: xblHeaders() });
    if (!res.ok) throw new Error(`Xbox API error: ${res.status}`);
    const json = (await res.json()) as {
      titles?: Array<{
        titleId: string;
        name: string;
        displayImage?: string;
        achievement?: {
          currentGamerscore?: number;
          totalGamerscore?: number;
          progressPercentage?: number;
        };
        titleHistory?: { lastTimePlayed?: string };
      }>;
    };
    const titles = (json.titles ?? [])
      .filter((t) => (t.achievement?.progressPercentage ?? 0) >= 100)
      .map<XblTitle>((t) => ({
        titleId: String(t.titleId),
        name: t.name,
        displayImage: t.displayImage ?? null,
        currentGamerscore: t.achievement?.currentGamerscore ?? 0,
        maxGamerscore: t.achievement?.totalGamerscore ?? 0,
        earliestUnlock: null,
        latestUnlock: t.titleHistory?.lastTimePlayed ?? null,
        isComplete: true,
      }));
    return { titles };
  });

// Fetch achievement unlock timestamps for a single title (for anti-cheat).
export const getTitleAchievements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ xuid: z.string().min(1), titleId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const url = `${XBL_BASE}/achievements/player/${encodeURIComponent(
      data.xuid,
    )}/${encodeURIComponent(data.titleId)}`;
    const res = await fetch(url, { headers: xblHeaders() });
    if (!res.ok) throw new Error(`Xbox API error: ${res.status}`);
    const json = (await res.json()) as {
      achievements?: Array<{
        progression?: { timeUnlocked?: string };
        progressState?: string;
        rewards?: Array<{ value?: string; type?: string }>;
      }>;
    };
    const unlocks = (json.achievements ?? [])
      .filter((a) => a.progressState === "Achieved" && a.progression?.timeUnlocked)
      .map((a) => new Date(a.progression!.timeUnlocked!))
      .filter((d) => !isNaN(d.getTime()) && d.getFullYear() > 1970);
    if (unlocks.length === 0) {
      return { earliestUnlock: null, latestUnlock: null, totalGamerscore: 0, achievementCount: 0 };
    }
    unlocks.sort((a, b) => a.getTime() - b.getTime());
    const totalGs = (json.achievements ?? []).reduce((sum, a) => {
      const gs = a.rewards?.find((r) => r.type === "Gamerscore")?.value;
      return sum + (gs ? parseInt(gs, 10) || 0 : 0);
    }, 0);
    return {
      earliestUnlock: unlocks[0].toISOString(),
      latestUnlock: unlocks[unlocks.length - 1].toISOString(),
      totalGamerscore: totalGs,
      achievementCount: unlocks.length,
    };
  });
