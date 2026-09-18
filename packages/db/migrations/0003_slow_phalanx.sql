CREATE TABLE "media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_folders_id_owner_key" UNIQUE("id","owner_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "idle_mode" text DEFAULT 'brand' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "idle_image_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parent_same_owner_fk" FOREIGN KEY ("parent_id","owner_id") REFERENCES "public"."media_folders"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_folders_owner_idx" ON "media_folders" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "media_folders_parent_idx" ON "media_folders" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_folder_same_owner_fk" FOREIGN KEY ("folder_id","owner_id") REFERENCES "public"."media_folders"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_folder_idx" ON "media_assets" USING btree ("folder_id");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_id_owner_key" UNIQUE("id","owner_id");