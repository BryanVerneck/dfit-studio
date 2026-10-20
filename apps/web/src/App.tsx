import { Navigate, Route, Routes } from "react-router";
import { AppToaster } from "./components/AppToaster";
import { PublicOnly, RequireAuth, RequireStaff } from "./auth/guards";
import ClassDetailPage from "./pages/ClassDetailPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import MyBookingsPage from "./pages/MyBookingsPage";
import NewStudentPage from "./pages/NewStudentPage";
import RequestsPage from "./pages/RequestsPage";
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
          <Route path="/minhas-aulas" element={<MyBookingsPage />} />
          <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route element={<RequireStaff />}>
          <Route path="/equipe/solicitacoes" element={<RequestsPage />} />
          <Route path="/equipe/aprovacoes" element={<Navigate to="/equipe/solicitacoes" replace />} />
          <Route path="/equipe/pedidos" element={<Navigate to="/equipe/solicitacoes" replace />} />
          <Route path="/equipe/alunos" element={<StudentsPage />} />
          <Route path="/equipe/alunos/novo" element={<NewStudentPage />} />
          <Route path="/equipe/aulas/:id" element={<ClassDetailPage />} />
        </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
