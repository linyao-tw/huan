import { CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { publicStorageEndpoint, type ServerEnv } from "@huan/config";

export interface ObjectHead {
	sizeBytes: number;
	contentType: string | null;
}

export interface StorageService {
	readonly bucket: string;
	ensureBucket(): Promise<void>;
	presignPut(objectKey: string, contentType: string, expiresInSeconds: number): Promise<string>;
	presignGet(objectKey: string, expiresInSeconds: number, downloadFilename?: string): Promise<string>;
	head(objectKey: string): Promise<ObjectHead | null>;
	put(objectKey: string, body: Uint8Array | string, contentType: string): Promise<void>;
	remove(objectKeys: readonly string[]): Promise<void>;
	destroy(): void;
}

/**
 * RustFS 走 S3 相容協定，因此直接使用 AWS SDK。
 *
 * 內部操作（HeadObject、刪除）與對外簽章使用兩個不同的 endpoint：容器內部走
 * `S3_ENDPOINT`，但簽出來的網址要交給瀏覽器與 Device，必須是他們連得到的
 * `S3_PUBLIC_ENDPOINT`。簽章涵蓋 Host 標頭，所以不能簽完再改字串。
 */
export function createStorage(env: ServerEnv): StorageService {
	const credentials = { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY };
	const internal = new S3Client({
		region: env.S3_REGION,
		endpoint: env.S3_ENDPOINT,
		forcePathStyle: env.S3_FORCE_PATH_STYLE,
		credentials
	});
	const publicEndpoint = publicStorageEndpoint(env);
	const signer =
		publicEndpoint === env.S3_ENDPOINT
			? internal
			: new S3Client({
					region: env.S3_REGION,
					endpoint: publicEndpoint,
					forcePathStyle: env.S3_FORCE_PATH_STYLE,
					credentials
				});

	return {
		bucket: env.S3_BUCKET,

		async ensureBucket() {
			try {
				await internal.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
			} catch {
				await internal.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
			}
		},

		async presignPut(objectKey, contentType, expiresInSeconds) {
			return getSignedUrl(signer, new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey, ContentType: contentType }), { expiresIn: expiresInSeconds });
		},

		async presignGet(objectKey, expiresInSeconds, downloadFilename) {
			const command = new GetObjectCommand({
				Bucket: env.S3_BUCKET,
				Key: objectKey,
				ResponseContentDisposition: downloadFilename ? `attachment; filename="${downloadFilename.replace(/["\\]/g, "")}"` : undefined
			});
			return getSignedUrl(signer, command, { expiresIn: expiresInSeconds });
		},

		async head(objectKey) {
			try {
				const result = await internal.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
				return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
			} catch {
				return null;
			}
		},

		async put(objectKey, body, contentType) {
			await internal.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey, Body: body, ContentType: contentType }));
		},

		async remove(objectKeys) {
			if (objectKeys.length === 0) return;
			await internal.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: objectKeys.map(Key => ({ Key })), Quiet: true } }));
		},

		destroy() {
			internal.destroy();
			if (signer !== internal) signer.destroy();
		}
	};
}
