import { useAuth } from "../auth/AuthContext";
import { AuthLayout } from "../components/AuthLayout";

export default function HomePage() {
  const { state, logout } = useAuth();
  if (state.status !== "authenticated") return null;
  return (
    <AuthLayout title={`Olá, ${state.user.name.split(" ")[0]}`} subtitle="As aulas aparecerão aqui em breve.">
      <button type="button" onClick={() => void logout()} className="w-full rounded-lg border border-line px-4 py-3 text-base text-white hover:border-brand-light">
        Sair
      </button>
    </AuthLayout>
  );
}
