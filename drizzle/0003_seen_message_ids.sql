CREATE TABLE IF NOT EXISTS "seen_message_ids" (
  "wa_message_id" text PRIMARY KEY,
  "jid" text NOT NULL,
  "seen_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "seen_message_ids_seen_at_idx" ON "seen_message_ids" ("seen_at");
