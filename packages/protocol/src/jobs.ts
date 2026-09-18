import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

export const WorkerJobKindSchema = z.enum(["transcode_video", "process_image", "process_html"]);
export type WorkerJobKind = z.infer<typeof WorkerJobKindSchema>;

export const WorkerJobStatusSchema = z.enum(["pending", "running", "success", "failed"]);
export type WorkerJobStatus = z.infer<typeof WorkerJobStatusSchema>;

export const WorkerJobSchema = z.object({
	id: IdSchema,
	kind: WorkerJobKindSchema,
	status: WorkerJobStatusSchema,
	assetId: IdSchema.nullable(),
	attempt: z.number().int().min(0),
	maxAttempts: z.number().int().min(1),
	error: z.string().nullable(),
	startedAt: IsoDateTimeSchema.nullable(),
	finishedAt: IsoDateTimeSchema.nullable(),
	runAfter: IsoDateTimeSchema,
	createdAt: IsoDateTimeSchema
});
export type WorkerJob = z.infer<typeof WorkerJobSchema>;
