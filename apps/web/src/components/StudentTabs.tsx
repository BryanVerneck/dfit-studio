import { NavLink } from "react-router";

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold ${isActive ? "bg-linear-to-r from-brand to-violet text-white" : "text-muted hover:text-white"}`;

// The two screens a student moves between.
export function StudentTabs() {
  return (
    <nav className="mt-4 flex gap-1 rounded-xl border border-line/60 bg-surface p-1" aria-label="Seções">
      <NavLink to="/" end className={tab}>
        Aulas
      </NavLink>
      <NavLink to="/minhas-aulas" className={tab}>
        Minhas aulas
      </NavLink>
    </nav>
  );
}
