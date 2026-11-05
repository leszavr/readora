import { processScheduledAccountDeletions } from "./account-deletion-service";
import { logger } from "./logger";

const RUN_AT_UTC_HOUR = 4;

function getDelayUntilNextRun(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(RUN_AT_UTC_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function isSchedulerEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_PURGE_ENABLED !== "false";
}

export function startAccountDeletionScheduler(): () => void {
  if (!isSchedulerEnabled()) {
    logger.info("Account deletion purge scheduler is disabled");
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
      await processScheduledAccountDeletions();
    } catch (error) {
      logger.error({ error }, "Account deletion purge failed");
    } finally {
      scheduleNextRun();
    }
  };

  logger.info({ firstRunInMs: getDelayUntilNextRun() }, "Account deletion purge scheduler started");
  scheduleNextRun();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
