import { rollupPendingAnalyticsDays } from "@workspace/db/analytics-rollup";
import { logger } from "./logger";

function getDelayUntilNextRun(now = new Date()): number {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(Math.floor(next.getUTCMinutes() / 15) * 15 + 15);
  return next.getTime() - now.getTime();
}

function isSchedulerEnabled(): boolean {
  return process.env.ANALYTICS_ROLLUP_ENABLED !== "false";
}

export function startAnalyticsRollupScheduler(): () => void {
  if (!isSchedulerEnabled()) {
    logger.info("Analytics rollup scheduler is disabled");
    return () => undefined;
  }

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const scheduleNextRun = (): void => {
    if (stopped) return;
    timer = setTimeout(() => void run(), getDelayUntilNextRun());
    timer.unref();
  };

  const run = async (): Promise<void> => {
    try {
      const result = await rollupPendingAnalyticsDays();
      if (result.skipped) {
        logger.debug("Analytics rollup skipped because another instance holds the lock");
      } else if (result.processedDates.length > 0 || result.retentionDeleted > 0) {
        logger.info(
          { processedDates: result.processedDates, retentionDeleted: result.retentionDeleted },
          "Analytics rollup completed",
        );
      }
    } catch (error) {
      logger.error({ error }, "Analytics rollup failed");
    } finally {
      scheduleNextRun();
    }
  };

  logger.info({ firstRunInMs: getDelayUntilNextRun() }, "Analytics rollup scheduler started");
  scheduleNextRun();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
