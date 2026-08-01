/**
 * Lambda entry point — cold-start data loader
 *
 * Loads the 5 official files from DemoDataBucket into memory,
 * then hands off to the demo API handler.
 *
 * @module backend/demo/lambda_handler
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ingestData, RUNTIME_SOURCE_FILES } from '@city-commander/domain';
import { createDemoApiHandler, setDemoData, type DemoDataSet } from './demo_api_handler.js';

const BUCKET = process.env['DEMO_DATA_BUCKET'] ?? '';
const REGION = process.env['BEDROCK_REGION'] ?? 'us-west-2';

const s3 = new S3Client({ region: REGION });
const files = RUNTIME_SOURCE_FILES;

async function loadFromS3(): Promise<DemoDataSet> {
  const keys = [
    { key: `data/${files.TRAFFIC}`, field: 'traffic' as const },
    { key: `data/${files.CROWD}`, field: 'crowd' as const },
    { key: `data/${files.ROAD_NETWORK}`, field: 'roadNetwork' as const },
    { key: `data/${files.SOP}`, field: 'sop' as const },
    { key: `data/${files.INCIDENTS}`, field: 'incidents' as const },
  ];

  const buffers: Record<string, Buffer> = {};
  for (const { key, field } of keys) {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const resp = await s3.send(cmd);
    if (!resp.Body) throw new Error(`Empty body for ${key}`);
    const bytes = await resp.Body.transformToByteArray();
    buffers[field] = Buffer.from(bytes);
    buffers[`${field}Timestamps`] = Buffer.alloc(0); // placeholder
  }

  const SKIP_HASH_VERIFICATION =
    process.env['DEMO_SKIP_HASH_VERIFICATION'] === 'true';

  const provider = {
    getBuffer(filename: string): Buffer | null {
      if (filename === files.TRAFFIC) return buffers.traffic;
      if (filename === files.CROWD) return buffers.crowd;
      if (filename === files.ROAD_NETWORK) return buffers.roadNetwork;
      if (filename === files.SOP) return buffers.sop;
      if (filename === files.INCIDENTS) return buffers.incidents;
      return null;
    },
  };

  const result = ingestData(provider, SKIP_HASH_VERIFICATION ? { expectedHashes: {} } : undefined);
  if (result.data_status !== 'ready') {
    throw new Error(`Data ingestion failed: ${result.stop_reason}`);
  }

  return {
    traffic: result.traffic!,
    trafficTimestamps: result.trafficTimestamps!,
    crowd: result.crowd!,
    crowdTimestamps: result.crowdTimestamps!,
    roadNetwork: result.roadNetwork!,
    sopArticles: result.sopArticles!,
    incidents: result.incidents!,
  };
}

// Singleton promise for cold-start
let dataPromise: Promise<DemoDataSet> | null = null;

function getData(): Promise<DemoDataSet> {
  if (!dataPromise) {
    dataPromise = loadFromS3()
      .then((data) => {
        setDemoData(data);
        console.log('Demo data loaded:', {
          traffic: data.traffic.length,
          crowd: data.crowd.length,
          incidents: data.incidents.length,
          sopArticles: data.sopArticles.articles.length,
        });
        return data;
      })
      .catch((e) => {
        dataPromise = null; // allow retry on next invocation
        console.error('Failed to load demo data:', e);
        throw e;
      });
  }
  return dataPromise;
}

// ─── Lambda handler ────────────────────────────────────────────────────────

const handlerFn = createDemoApiHandler();

export const handler = async (event: unknown): Promise<unknown> => {
  try {
    // Ensure data is loaded
    await getData();

    // Delegate to the API handler
    const result = await handlerFn(event as Parameters<typeof handlerFn>[0]);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Lambda error:', msg);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal error', message: msg }),
    };
  }
};
