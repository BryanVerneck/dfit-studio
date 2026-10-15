import type { ReactNode } from "react";
import logo from "../assets/logo.png";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <img src={logo} alt="Dfit Studio" className="mx-auto mb-10 h-20 w-auto" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </main>
  );
}
