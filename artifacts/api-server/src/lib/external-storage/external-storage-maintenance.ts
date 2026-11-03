import { failStaleActiveSyncJobs } from "./sync";
import { evictExternalContentCacheIfNeeded } from "./content-cache";
import { logger } from "../logger";

// Периодическое обслуживание внешних хранилищ:
// 1) пометка зависших активных джоб синхронизации (после падения или
//    перезапуска сервера) как failed — failStaleActiveSyncJobs вызывается и из
//    API-запросов, но если вкладку с прогрессом закрыли, джоба без таймера
//    оставалась «активной» навсегда;
// 2) выселение кэша контента по бюджетам (общему и на пользователя) —
//    без этого бюджет применялся бы только при активности владельца, а
//    джоба, упавшая посреди синхронизации, оставляла бы раздувшийся кэш
//    до его следующего запуска.
const RUN_INTERVAL_MS = 5 * 60 * 1000;

export function startExternalStorageMaintenance(): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const scheduleNextRun = (): void => {
    if (stopped) return;
    timer = setTimeout(() => void run(), RUN_INTERVAL_MS);
    timer.unref();
  };

  const run = async (): Promise<void> => {
    try {
      await failStaleActiveSyncJobs();
    } catch (error) {
      logger.error({ error }, "Stale sync jobs reaper failed");
    }
    try {
      await evictExternalContentCacheIfNeeded();
    } catch (error) {
      logger.error({ error }, "External content cache eviction failed");
    } finally {
      scheduleNextRun();
    }
  };

  logger.info({ intervalMs: RUN_INTERVAL_MS }, "External storage maintenance started");
  scheduleNextRun();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
