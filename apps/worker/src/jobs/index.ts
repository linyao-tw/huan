import { processHtml } from "@/jobs/process-html";
import { processImage } from "@/jobs/process-image";
import { transcodeVideo } from "@/jobs/transcode-video";
import type { JobHandler } from "@/jobs/types";
import type { WorkerJobKind } from "@huan/protocol";

export const jobHandlers: Record<WorkerJobKind, JobHandler> = {
	transcode_video: transcodeVideo,
	process_image: processImage,
	process_html: processHtml
};

export type { JobContext, JobHandler } from "@/jobs/types";
