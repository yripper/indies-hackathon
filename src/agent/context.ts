import { AsyncLocalStorage } from 'node:async_hooks';

// Per-turn context threaded from message-router → graph.invoke → agentNode /
// tool execution without showing up in the Zod tool schemas or in the
// persisted message history.
//
//  - conversationId: the WhatsApp JID (e.g. "<id>@s.whatsapp.net" or "<id>@g.us").
//    Same key the audio cache uses. The tool reads this to look up the
//    pending audio for the current conversation.
//  - ephemeralSystemNote: optional one-turn-only string appended to the static
//    system prompt INSIDE agentNode. Used to tell the LLM "there is an audio
//    pending" without persisting that fact in DB history (which would create
//    stale references on later turns) and without sending it as a second
//    SystemMessage (which MiniMax M2 rejects with "invalid message role:
//    system").
type ConversationContext = {
  conversationId: string;
  ephemeralSystemNote?: string;
  // Pre-bound sender that ships a WhatsApp message to the current
  // conversation's JID without the tool needing to know the JID. Used by
  // long-running tools (e.g. analyze_audio_deepfake) to send a progress
  // update before the slow API call, so the user doesn't sit in silence.
  sendProgress?: (text: string) => Promise<void>;
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
