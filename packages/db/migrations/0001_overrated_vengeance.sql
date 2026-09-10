ALTER TABLE "devices" DROP CONSTRAINT "devices_default_layout_id_layouts_id_fk";
--> statement-breakpoint
ALTER TABLE "schedule_devices" DROP CONSTRAINT "schedule_devices_schedule_id_schedules_id_fk";
--> statement-breakpoint
ALTER TABLE "schedule_devices" DROP CONSTRAINT "schedule_devices_device_id_devices_id_fk";
--> statement-breakpoint
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_layout_id_layouts_id_fk";
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "layouts" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_devices" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_devices" ADD CONSTRAINT "schedule_devices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_owner_idx" ON "devices" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "layouts_owner_idx" ON "layouts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "schedules_owner_idx" ON "schedules" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_id_owner_key" UNIQUE("id","owner_id");--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_id_owner_key" UNIQUE("id","owner_id");--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_id_owner_key" UNIQUE("id","owner_id");