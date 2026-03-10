import { config } from "../config/index.js";

export type ScheduleWindow = "market_hours" | "off_hours";

/**
 * CME Globex schedule for Gold, Silver, Crude Oil, Platinum.
 *
 * Market hours: Sunday 5:00 PM CT → Friday 4:00 PM CT
 * Daily maintenance break (Mon–Thu 4–5pm CT) is treated as market hours —
 * Autonom naturally stops data during the break, triggering frozen detection → PAUSED.
 * Weekend: Friday 4:00 PM CT → Sunday 5:00 PM CT → off_hours (CLOSED, P2P active).
 *
 * Uses Intl.DateTimeFormat with America/Chicago for automatic CDT/CST handling.
 */

const chicagoFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: config.scheduleTimezone,
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

interface ChicagoTime {
  weekday: string; // "Mon", "Tue", etc.
  hour: number;    // 0-23
  minute: number;  // 0-59
}

function getChicagoTime(now: Date): ChicagoTime {
  const parts = chicagoFormatter.formatToParts(now);
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  return { weekday, hour, minute };
}

/**
 * Determine if the current time falls within CME Globex market hours.
 *
 * Off-hours (weekend): Friday 4:00 PM CT → Sunday 5:00 PM CT
 * Everything else is market_hours (including the Mon-Thu 4-5pm daily break).
 */
export function getScheduleWindow(now?: Date): ScheduleWindow {
  if (!config.scheduleEnabled) return "market_hours";

  const { weekday, hour, minute } = getChicagoTime(now ?? new Date());
  const timeMinutes = hour * 60 + minute;

  // Saturday: always off-hours
  if (weekday === "Sat") return "off_hours";

  // Sunday: off-hours until 5:00 PM (17:00), then market_hours
  if (weekday === "Sun") {
    return timeMinutes >= 17 * 60 ? "market_hours" : "off_hours";
  }

  // Friday: market_hours until 4:00 PM (16:00), then off-hours
  if (weekday === "Fri") {
    return timeMinutes < 16 * 60 ? "market_hours" : "off_hours";
  }

  // Mon-Thu: always market_hours (daily break handled by frozen detection)
  return "market_hours";
}

/**
 * Get the next schedule transition time.
 */
export function getNextTransitionTime(now?: Date): { transition: "open" | "close"; at: Date } {
  const current = now ?? new Date();
  const window = getScheduleWindow(current);

  // Walk forward in 1-minute increments to find the next boundary
  // (max ~3 days / ~4320 iterations — fast enough)
  const probe = new Date(current.getTime());
  for (let i = 0; i < 7 * 24 * 60; i++) {
    probe.setMinutes(probe.getMinutes() + 1);
    const probeWindow = getScheduleWindow(probe);
    if (probeWindow !== window) {
      return {
        transition: probeWindow === "market_hours" ? "open" : "close",
        at: probe,
      };
    }
  }

  // Fallback — should never happen with a 7-day probe
  return { transition: "open", at: new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000) };
}
