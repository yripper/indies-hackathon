/**
 * AsyncLocalStorage-based request context.
 *
 * Allows code deep inside a tool call (e.g. certificate sender, heatmap sender)
 * to retrieve per-request capabilities without threading them through every
 * function parameter.
 *
 * Usage:
 *   // In message router — before invoking the graph:
 *   await requestContext.run({ customerJid, sendImage }, async () => {
 *     await graph.invoke(...);
 *   });
 *
 *   // Inside a tool:
 *   const jid = getCustomerJid();
 *   const sendImage = getSendImage();
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type SendImageFn = (imageBuffer: Buffer, caption?: string) => Promise<void>;

type RequestContext = {
  customerJid: string;
  /** Send a PNG image to the current conversation's recipient.  Optional —
   *  may be absent when the WhatsApp session is not yet connected. */
  sendImage?: SendImageFn;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
};

export function getCustomerJid(): string | undefined {
  return storage.getStore()?.customerJid;
}

/** Returns the image-sender bound to the current request, or undefined. */
export function getSendImage(): SendImageFn | undefined {
  return storage.getStore()?.sendImage;
}
