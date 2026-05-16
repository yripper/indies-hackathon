import { AsyncLocalStorage } from 'node:async_hooks';

// Per-turn context threaded from message-router → graph.invoke → agentNode /
// tool execution without showing up in the Zod tool schemas or in the
// persisted message history.
//
//  - conversationId: the WhatsApp JID (e.g. "<id>@s.whatsapp.net" or "<id>@g.us").
//    Same key the image cache uses. The tool reads this to look up the
//    pending image for the current conversation.
//  - ephemeralSystemNote: optional one-turn-only string appended to the static
//    system prompt INSIDE agentNode. Used to tell the LLM "there is an image
//    pending" without persisting that fact in DB history (which would create
//    stale references on later turns) and without sending it as a second
//    SystemMessage (which MiniMax M2 rejects with "invalid message role:
//    system").
//  - sendProgress / recordImageAnalysis: pre-bound callbacks. The tool calls
//    them with logical data — conversationId/agentRunId/DB handles are baked
//    into closures by message-router so the tool stays pure.

export type ImageAnalysisRecord = {
  bytes: number;
  mimetype: string;
  source: 'direct' | 'quoted';
  fromName?: string;
  detector: string;
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  modelScores?: Array<{ name: string; status: string; score: number | null }>;
  secondaryDetector?: {
    provider: 'sightengine';
    aiGenerated: number;
    deepfake: number | null;
    generators: Record<string, number>;
    requestId: string;
    error?: string;
  } | null;
  latencyMs: number;
};

type ConversationContext = {
  conversationId: string;
  ephemeralSystemNote?: string;
  sendProgress?: (text: string) => Promise<void>;
  recordImageAnalysis?: (record: ImageAnalysisRecord) => Promise<void>;
};

const storage = new AsyncLocalStorage<ConversationContext>();

export function withConversation<T>(
  ctx: ConversationContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getCurrentConversationId(): string | null {
  return storage.getStore()?.conversationId ?? null;
}

export function getEphemeralSystemNote(): string | null {
  return storage.getStore()?.ephemeralSystemNote ?? null;
}

export function getProgressSender(): ((text: string) => Promise<void>) | null {
  return storage.getStore()?.sendProgress ?? null;
}

export function getImageAnalysisRecorder():
  | ((record: ImageAnalysisRecord) => Promise<void>)
  | null {
  return storage.getStore()?.recordImageAnalysis ?? null;
}
