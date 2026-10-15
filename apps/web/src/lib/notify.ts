import { toast } from "sonner";

// Success messages fade quickly; errors stay longer so they can be read.
export const notifySuccess = (message: string) => toast.success(message, { duration: 4000 });
export const notifyError = (message: string) => toast.error(message, { duration: 8000 });
