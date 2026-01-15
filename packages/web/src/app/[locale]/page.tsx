
import { Sidebar } from "@/components/Sidebar";
import { KPICards } from "@/components/KPICards";
import { MainChart } from "@/components/MainChart";
import { TopologyMap } from "@/components/TopologyMap";
import { ActiveBotsList } from "@/components/ActiveBotsList";
import { Bell, Search } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function Dashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("dashboard");

  return (
    <div className="flex h-screen bg-page overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden min-w-0">

        {/* Header */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-30">
          <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>

          <div className="flex items-center gap-6">
            {/* Real/Sim Switch */}
            <div className="flex items-center gap-3 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("modeLabel")}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500"></div>
                <span className="ml-2 text-sm font-medium text-slate-700 peer-checked:text-teal-600">{t("modeReal")}</span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-4 text-slate-400">
              <button className="hover:text-slate-600 transition-colors"><Search className="w-5 h-5" /></button>
              <button className="hover:text-slate-600 transition-colors relative">
                <Bell className="w-5 h-5" />
                <span className="absolute top-0 right-0 w-2 h-2 bg-rose-500 rounded-full border-2 border-white"></span>
              </button>
              <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden border border-slate-300">
                {/* Avatar placeholder */}
                <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-400"></div>
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="p-8 space-y-8 pb-12">

          {/* 1. KPI Cards */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-700">{t("keyMetricsTitle")}</h2>
              <span className="text-xs text-slate-400">{t("lastUpdated", { time: t("justNow") })}</span>
            </div>
            <KPICards />
          </section>

          {/* 2. Bento Grid: Topology & Chart */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Topology (1 col) */}
            <div className="lg:col-span-1">
              <TopologyMap />
            </div>

            {/* Main Chart (2 cols) */}
            <div className="lg:col-span-2">
              <MainChart />
            </div>
          </section>

          {/* 3. Recent Activity / Status List */}
          <section className="bg-white rounded-2xl shadow-diffuse border border-slate-50 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-700">{t("activeBotsTitle")}</h3>
              <a href="/bots" className="text-sm text-teal-600 font-medium hover:text-teal-700">{t("viewAll")}</a>
            </div>

            {/* Simple Table Header */}
            <div className="grid grid-cols-5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 px-2">
              <div className="col-span-2">{t("table.botName")}</div>
              <div>{t("table.status")}</div>
              <div>{t("table.pnl24h")}</div>
              <div className="text-right">{t("table.action")}</div>
            </div>

            {/* Real Bots List */}
            <ActiveBotsList />
          </section>
        </div>
      </main>
    </div>
  );
}
