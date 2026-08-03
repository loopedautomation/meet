import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

// Attachment storage: any S3-compatible backend — R2 for the hosted
// offering, MinIO/AWS for self-hosters. Uploads and downloads are proxied
// through this server rather than presigned to the bucket: the browser
// never talks to the bucket, so no bucket CORS config, no COEP/CORP
// breakage on inline images, and access control stays with channel
// membership. Unset env = attachments off, everything else unaffected.

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

let client: S3Client | null = null

export function storageConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY &&
      process.env.S3_BUCKET,
  )
}

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      // R2 wants "auto"; AWS wants a real region; MinIO doesn't care.
      region: process.env.S3_REGION ?? "auto",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
      // Path-style keeps MinIO and other self-hosted backends working.
      forcePathStyle: true,
    })
  }
  return client
}

export async function putAttachment(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function getAttachment(key: string): Promise<{
  body: ReadableStream
  contentType: string
  contentLength?: number
} | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    )
    if (!res.Body) return null
    return {
      body: res.Body.transformToWebStream(),
      contentType: res.ContentType ?? "application/octet-stream",
      contentLength: res.ContentLength,
    }
  } catch {
    return null
  }
}
