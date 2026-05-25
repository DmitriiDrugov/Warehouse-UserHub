export type QueryResult = {
  type: "query";
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
  durationMs: number;
};

export type ProposalResult = {
  type: "provision";
  proposalId: string;
  explanation: string;
  documentFileName?: string;
  documentWarning?: string;
};

export type UpdateResult = {
  type: "update";
  operation: string;
  affected: Array<{ employeeId: string; fullName: string }>;
  summary: string;
};

export type AccessExplanationResult = {
  type: "access_explain";
  status: "answered" | "not_found" | "ambiguous" | "needs_name";
  question: string;
  targetAccess: string | null;
  summary: string;
  reasons: string[];
  worker?: {
    id: string;
    employeeId: string;
    fullName: string;
    status: string;
    roleCode: string;
    roleName: string;
    warehouseCode: string;
    warehouseName: string;
  };
  candidates?: Array<{
    employeeId: string;
    fullName: string;
    status: string;
    roleName: string;
    warehouseCode: string;
  }>;
  activeAccess: Array<{
    systemCode: string;
    systemName: string;
    permissionCode: string;
    permissionName: string;
    source: string;
    grantedAt: string | null;
    expiresAt: string | null;
    lastUsedAt: string | null;
  }>;
  inactiveAccess: Array<{
    systemCode: string;
    systemName: string;
    permissionCode: string;
    permissionName: string;
    source: string;
    status: string;
    grantedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  expectedRoleAccess: Array<{
    systemCode: string;
    systemName: string;
    permissionCode: string;
    permissionName: string;
  }>;
  certificates: Array<{
    certificateCode: string;
    certificateName: string;
    status: string;
    expiresAt: string | null;
    isExpired: boolean;
  }>;
  findings: Array<{
    type: string;
    severity: string;
    title: string;
  }>;
  pendingProposals: Array<{
    id: string;
    type: string;
    createdAt: string | null;
    explanation: string;
  }>;
};

export type UnsupportedResult = {
  type: "unsupported";
  message: string;
};

export type ErrorResult = {
  type: "error";
  message: string;
};

export type ChatResult =
  | QueryResult
  | ProposalResult
  | UpdateResult
  | AccessExplanationResult
  | UnsupportedResult
  | ErrorResult;

export type ChatAttachment = {
  name: string;
  size?: number;
  mimeType?: string;
  previewUrl?: string;
};

export type UserChatMessage = {
  id: string;
  role: "user";
  text: string;
  attachment?: ChatAttachment;
};
export type AssistantChatMessage = {
  id: string;
  role: "assistant";
  result: ChatResult;
};
export type ChatMessage = UserChatMessage | AssistantChatMessage;
