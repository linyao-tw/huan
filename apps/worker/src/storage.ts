import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { WorkerEnv } from "@huan/config";
import type { MediaVariantRole } from "@huan/protocol";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * RustFS 的鍵命名空間。
 *
 * `playback` 放在 `distribution/` 而不是同名資料夾，是因為它是「這一輪派送用的暫時副本」，
 * 保留期過後就會被回收；`thumbnail/` 與 `preview/` 則長期保留給 Admin 使用。
 */
const ROLE_PREFIX: Record<MediaVariantRole, string> = {
	original: "uploads",
	thumbnail: "thumbnail",
	preview: "preview",
	playback: "distribution"
};

export class StorageError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "StorageError";
	}
}

export class ObjectTooLargeError extends StorageError {
	readonly limitBytes: number;

	constructor(limitBytes: number) {
		super(`物件超過 ${limitBytes} bytes 上限`);
		this.name = "ObjectTooLargeError";
		this.limitBytes = limitBytes;
	}
}

export interface DownloadOptions {
	/** 超過就中斷下載。用在 HTML 這種本來就該很小的素材上，避免把磁碟塞爆。 */
	maxBytes?: number;
}

export interface ObjectHead {
	sizeBytes: number;
	contentType: string | null;
}

type StorageEnv = Pick<WorkerEnv, "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY" | "S3_FORCE_PATH_STYLE">;

export class ObjectStorage {
	readonly bucket: string;
	private readonly client: S3Client;

	constructor(env: StorageEnv) {
		this.bucket = env.S3_BUCKET;
		this.client = new S3Client({
			endpoint: env.S3_ENDPOINT,
			region: env.S3_REGION,
			forcePathStyle: env.S3_FORCE_PATH_STYLE,
			credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
		});
	}

	/** 物件鍵一律由 UUID 組成，永遠不使用使用者提供的檔名。 */
	objectKeyFor(role: MediaVariantRole, extension: string): string {
		const suffix = extension.startsWith(".") ? extension : `.${extension}`;
		return `${ROLE_PREFIX[role]}/${randomUUID()}${suffix}`;
	}

	async head(key: string): Promise<ObjectHead | null> {
		try {
			const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
			return { sizeBytes: response.ContentLength ?? 0, contentType: response.ContentType ?? null };
		} catch (error) {
			if (isNotFound(error)) return null;
			throw new StorageError("讀取物件中繼資料失敗", { cause: error });
		}
	}

	/** 串流下載到磁碟。幾 GB 的影片絕不可以整包讀進記憶體。 */
	async downloadToFile(key: string, destinationPath: string, options: DownloadOptions = {}): Promise<number> {
		const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })).catch(error => {
			throw new StorageError("下載物件失敗", { cause: error });
		});

		const body = response.Body;
		if (!(body instanceof Readable)) {
			throw new StorageError("物件回應不是可讀取的串流");
		}

		let received = 0;
		const limit = options.maxBytes;
		const counter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				received += chunk.byteLength;
				if (limit !== undefined && received > limit) {
					callback(new ObjectTooLargeError(limit));
					return;
				}
				callback(null, chunk);
			}
		});

		await pipeline(body, counter, createWriteStream(destinationPath));
		return received;
	}

	/**
	 * 上傳本機檔案。
	 *
	 * 明確帶上 `ContentLength`：S3 相容端點無法對 Node 的檔案串流自行推算長度，
	 * 少了它請求會被拒絕。
	 */
	async uploadFile(key: string, filePath: string, contentType: string): Promise<number> {
		const info = await stat(filePath);
		try {
			await this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key: key,
					Body: createReadStream(filePath),
					ContentLength: info.size,
					ContentType: contentType
				})
			);
		} catch (error) {
			throw new StorageError("上傳物件失敗", { cause: error });
		}
		return info.size;
	}

	async deleteObject(key: string): Promise<void> {
		try {
			await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
		} catch (error) {
			if (isNotFound(error)) return;
			throw new StorageError("刪除物件失敗", { cause: error });
		}
	}

	destroy(): void {
		this.client.destroy();
	}
}

function isNotFound(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const named = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
	if (named.name === "NotFound" || named.name === "NoSuchKey") return true;
	return named.$metadata?.httpStatusCode === 404;
}
