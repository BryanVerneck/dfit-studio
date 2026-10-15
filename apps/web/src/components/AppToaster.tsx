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
          toast: "!rounded-xl !border !font-sans",
          default: "!border-line/60 !bg-surface !text-white",
          success: "!border-success/70 !bg-[#0b2415] !text-success",
          error: "!border-danger/70 !bg-[#2a0d12] !text-danger",
          closeButton: "!bg-surface !border-line/60 !text-white",
        },
      }}
    />
  );
}
