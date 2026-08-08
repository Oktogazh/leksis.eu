import { useTranslation } from "react-i18next";
import type { DashboardActivityDay } from "@leksis/types";

// The GitHub-style year of activity, shared by the two surfaces that have a
// year to show: a language's dashboard (versions the AppView indexed, from
// GET /languages/:tag/dashboard) and a contributor's page (records read
// straight from their PDS). It takes the aggregated series and nothing else,
// which is what lets one component serve an indexed source and an unindexed
// one without knowing which it is looking at.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The last year of activity as Monday-first weeks, oldest week first, clipped
 * at today. Sparse input — absent days count 0.
 */
function activityWeeks(activity: DashboardActivityDay[]): { date: string; count: number }[][] {
  const byDate = new Map(activity.map((day) => [day.date, day.count]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 364 * DAY_MS);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday

  const weeks: { date: string; count: number }[][] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const week: { date: string; count: number }[] = [];
    for (let i = 0; i < 7 && cursor <= today; i++) {
      const date = cursor.toISOString().slice(0, 10);
      week.push({ date, count: byDate.get(date) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Sequential fill for one activity cell: one hue, light → dark. */
function activityLevelClass(count: number): string {
  if (count === 0) return "border border-content/10 bg-surface-muted/50";
  if (count === 1) return "bg-primary/30";
  if (count <= 4) return "bg-primary/60";
  return "bg-primary";
}

/** GitHub-style per-day activity grid with a Less→More legend. */
export function ActivityGrid({ activity }: { activity: DashboardActivityDay[] }) {
  const { t } = useTranslation();
  const weeks = activityWeeks(activity);
  return (
    <div>
      {/* The grid scrolls inside its own container on narrow screens. */}
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex w-max gap-[3px]">
          {weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {week.map((day) => {
                const label = t("activityGrid.cellLabel", {
                  count: day.count,
                  date: day.date,
                });
                return (
                  <span
                    key={day.date}
                    title={label}
                    aria-label={label}
                    role="img"
                    className={`h-2.5 w-2.5 rounded-[2px] ${activityLevelClass(day.count)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 flex items-center justify-end gap-1 text-xs text-content-subtle">
        {t("activityGrid.legendLess")}
        {[0, 1, 2, 5].map((level) => (
          <span
            key={level}
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-[2px] ${activityLevelClass(level)}`}
          />
        ))}
        {t("activityGrid.legendMore")}
      </p>
    </div>
  );
}
