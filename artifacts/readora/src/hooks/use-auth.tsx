import React, { createContext, useContext } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, getGetMeQueryKey, User } from "@workspace/api-client-react";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false, staleTime: 1000 * 60 * 5 },
  });
  const user = normalizeUser(data);

  const value: AuthContextType = {
    user: user ?? null,
    isLoading,
    // Как и в VoxLibris, UI-состояние авторизации должно опираться на
    // актуального пользователя. После успешного login/register мы кладем user
    // в query cache сразу; старый 401 из первичного /auth/me не должен держать
    // интерфейс в состоянии "не авторизован" до фонового refetch.
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
    isModerator: user?.role === "admin" || user?.role === "moderator",
    refetch: () => {
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      refetch();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function normalizeUser(data: User | { user?: User } | null | undefined): User | null {
  if (!data) return null;
  const maybeWrapped = data as { user?: User };
  if (maybeWrapped.user) return maybeWrapped.user;
  return data as User;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
