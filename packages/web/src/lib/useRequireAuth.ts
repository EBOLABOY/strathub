"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

export function useRequireAuth(): void {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) return;

    const returnTo = encodeURIComponent(pathname || "/");
    router.replace(`/login?returnTo=${returnTo}`);
  }, [router, pathname]);
}

