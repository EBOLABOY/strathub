import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["zh", "en"] as const,
  defaultLocale: "zh",
  localePrefix: "as-needed",
});

export type AppLocale = (typeof routing.locales)[number];
