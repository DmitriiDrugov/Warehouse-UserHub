import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/operator";

import { NlQueryConsole } from "./console";

export const metadata = { title: "NL Query — UserHub" };

export default async function NlQueryPage() {
  await requireOperator();
  return (
    <>
      <PageHeader
        title="Data explorer"
        subtitle="Query operational data using natural language."
        actions={
          <span className="font-label text-label text-on-surface-variant inline-flex items-center gap-1">
            <Icon name="auto_awesome" size={14} className="text-proposal-violet" />
            Powered by AI query assistant
          </span>
        }
      />
      <NlQueryConsole />
    </>
  );
}
