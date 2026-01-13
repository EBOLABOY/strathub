"use client";

import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { getPathname, usePathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

function setLocaleCookie(locale: AppLocale) {
  document.cookie = `NEXT_LOCALE=${locale};path=/;SameSite=Lax`;
}

export function LocaleSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const nextLocale = e.target.value as AppLocale;
      setLocaleCookie(nextLocale);

      const nextPathname = getPathname({
        href: pathname,
        locale: nextLocale,
        forcePrefix: nextLocale !== routing.defaultLocale,
      });

      const suffix = `${window.location.search}${window.location.hash}`;
      router.replace(`${nextPathname}${suffix}`);
    },
    [pathname, router]
  );

  return (
    <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 border border-slate-100">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        {t("label")}
      </span>
      <select
        value={locale}
        onChange={handleChange}
        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500"
      >
        <option value="zh">{t("zh")}</option>
        <option value="en">{t("en")}</option>
      </select>
    </label>
  );
}
