import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/api";
import {
  canApproveAction,
  hasPermission,
  navVisible,
  type Permission,
  type Role,
} from "@shared/roles";

export type AuthUser = { id: string; role: Role; name: string };

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (perm: Permission) => boolean;
  canApprove: (opts: { action?: string; exceptionId?: string | null; amount?: number | null }) => boolean;
  navVisible: (href: string) => boolean;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((r) => {
        if (!cancelled) setUser(r.user as AuthUser);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (username, password) => {
        const r = await api.login(username, password);
        setUser(r.user as AuthUser);
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setUser(null);
        }
      },
      can: (perm) => (user ? hasPermission(user.role, perm) : false),
      canApprove: (opts) => (user ? canApproveAction(user.role, opts) : false),
      navVisible: (href) => (user ? navVisible(user.role, href) : false),
    }),
    [user, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
