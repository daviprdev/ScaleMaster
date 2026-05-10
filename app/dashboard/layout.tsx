import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* Fixed background effects */}
      <div className="fixed inset-0 grid-bg opacity-20 pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 w-[600px] h-[300px] bg-violet-600/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/3 right-1/4 w-[300px] h-[300px] bg-cyan-500/5 rounded-full blur-[80px]" />
      </div>

      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
