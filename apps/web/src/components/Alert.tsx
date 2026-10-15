export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mb-4 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}
