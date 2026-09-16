import { useQuery } from "@tanstack/react-query";

export interface RegistrationStatus {
  enabled: boolean;
}

async function fetchRegistrationStatus(): Promise<RegistrationStatus> {
  const response = await fetch("/api/public/registration-status");
  if (!response.ok) {
    throw new Error("Failed to fetch registration status");
  }
  return response.json();
}

export function useRegistrationStatus(initialData?: RegistrationStatus) {
  return useQuery({
    queryKey: ["registration-status"],
    queryFn: fetchRegistrationStatus,
    initialData,
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 2,
    retry: 2,
  });
}
