import { AppSidebar } from "@/components/app/app-sidebar";
import { AppTopBar } from "@/components/app/app-topbar";
import { requireOperator } from "@/lib/auth/operator";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const operator = await requireOperator();
  return (
    <div className="min-h-screen flex bg-bg-page text-on-surface">
      <AppSidebar operator={operator} />
      <div className="flex-1 flex flex-col min-w-0 ml-sidebar">
        <AppTopBar operator={operator} />
        <main className="flex-1 px-gutter py-6 max-w-container-max w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
