import { Link } from "react-router";
import logo from "../assets/logo.png";
import { FixedRequests } from "../components/FixedRequests";
import { PendingStudents } from "../components/PendingStudents";

// Everything waiting for a staff decision: new sign-ups and students' fixed-class requests.
export default function RequestsPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <img src={logo} alt="Dfit Studio" className="h-10 w-auto" />
        <nav className="flex items-center">
          <Link to="/equipe/alunos" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Alunos
          </Link>
          <Link to="/" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Aulas
          </Link>
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
