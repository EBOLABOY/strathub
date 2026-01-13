import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export async function generateMetadata(): Promise<Metadata> {
  const locale = routing.defaultLocale;
  setRequestLocale(locale);

  const t = await getTranslations("meta");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function DefaultLocaleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = routing.defaultLocale;
  setRequestLocale(locale);
  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
