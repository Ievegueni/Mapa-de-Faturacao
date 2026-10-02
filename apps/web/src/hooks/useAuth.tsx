import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, refreshSession, setAccessToken, setSessionExpiredHandler } from "../lib/api";
import type { Me } from "../lib/types";

type Status = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: Status;
  user: Me | null;
  login(email: string, password: string): Promise<Me>;
  logout(): Promise<void>;
  setUser(user: Me): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<Me | null>(null);

  const setUser = useCallback((u: Me) => {
    setUserState(u);
    setStatus("authenticated");
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    setStatus("anonymous");
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionExpiredHandler(clear);
    refreshSession().then((session) => {
      if (session) setUser(session.user as Me);
      else setStatus("anonymous");
    });
  }, [clear, setUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiPost<{ accessToken: string; user: Me }>("/auth/login", { email, password });
      setAccessToken(res.accessToken);
      queryClient.clear();
      setUser(res.user);
      return res.user;
    },
    [queryClient, setUser],
  );

  const logout = useCallback(async () => {
    await apiPost("/auth/logout").catch(() => undefined);
    clear();
  }, [clear]);

  const value = useMemo(() => ({ status, user, login, logout, setUser }), [status, user, login, logout, setUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
