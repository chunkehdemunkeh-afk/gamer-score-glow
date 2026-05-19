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
    "Accept-Language": "en-GB",
  } as Record<string, string>;
}

// Look up a gamertag → xuid + gamerpic
export const lookupGamertag = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ gamertag: z.string().trim().min(1).max(50) }).parse(input),
  )
  .handler(async ({ data }) => {
    // Old-format Xbox gamertags can have spaces. The working Python approach uses
    // requests.utils.quote(gamertag) with safe='/' which leaves spaces as raw
    // spaces in the URL (not %20). We replicate that by encoding manually.
    const spaceless = data.gamertag.replace(/\s+/g, "");
    const candidates = [...new Set([data.gamertag, spaceless])];

    const errors: string[] = [];
    for (const candidate of candidates) {
      // Encode everything except spaces, then replace spaces with raw space
      // (matching Python's requests.utils.quote default behaviour).
      const encoded = encodeURIComponent(candidate).replace(/%20/g, " ");
      const url = `${XBL_BASE}/search/${encoded}`;
      let res: Response;
      try {
        res = await fetch(url, { headers: xblHeaders() });
      } catch (e) {
        errors.push(`fetch error: ${e}`);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        errors.push(`HTTP ${res.status} for "${candidate}": ${body.slice(0, 200)}`);
        console.error(`[xbox] search "${candidate}" → HTTP ${res.status}`, body.slice(0, 500));
        continue;
      }
      const raw = await res.text();
      let json: { people?: Array<{ xuid: string; gamertag: string; displayPicRaw?: string }>; content?: { people?: Array<{ xuid: string; gamertag: string; displayPicRaw?: string }> } };
      try { json = JSON.parse(raw); } catch { errors.push(`Bad JSON: ${raw.slice(0, 200)}`); continue; }
      const person = (json.content?.people ?? json.people)?.[0];
      if (person) {
        return {
          ok: true as const,
          xuid: person.xuid,
          gamertag: person.gamertag,
          gamerpic: person.displayPicRaw ?? null,
        };
      }
      errors.push(`200 but no person for "${candidate}": ${raw.slice(0, 300)}`);
    }

    console.error(`[xbox] all candidates failed for "${data.gamertag}". Errors:`, errors);
    return { ok: false as const, error: errors[0] ?? "Gamertag not found" };
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

export type LastActivity = {
  titleName: string;
  titleImage: string | null;
  lastTimePlayed: string;
  achievementName: string | null;
  achievementDescription: string | null;
  achievementIcon: string | null;
  unlockedAt: string | null;
};

type RawTitle = {
  titleId: string;
  name: string;
  displayImage?: string;
  achievement?: {
    currentGamerscore?: number;
    totalGamerscore?: number;
    progressPercentage?: number;
  };
  titleHistory?: { lastTimePlayed?: string };
};

type RawAchievement = {
  name?: string;
  description?: string;
  progressState?: string;
  progression?: { timeUnlocked?: string };
  mediaAssets?: Array<{ type?: string; url?: string }>;
  rewards?: Array<{ value?: string; type?: string }>;
};

async function fetchLastActivity(xuid: string, title: RawTitle): Promise<LastActivity> {
  const base: LastActivity = {
    titleName: title.name,
    titleImage: title.displayImage ?? null,
    lastTimePlayed: title.titleHistory!.lastTimePlayed!,
    achievementName: null,
    achievementDescription: null,
    achievementIcon: null,
    unlockedAt: null,
  };
  try {
    const url = `${XBL_BASE}/achievements/player/${encodeURIComponent(xuid)}/${encodeURIComponent(title.titleId)}`;
    const res = await fetch(url, { headers: xblHeaders() });
    if (!res.ok) return base;
    const json = (await res.json()) as { achievements?: RawAchievement[] };
    const unlocked = (json.achievements ?? [])
      .filter((a) => a.progressState === "Achieved" && a.progression?.timeUnlocked)
      .map((a) => ({ a, t: new Date(a.progression!.timeUnlocked!) }))
      .filter(({ t }) => !isNaN(t.getTime()) && t.getFullYear() > 1970)
      .sort((x, y) => y.t.getTime() - x.t.getTime());
    if (unlocked.length === 0) return base;
    const { a, t } = unlocked[0];
    return {
      ...base,
      achievementName: a.name ?? null,
      achievementDescription: a.description ?? null,
      achievementIcon: a.mediaAssets?.find((m) => m.type === "Icon")?.url ?? null,
      unlockedAt: t.toISOString(),
    };
  } catch {
    return base;
  }
}

// Fetch all titles for a given xuid and return ONLY 100%-completed ones.
export const getCompletedTitles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ xuid: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<{ titles: XblTitle[]; lastActivity: LastActivity | null  }> => {
    const url = `${XBL_BASE}/achievements/player/${encodeURIComponent(data.xuid)}`;
    const res = await fetch(url, { headers: xblHeaders() });
    if (!res.ok) throw new Error(`Xbox API error: ${res.status}`);
    const json = (await res.json()) as { titles?: RawTitle[] };
    const allTitles = json.titles ?? [];

    const titles = allTitles
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

    // Find the most recently played title across all titles to gauge API staleness.
    const mostRecent = allTitles
      .filter((t) => t.titleHistory?.lastTimePlayed)
      .sort(
        (a, b) =>
          new Date(b.titleHistory!.lastTimePlayed!).getTime() -
          new Date(a.titleHistory!.lastTimePlayed!).getTime(),
      )[0] ?? null;

    const lastActivity = mostRecent ? await fetchLastActivity(data.xuid, mostRecent) : null;

    return { titles, lastActivity };
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
