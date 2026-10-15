import type { ButtonHTMLAttributes } from "react";

export function Button({ loading, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className="w-full rounded-lg bg-linear-to-r from-brand to-violet px-4 py-3 text-base font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-light focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:opacity-60"
    >
      {loading ? "Aguarde…" : children}
    </button>
  );
}
