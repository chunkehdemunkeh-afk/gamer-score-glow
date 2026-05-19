import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pointsForHours } from "./scoring";

const XBL_BASE = "https://xbl.io/api/v2";
function xblHeaders() {
  const key = process.env.OPENXBL_API_KEY;
  if (!key) throw new Error("OPENXBL_API_KEY not configured");
  return { "X-Authorization": key, Accept: "application/json", "Accept-Language": "en-GB" } as Record<string, string>;
}

// Log a completion with anti-cheat checks.
export const logCompletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        titleId: z.string().min(1),
        gameName: z.string().min(1).max(200),
        gameCoverUrl: z.string().url().nullable().optional(),
        hoursPlayed: z.number().positive().max(10000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Get profile (need xuid to query Xbox)
    const { data: profile } = await supabase
      .from("profiles")
      .select("xuid")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile) return { ok: false as const, error: "Set up your gamertag first" };

    // Already logged?
    const { data: existing } = await supabase
      .from("completions")
      .select("id")
      .eq("user_id", userId)
      .eq("title_id", data.titleId)
      .maybeSingle();
    if (existing) return { ok: false as const, error: "Already logged this game" };

    // Pull achievement timestamps + verify 100% from Xbox API
    const url = `${XBL_BASE}/achievements/player/${encodeURIComponent(
      profile.xuid,
    )}/${encodeURIComponent(data.titleId)}`;
    const xblRes = await fetch(url, { headers: xblHeaders() });
    if (!xblRes.ok) return { ok: false as const, error: "Could not verify with Xbox" };
    const xblRaw = (await xblRes.json()) as {
      achievements?: Array<{
        progression?: { timeUnlocked?: string };
        progressState?: string;
        rewards?: Array<{ value?: string; type?: string }>;
      }>;
      content?: {
        achievements?: Array<{
          progression?: { timeUnlocked?: string };
          progressState?: string;
          rewards?: Array<{ value?: string; type?: string }>;
        }>;
      };
    };
    const xblJson = xblRaw.content ?? xblRaw;
    const all = xblJson.achievements ?? [];
    if (all.length === 0) return { ok: false as const, error: "No achievements found for this title" };
    const achieved = all.filter((a) => a.progressState?.toLowerCase() === "achieved");
    if (achieved.length !== all.length) {
      return { ok: false as const, error: "Game is not 100% completed yet" };
    }
    const unlocks = achieved
      .map((a) => new Date(a.progression?.timeUnlocked ?? ""))
      .filter((d) => !isNaN(d.getTime()) && d.getFullYear() > 1970)
      .sort((a, b) => a.getTime() - b.getTime());
    if (unlocks.length === 0) return { ok: false as const, error: "Missing achievement timestamps" };
    const earliest = unlocks[0];
    const latest = unlocks[unlocks.length - 1];
    const realWorldSpanHours = (latest.getTime() - earliest.getTime()) / 36e5;
    const totalGs = all.reduce((sum, a) => {
      const gs = a.rewards?.find((r) => r.type === "Gamerscore")?.value;
      return sum + (gs ? parseInt(gs, 10) || 0 : 0);
    }, 0);

    // --- Anti-cheat ---
    const flags: string[] = [];

    // 1. Achievement window: claimed hours cannot exceed (real-world span + 24h grace).
    //    A 30-min game can't legitimately be claimed at 40 hours.
    if (data.hoursPlayed > realWorldSpanHours + 24) {
      flags.push(
        `Hours (${data.hoursPlayed}) exceed achievement window (${realWorldSpanHours.toFixed(1)}h)`,
      );
    }

    // 2. Community baseline: if 3× the existing median, flag.
    const { data: stats } = await supabase
      .from("game_stats")
      .select("median_hours, submission_count")
      .eq("title_id", data.titleId)
      .maybeSingle();
    if (stats?.median_hours && stats.submission_count >= 3) {
      if (data.hoursPlayed > Number(stats.median_hours) * 3) {
        flags.push(
          `Hours far above community median (${Number(stats.median_hours).toFixed(1)}h)`,
        );
      }
    }

    // 3. Gamerscore-per-hour sanity check.
    if (totalGs > 0 && data.hoursPlayed > 0) {
      const gsPerHour = totalGs / data.hoursPlayed;
      if (gsPerHour > 500) {
        flags.push(`Implausible gamerscore-per-hour (${gsPerHour.toFixed(0)})`);
      }
    }

    const status = flags.length > 0 ? "flagged" : "approved";
    const points = pointsForHours(data.hoursPlayed);

    const { data: inserted, error: insertErr } = await supabase
      .from("completions")
      .insert({
        user_id: userId,
        title_id: data.titleId,
        game_name: data.gameName,
        game_cover_url: data.gameCoverUrl ?? null,
        total_gamerscore: totalGs,
        completed_at: latest.toISOString(),
        hours_played: data.hoursPlayed,
        points,
        status,
        flag_reason: flags.length > 0 ? flags.join("; ") : null,
      })
      .select()
      .single();
    if (insertErr) return { ok: false as const, error: insertErr.message };

    return { ok: true as const, completion: inserted, flagged: flags.length > 0, flags };
  });

// Delete a completion.
export const deleteCompletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("completions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// Create profile after Xbox lookup (called from onboarding).
export const createProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        gamertag: z.string().min(1).max(50),
        xuid: z.string().min(1),
        gamerpic: z.string().url().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").insert({
      user_id: context.userId,
      gamertag: data.gamertag,
      xuid: data.xuid,
      gamerpic: data.gamerpic ?? null,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
