-- Generalize audio_analyses → media_analyses to cover image, video, document
-- and audio detection (Reality Defender uses the same endpoint for all four).
-- Hand-written instead of auto-generated to preserve existing audio rows:
-- drizzle-kit would emit DROP TABLE + CREATE TABLE on a rename, wiping data.

ALTER TABLE "audio_analyses" RENAME TO "media_analyses";
--> statement-breakpoint
ALTER TABLE "media_analyses" RENAME CONSTRAINT "audio_analyses_conversation_id_conversations_id_fk" TO "media_analyses_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "media_analyses" RENAME CONSTRAINT "audio_analyses_agent_run_id_agent_runs_id_fk" TO "media_analyses_agent_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER INDEX "audio_analyses_conv_idx" RENAME TO "media_analyses_conv_idx";
--> statement-breakpoint
ALTER INDEX "audio_analyses_tier_idx" RENAME TO "media_analyses_tier_idx";
--> statement-breakpoint
-- Backfill: every existing row is from the audio-only era. DEFAULT lets the
-- column be added NOT NULL without a separate update; we drop the default
-- right after so future inserts have to specify the type explicitly.
ALTER TABLE "media_analyses" ADD COLUMN "media_type" text DEFAULT 'audio' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_analyses" ALTER COLUMN "media_type" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "media_analyses" ADD COLUMN "file_name" text;
--> statement-breakpoint
-- duration_sec is audio/video-only. Images and documents don't have one.
ALTER TABLE "media_analyses" ALTER COLUMN "duration_sec" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX "media_analyses_type_idx" ON "media_analyses" USING btree ("media_type","created_at");
