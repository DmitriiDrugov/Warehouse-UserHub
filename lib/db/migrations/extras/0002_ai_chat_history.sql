-- =====================================================================
-- 0002_ai_chat_history.sql
-- Persist AI Assistant chat history per operator.
--
-- Idempotent companion migration applied after drizzle-generated schema.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_chat_messages_user_content_check
    CHECK (
      (role = 'user' AND content IS NOT NULL AND result IS NULL)
      OR
      (role = 'assistant' AND result IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ai_chat_messages_by_operator_created_at
  ON public.ai_chat_messages (operator_id, created_at);

GRANT SELECT, INSERT, DELETE ON public.ai_chat_messages TO app_operator;

ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_chat_messages_select ON public.ai_chat_messages;
CREATE POLICY ai_chat_messages_select ON public.ai_chat_messages FOR SELECT
  USING (operator_id = public.current_operator_id());

DROP POLICY IF EXISTS ai_chat_messages_insert ON public.ai_chat_messages;
CREATE POLICY ai_chat_messages_insert ON public.ai_chat_messages FOR INSERT
  WITH CHECK (operator_id = public.current_operator_id());

DROP POLICY IF EXISTS ai_chat_messages_delete ON public.ai_chat_messages;
CREATE POLICY ai_chat_messages_delete ON public.ai_chat_messages FOR DELETE
  USING (operator_id = public.current_operator_id());
