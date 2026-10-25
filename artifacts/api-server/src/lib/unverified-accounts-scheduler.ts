import { processUnverifiedAccounts } from "./unverified-accounts-service";
import { logger } from "./logger";

const RUN_AT_UTC_HOUR = 3;

function getDelayUntilNextRun(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(RUN_AT_UTC_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function isSchedulerEnabled(): boolean {
  return process.env.UNVERIFIED_ACCOUNTS_CLEANUP_ENABLED !== "false";
}

export function startUnverifiedAccountsScheduler(): () => void {
  if (!isSchedulerEnabled()) {
    logger.info("Unverified accounts cleanup scheduler is disabled");
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
      await processUnverifiedAccounts();
    } catch (error) {
      logger.error({ error }, "Unverified accounts cleanup failed");
    } finally {
      scheduleNextRun();
    }
  };

  logger.info({ firstRunInMs: getDelayUntilNextRun() }, "Unverified accounts cleanup scheduler started");
  scheduleNextRun();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
