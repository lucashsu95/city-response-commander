/**
 * S3 DataSourceProvider for demo Lambda
 *
 * Reads the 5 official files from the DemoDataBucket.
 *
 * @module backend/demo/s3_data_source
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3DataSourceProvider } from './demo_ports.js';

export class S3BufferProvider implements S3DataSourceProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(bucket: string, region = 'us-west-2') {
    this.bucket = bucket;
    this.client = new S3Client({ region });
  }

  async getBufferAsync(filename: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: filename });
      const response = await this.client.send(command);
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  }

  getBuffer(filename: string): Buffer | null {
    // Synchronous call requires pre-loaded data
    // This is a shim that will be replaced by the cached version
    throw new Error('Use getBufferAsync() for S3 loading');
  }
}
