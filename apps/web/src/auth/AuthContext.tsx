import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { STUDIO_SLUG } from "../config";
import { authedRequest, publicRequest, refreshSession, setAccessToken, type Role, type Session } from "../lib/api";

export interface Me {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  gender: string | null;
  role: Role;
  studioId: string;
  mustChangePassword: boolean;
}

type AuthState = { status: "loading" } | { status: "anonymous" } | { status: "authenticated"; user: Me };

interface AuthContextValue {
  state: AuthState;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const loadMe = useCallback(async () => {
    const user = await authedRequest<Me>("/me");
    setState({ status: "authenticated", user });
  }, []);

  // On every page load, try to continue the previous login from the refresh cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await refreshSession();
        if (!session) return void (!cancelled && setState({ status: "anonymous" }));
        const user = await authedRequest<Me>("/me");
        if (!cancelled) setState({ status: "authenticated", user });
      } catch {
        if (!cancelled) setState({ status: "anonymous" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async login(email, password) {
        const session = await publicRequest<Session>("/auth/login", "POST", { email: email.trim(), password, studioSlug: STUDIO_SLUG });
        setAccessToken(session.accessToken);
        await loadMe();
      },
      async logout() {
        try {
          await publicRequest("/auth/logout", "POST");
        } catch {
          // Even if the server cannot be reached, this device is logged out.
        }
        setAccessToken(null);
        setState({ status: "anonymous" });
      },
      async changePassword(currentPassword, newPassword) {
        const session = await authedRequest<Session>("/auth/change-password", "POST", { currentPassword, newPassword });
        setAccessToken(session.accessToken);
        await loadMe();
      },
    }),
    [state, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
