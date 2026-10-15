import { Navigate, Outlet, useLocation } from "react-router";
import { LoadingScreen } from "../components/LoadingScreen";
import { useAuth } from "./AuthContext";

// Pages that need a login. Someone with a temporary password can only reach the change-password page.
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <LoadingScreen />;
  if (state.status === "anonymous") return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (state.user.mustChangePassword && location.pathname !== "/trocar-senha") return <Navigate to="/trocar-senha" replace />;
  return <Outlet />;
}

// Login and signup pages: someone already logged in goes straight to the app.
export function PublicOnly() {
  const { state } = useAuth();
  if (state.status === "loading") return <LoadingScreen />;
  if (state.status === "authenticated") return <Navigate to={state.user.mustChangePassword ? "/trocar-senha" : "/"} replace />;
  return <Outlet />;
}
