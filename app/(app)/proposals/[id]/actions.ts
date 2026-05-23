"use server";

import { revalidatePath } from "next/cache";

import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { ServiceError } from "@/lib/services/errors";
import { approveProposal, rejectProposal } from "@/lib/services/proposals";
import { ProposalReviewForm } from "@/lib/validation/forms";

export type ReviewState = { error?: string; ok?: true };

export async function approveProposalAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const operator = await requireOperator(["warehouse_admin"]);
  const parsed = ProposalReviewForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      approveProposal(
        tx,
        parsed.data.proposalId,
        { actor: operator, reason: parsed.data.note ?? "approve via UI" },
        { note: parsed.data.note },
      ),
    );
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/proposals/${parsed.data.proposalId}`);
  revalidatePath("/proposals");
  revalidatePath("/dashboard");
  revalidatePath("/warehouse-users");
  return { ok: true };
}

export async function rejectProposalAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const operator = await requireOperator(["warehouse_admin"]);
  const parsed = ProposalReviewForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      rejectProposal(tx, parsed.data.proposalId, {
        actor: operator,
        reason: parsed.data.note ?? "reject via UI",
      }, { note: parsed.data.note }),
    );
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/proposals/${parsed.data.proposalId}`);
  revalidatePath("/proposals");
  return { ok: true };
}
