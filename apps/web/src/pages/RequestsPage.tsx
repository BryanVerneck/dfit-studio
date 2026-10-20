import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { HeaderLogo } from "../components/HeaderLogo";
import { FixedRequests } from "../components/FixedRequests";
import { PendingStudents } from "../components/PendingStudents";

// Everything waiting for a staff decision: new sign-ups and students' fixed-class requests.
export default function RequestsPage() {
  const { logout } = useAuth();
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <HeaderLogo />
        <nav className="flex items-center">
          <Link to="/" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Aulas
          </Link>
          <Link to="/equipe/alunos" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Alunos
          </Link>
          <button type="button" onClick={() => void logout()} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Sair
          </button>
        </nav>
      </header>

      <h1 className="mt-6 text-2xl font-semibold">Solicitações</h1>

      <div className="mt-6">
        <PendingStudents />
      </div>
      <div className="mt-10">
        <FixedRequests />
      </div>
    </main>
  );
}
