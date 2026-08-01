/**
 * What-if Lambda entry point — POST /what-if.
 *
 * Cold-start sequence:
 *  1. Read the 5 official files from S3 (`DEMO_DATA_BUCKET` env var).
 *  2. Verify source integrity (manifest gate) and parse into in-memory models.
 *  3. Wire the production RuleEngineWhatIfFacade, LocalSopRetriever, and
 *     ProductionBedrockInvoker.
 *  4. Return a handler compatible with API Gateway HTTP API v2.
 *
 * No background state is mutated by this Lambda; every request uses a
 * fresh deep-cloned baseline so concurrent invocations cannot interfere.
 *
 * @module backend/whatif/whatif_lambda
 */

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ingestData, RUNTIME_SOURCE_FILES } from '@city-commander/domain';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';

import { createProductionWhatIfHandler } from './production_handler.js';

const BUCKET = process.env['DEMO_DATA_BUCKET'] ?? '';
const REGION = process.env['BEDROCK_REGION'] ?? 'us-west-2';
const SKIP_HASH_VERIFICATION =
  process.env['DEMO_SKIP_HASH_VERIFICATION'] === 'true';

let cachedHandler: ((event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>) | null =
  null;

async function buildHandler(): Promise<
  (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>
> {
  const s3 = new S3Client({ region: REGION });
  const files = RUNTIME_SOURCE_FILES;

  const buffers: Record<string, Buffer> = {};
  for (const { name, key } of [
    { name: files.TRAFFIC, key: `data/${files.TRAFFIC}` },
    { name: files.CROWD, key: `data/${files.CROWD}` },
    { name: files.ROAD_NETWORK, key: `data/${files.ROAD_NETWORK}` },
    { name: files.SOP, key: `data/${files.SOP}` },
    { name: files.INCIDENTS, key: `data/${files.INCIDENTS}` },
  ]) {
    const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!resp.Body) throw new Error(`Empty body for ${key}`);
    const bytes = await resp.Body.transformToByteArray();
    buffers[name] = Buffer.from(bytes);
  }

  const provider = {
    getBuffer(officialFilename: string): Buffer | null {
      return buffers[officialFilename] ?? null;
    },
  };

  return createProductionWhatIfHandler(provider, {
    skipHashVerification: SKIP_HASH_VERIFICATION,
  });
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (cachedHandler === null) {
      cachedHandler = await buildHandler();
    }
    return await cachedHandler(event);
  } catch (err) {
    console.error('whatif_lambda_unhandled', {
      error_name: (err as { name?: string })?.name ?? 'Error',
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error_code: 'INTERNAL_ERROR',
        message: 'What-if Lambda failed to start. See CloudWatch logs.',
      }),
    };
  }
};

// Touch BedrockRuntimeClient to keep the import in the bundle so the
// production CDK IAM scope is exercised on first cold-start.
export const _bedrockClientForIam = BedrockRuntimeClient;
