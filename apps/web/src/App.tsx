import { Navigate, Route, Routes } from "react-router";
import { AppToaster } from "./components/AppToaster";
import { PublicOnly, RequireAuth } from "./auth/guards";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";

export default function App() {
  return (
    <>
      <AppToaster />
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<SignupPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
