import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { RULES_VERSION, getRulesConfig } from "@/lib/rules/config";

export const metadata = { title: "Rule configuration — UserHub" };

export default async function RulesConfigPage() {
  await requireOperator(["warehouse_admin"]);
  const cfg = getRulesConfig();

  return (
    <>
      <PageHeader
        title="Rule configuration"
        subtitle={
          <>
            Engine version{" "}
            <code className="font-data-mono">{RULES_VERSION}</code>. Read-only —
            edit <code className="font-data-mono">lib/rules/config.ts</code> and re-deploy.
          </>
        }
      />

      <Card className="mb-6">
        <h2 className="font-title text-title text-on-surface mb-3">
          Certificate requirements · {cfg.certificateRequirements.length}
        </h2>
        <DataTable>
          <thead className="bg-surface-container-low">
            <tr>
              <Th>Role</Th>
              <Th>Required certificates</Th>
            </tr>
          </thead>
          <tbody>
            {cfg.certificateRequirements.map((r) => (
              <tr key={r.roleCode}>
                <Td><code className="font-data-mono text-data-mono">{r.roleCode}</code></Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {r.requiredCertificateCodes.map((c) => (
                      <code
                        key={c}
                        className="font-data-mono text-label bg-surface-container-high text-on-surface-variant rounded px-1.5 py-0.5"
                      >
                        {c}
                      </code>
                    ))}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>

      <Card>
        <h2 className="font-title text-title text-on-surface mb-3">
          Segregation-of-duty pairs · {cfg.segregationOfDutyPairs.length}
        </h2>
        <DataTable>
          <thead className="bg-surface-container-low">
            <tr>
              <Th>Permission A</Th>
              <Th>Permission B</Th>
              <Th>Reason</Th>
            </tr>
          </thead>
          <tbody>
            {cfg.segregationOfDutyPairs.map((p, i) => (
              <tr key={i}>
                <Td><code className="font-data-mono text-data-mono">{p.a}</code></Td>
                <Td><code className="font-data-mono text-data-mono">{p.b}</code></Td>
                <Td className="text-on-surface-variant">{p.reason}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}
