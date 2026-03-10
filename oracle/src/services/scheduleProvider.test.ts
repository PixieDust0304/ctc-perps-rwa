import { describe, it, expect, vi } from "vitest";

vi.mock("../config/index.js", () => ({
  config: {
    scheduleEnabled: true,
    scheduleTimezone: "America/Chicago",
  },
}));

import { getScheduleWindow, getNextTransitionTime } from "./scheduleProvider.js";

/**
 * Helper: create a Date at the given Chicago time.
 * Uses Intl to reverse-lookup UTC for the specified CT hour.
 */
function chicagoDate(weekday: number, hour: number, minute: number = 0): Date {
  // Build a date for the appropriate day of the week
  // Start from a known Monday (2025-03-10 is a Monday)
  const baseMonday = new Date("2025-03-10T12:00:00Z");
  // weekday: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const dayOffset = weekday === 0 ? 6 : weekday - 1; // Mon=0
  const targetDate = new Date(baseMonday.getTime() + dayOffset * 24 * 60 * 60 * 1000);

  // Format to get the Chicago date parts, then build a UTC approximation
  // CDT (March) is UTC-5
  const utcHour = hour + 5; // CDT offset
  targetDate.setUTCHours(utcHour, minute, 0, 0);
  return targetDate;
}

describe("scheduleProvider", () => {
  describe("getScheduleWindow", () => {
    it("Saturday is always off-hours", () => {
      expect(getScheduleWindow(chicagoDate(6, 12, 0))).toBe("off_hours"); // Sat noon
      expect(getScheduleWindow(chicagoDate(6, 0, 0))).toBe("off_hours");  // Sat midnight
      expect(getScheduleWindow(chicagoDate(6, 23, 0))).toBe("off_hours"); // Sat 11pm
    });

    it("Sunday before 5pm CT is off-hours", () => {
      expect(getScheduleWindow(chicagoDate(0, 12, 0))).toBe("off_hours"); // Sun noon
      expect(getScheduleWindow(chicagoDate(0, 16, 59))).toBe("off_hours"); // Sun 4:59pm
    });

    it("Sunday at 5pm CT is market_hours", () => {
      expect(getScheduleWindow(chicagoDate(0, 17, 0))).toBe("market_hours"); // Sun 5pm
      expect(getScheduleWindow(chicagoDate(0, 18, 0))).toBe("market_hours"); // Sun 6pm
    });

    it("Monday through Thursday is market_hours (including 4-5pm break)", () => {
      expect(getScheduleWindow(chicagoDate(1, 9, 0))).toBe("market_hours");  // Mon 9am
      expect(getScheduleWindow(chicagoDate(1, 16, 30))).toBe("market_hours"); // Mon 4:30pm (daily break — still market_hours)
      expect(getScheduleWindow(chicagoDate(2, 3, 0))).toBe("market_hours");   // Tue 3am
      expect(getScheduleWindow(chicagoDate(3, 22, 0))).toBe("market_hours");  // Wed 10pm
      expect(getScheduleWindow(chicagoDate(4, 15, 59))).toBe("market_hours"); // Thu 3:59pm
    });

    it("Friday before 4pm CT is market_hours", () => {
      expect(getScheduleWindow(chicagoDate(5, 9, 0))).toBe("market_hours");  // Fri 9am
      expect(getScheduleWindow(chicagoDate(5, 15, 59))).toBe("market_hours"); // Fri 3:59pm
    });

    it("Friday at 4pm CT is off-hours (market close)", () => {
      expect(getScheduleWindow(chicagoDate(5, 16, 0))).toBe("off_hours"); // Fri 4pm
      expect(getScheduleWindow(chicagoDate(5, 17, 0))).toBe("off_hours"); // Fri 5pm
      expect(getScheduleWindow(chicagoDate(5, 23, 0))).toBe("off_hours"); // Fri 11pm
    });
  });

  describe("getNextTransitionTime", () => {
    it("returns close transition during market hours on Friday", () => {
      const fri9am = chicagoDate(5, 9, 0);
      const next = getNextTransitionTime(fri9am);
      expect(next.transition).toBe("close");
    });

    it("returns open transition during off-hours on Saturday", () => {
      const satNoon = chicagoDate(6, 12, 0);
      const next = getNextTransitionTime(satNoon);
      expect(next.transition).toBe("open");
    });

    it("returns close transition during market hours on Wednesday", () => {
      const wed2pm = chicagoDate(3, 14, 0);
      const next = getNextTransitionTime(wed2pm);
      expect(next.transition).toBe("close");
    });
  });
});
