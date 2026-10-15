import { Navigate, Route, Routes } from "react-router";
import { AppToaster } from "./components/AppToaster";
import { PublicOnly, RequireAuth, RequireStaff } from "./auth/guards";
import ClassDetailPage from "./pages/ClassDetailPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import StudentsPage from "./pages/StudentsPage";

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
        <Route element={<RequireStaff />}>
          <Route path="/equipe/aprovacoes" element={<ApprovalsPage />} />
          <Route path="/equipe/alunos" element={<StudentsPage />} />
          <Route path="/equipe/aulas/:id" element={<ClassDetailPage />} />
        </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
