// Direct port from voxlibris SyncIndicator.tsx

import { CheckCircle, Clock, WifiOff } from "lucide-react";

interface SyncIndicatorProps {
  isSyncing?: boolean;
  lastSyncTime?: number;
  error?: string | null;
  className?: string;
}

export function SyncIndicator({
  isSyncing = false,
  lastSyncTime,
  error,
  className = "",
}: SyncIndicatorProps) {
  if (!isSyncing && !error && !lastSyncTime) {
    return null;
  }

  const getStatusIcon = () => {
    if (error) {
      return <WifiOff className="w-4 h-4 text-destructive" />;
    }
    if (isSyncing) {
      return <Clock className="w-4 h-4 text-muted-foreground animate-pulse" />;
    }
    return <CheckCircle className="w-4 h-4 text-green-600" />;
  };

  const getStatusText = () => {
    if (error) {
      return "Ошибка синхронизации";
    }
    if (isSyncing) {
      return "Синхронизация...";
    }
    return "Сохранено";
  };

  const getTimeAgo = () => {
    if (!lastSyncTime) return "";

    const seconds = Math.floor((Date.now() - lastSyncTime) / 1000);
    if (seconds < 60) return "только что";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин. назад`;
    return `${Math.floor(seconds / 3600)} ч. назад`;
  };

  return (
    <div className={`flex items-center gap-2 text-xs text-muted-foreground transition-opacity duration-300 ${className}`}>
      {getStatusIcon()}
      <span className={error ? "text-destructive" : ""}>
        {getStatusText()}
      </span>
      {lastSyncTime && !isSyncing && !error && (
        <span className="text-xs opacity-70">
          {getTimeAgo()}
        </span>
      )}
    </div>
  );
}

export function CompactSyncIndicator({
  className = "",
  wrapperClassName = "",
  onMouseEnter,
  onMouseLeave,
  ...props
}: SyncIndicatorProps & {
  wrapperClassName?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      className={`fixed top-20 right-4 z-50 transition-opacity duration-500 ${wrapperClassName}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <SyncIndicator
        {...props}
        className={`bg-background/90 backdrop-blur-sm border rounded-md px-2 py-1 shadow-sm ${className}`}
      />
    </div>
  );
}
