// Time-tier scoring used by both client and server.
export function pointsForHours(hours: number): number {
  if (hours < 1) return 10;
  if (hours < 5) return 25;
  if (hours < 15) return 50;
  if (hours < 30) return 75;
  return 100;
}

export function tierLabel(hours: number): string {
  if (hours < 1) return "<1h · 10 pts";
  if (hours < 5) return "1–5h · 25 pts";
  if (hours < 15) return "5–15h · 50 pts";
  if (hours < 30) return "15–30h · 75 pts";
  return "30h+ · 100 pts";
}
