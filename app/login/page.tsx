import { Icon } from "@/components/ui/icon";
import { getCurrentOperator } from "@/lib/auth/operator";
import { serverEnv } from "@/lib/env";
import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Warehouse UserHub" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const operator = await getCurrentOperator();
  if (operator) redirect("/dashboard");

  const providers = serverEnv().OAUTH_PROVIDERS;

  return (
    <main className="min-h-screen bg-bg-page flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="bg-surface-container-lowest border border-border-subtle rounded p-8 shadow-sm">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded bg-primary-fixed text-primary flex items-center justify-center mb-4">
              <Icon name="inventory_2" size={24} fill />
            </div>
            <h1 className="font-display text-display text-on-surface text-center">
              Warehouse UserHub
            </h1>
            <p className="font-body-sm text-body-sm text-status-neutral text-center mt-1">
              Operator Authentication
            </p>
          </div>

          <LoginForm next={next} oauthProviders={providers} initialError={error} />
        </div>
        <p className="font-label text-label text-on-surface-variant text-center mt-4">
          Internal tool · sign-up handled by warehouse admins
        </p>
      </div>
    </main>
  );
}
