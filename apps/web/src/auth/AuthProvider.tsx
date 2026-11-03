import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, refreshSession, setAccessToken, setSessionLostHandler } from "@/lib/api";

export interface Me {
  user: { id: string; name: string; email: string; avatarUrl: string | null; createdAt: string };
  organization: { id: string; name: string; slug: string };
  role: "OWNER" | "ADMIN" | "MEMBER";
}

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: Status;
  me: Me | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; organizationName: string }) => Promise<void>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setMe(null);
    setStatus("anonymous");
    qc.clear();
  }, [qc]);

  const loadMe = useCallback(async () => {
    const data = await api<Me>("/api/auth/me");
    setMe(data);
    setStatus("authenticated");
  }, []);

  // Ao abrir o app, tenta recuperar a sessão pelo cookie de refresh.
  useEffect(() => {
    setSessionLostHandler(clear);
    let cancelled = false;
    void (async () => {
      const token = await refreshSession();
      if (cancelled) return;
      if (!token) return clear();
      await loadMe().catch(clear);
    })();
    return () => {
      cancelled = true;
    };
  }, [clear, loadMe]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      async login(email, password) {
        const { accessToken } = await api<{ accessToken: string }>("/api/auth/login", {
          method: "POST",
          body: { email, password },
        });
        setAccessToken(accessToken);
        await loadMe();
      },
      async register(input) {
        const { accessToken } = await api<{ accessToken: string }>("/api/auth/register", { method: "POST", body: input });
        setAccessToken(accessToken);
        await loadMe();
      },
      async logout() {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        clear();
      },
      reloadMe: loadMe,
    }),
    [status, me, loadMe, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
