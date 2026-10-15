import { Toaster } from "sonner";

// Fixed at the top of the screen, so messages stay visible while the page scrolls.
export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      theme="dark"
      closeButton
      offset={{ top: "max(16px, env(safe-area-inset-top))" }}
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !border-line/60 !bg-surface !text-white !font-sans",
          success: "!border-success/70",
          error: "!border-danger/70",
          closeButton: "!bg-surface !border-line/60 !text-white",
        },
      }}
    />
  );
}
