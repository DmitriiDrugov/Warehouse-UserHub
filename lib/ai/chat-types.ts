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
  | UnsupportedResult
  | ErrorResult;

export type UserChatMessage = { id: string; role: "user"; text: string };
export type AssistantChatMessage = {
  id: string;
  role: "assistant";
  result: ChatResult;
};
export type ChatMessage = UserChatMessage | AssistantChatMessage;
