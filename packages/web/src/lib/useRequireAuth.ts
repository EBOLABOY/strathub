"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

export function useRequireAuth(): void {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) return;

    const returnTo = pathname || "/";
    router.replace({ pathname: "/login", query: { returnTo } });
  }, [router, pathname]);
}
