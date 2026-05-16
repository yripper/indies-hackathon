CREATE TABLE "image_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"bytes" integer NOT NULL,
	"mimetype" text NOT NULL,
	"source" text NOT NULL,
	"from_name" text,
	"detector" text NOT NULL,
	"tier" text NOT NULL,
	"score" real NOT NULL,
	"raw_status" text NOT NULL,
	"model_scores" jsonb,
	"secondary_detector" jsonb,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_analyses" ADD CONSTRAINT "image_analyses_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_analyses" ADD CONSTRAINT "image_analyses_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_analyses_conv_idx" ON "image_analyses" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "image_analyses_tier_idx" ON "image_analyses" USING btree ("tier","created_at");
