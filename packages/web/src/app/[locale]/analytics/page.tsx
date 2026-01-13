import { Sidebar } from "@/components/Sidebar";

export default function AnalyticsPage() {
    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-30">
                    <h1 className="text-xl font-bold text-slate-800">Analytics</h1>
                </header>

                <div className="flex-1 overflow-y-auto p-8">
                    <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50">
                        <h2 className="text-lg font-bold text-slate-700">Coming soon</h2>
                        <p className="text-sm text-slate-400 mt-2">
                            V1 focuses on API contracts and reliability. Analytics is planned for V2.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}

