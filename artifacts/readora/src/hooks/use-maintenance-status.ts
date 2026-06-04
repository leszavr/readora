import { useQuery } from "@tanstack/react-query";

export interface MaintenanceStatus {
  enabled: boolean;
  reason: string | null;
  eta: string | null;
  message: string | null;
}

async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  const response = await fetch("/api/public/maintenance-status");
  if (!response.ok) {
    throw new Error("Failed to fetch maintenance status");
  }
  return response.json();
}

export function useMaintenanceStatus() {
  return useQuery({
    queryKey: ["maintenance-status"],
    queryFn: fetchMaintenanceStatus,
    staleTime: 1000 * 60 * 5, // 5 минут
    refetchInterval: 1000 * 60 * 2, // Обновляем каждые 2 минуты
    retry: 2,
  });
}