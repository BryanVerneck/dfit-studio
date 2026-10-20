import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchPendingStudents } from "../lib/staff";
import { fetchPendingRequests } from "../lib/standing";

// The staff menu link to Solicitações, with how many sign-ups and fixed-class requests are waiting.
export function RequestsLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchPendingStudents(), fetchPendingRequests()])
      .then(([students, requests]) => alive && setCount(students.length + requests.length))
      // The badge is a convenience: if it cannot load, the link still works without it.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Link
      to="/equipe/solicitacoes"
      aria-label={count > 0 ? `Solicitações, ${count} ${count === 1 ? "pendente" : "pendentes"}` : undefined}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted hover:text-white"
    >
      Solicitações
      {count > 0 && (
        <span aria-hidden="true" className="min-w-5 rounded-full bg-linear-to-r from-brand to-violet px-1.5 text-center text-xs font-semibold leading-5 text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
