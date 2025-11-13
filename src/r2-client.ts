/**
 * R2 upload client using AWS S3 SDK
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

export interface R2UploadOptions {
  bucket: string;
  key: string;
  filePath: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Upload a file to Cloudflare R2 storage
 */
export async function uploadToR2(options: R2UploadOptions): Promise<void> {
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });

  // Read file into buffer
  const fileBuffer = readFileSync(options.filePath);

  console.log(`[R2] Uploading ${formatBytes(fileBuffer.length)} to ${options.key}...`);

  // Upload to R2
  await s3Client.send(
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      Body: fileBuffer,
      ContentType: 'application/xml',
    })
  );

  console.log(`[R2] ✓ Upload complete`);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
