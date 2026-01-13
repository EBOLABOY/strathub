"use client";

import { redirect } from "next/navigation";

export default function SettingsPage() {
    // Redirect to accounts sub-page
    redirect("/settings/accounts");
}
