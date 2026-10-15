// The studio this app belongs to. A multi-studio version would read it from the subdomain instead.
export const STUDIO_SLUG: string = import.meta.env.VITE_STUDIO_SLUG ?? "dfit";

// Class times are shown in the studio's time zone, whatever the phone's own setting is.
export const STUDIO_TIMEZONE: string = import.meta.env.VITE_STUDIO_TIMEZONE ?? "America/Sao_Paulo";
