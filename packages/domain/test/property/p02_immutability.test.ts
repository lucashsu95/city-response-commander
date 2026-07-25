import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { ingestData, RUNTIME_SOURCE_FILES, type DataSourceProvider } from '../../src/ingestion/data_ingestion_service.js';
import { classifySegments } from '../../src/rule_engine/classification_engine.js';
import { evaluateArticle3 } from '../../src/rule_engine/article3.js';
import { propertyTest } from '../helpers/pbt-helper.js';

const dataDir = join(__dirname, '..', '..', '..', '..', '中華電信資料集');
const buffers = new Map(Object.values(RUNTIME_SOURCE_FILES).map((filename) => [filename, readFileSync(join(dataDir, filename))]));
const provider: DataSourceProvider = { getBuffer: (filename) => buffers.get(filename) ?? null };
const expectedHashes = Object.fromEntries([...buffers].map(([filename, value]) => [filename, createHash('sha256').update(value).digest('hex').toUpperCase()]));

describe('Official data read-only properties', () => {
  propertyTest(2, 'read query and decision operations leave all five ingested official sources unchanged', fc.array(fc.constantFrom('grade', 'article3', 'road', 'nearby', 'sop', 'incident'), { minLength: 0, maxLength: 30 }), (operations) => {
    const result = ingestData(provider, { expectedHashes });
    expect(result.data_status).toBe('ready');
    const officialSources = {
      traffic: result.traffic,
      crowd: result.crowd,
      roads: result.roadNetwork?.getAllSegments(),
      incidents: result.incidents,
      sop: result.sopArticles?.articles,
    };
    const before = structuredClone(officialSources);

    for (const operation of operations) {
      if (operation === 'grade') classifySegments(result.traffic!.slice(0, 5).map((record) => ({ segment_id: record.Segment_ID, saturation_score: record.Saturation_Score })));
      if (operation === 'article3') {
        const record = result.crowd!.find((item) => item.BS_ID === 'BS_MRT_BL17')!;
        evaluateArticle3({ bs_id: record.BS_ID, user_count: record.User_Count, growth_rate: record.Growth_Rate });
      }
      if (operation === 'road') result.roadNetwork!.alternativesOf(result.roadNetwork!.getAllSegments()[0].segment_id);
      if (operation === 'nearby') result.roadNetwork!.nearbyStations(result.roadNetwork!.getAllSegments()[0].segment_id);
      if (operation === 'sop') result.sopArticles!.getByArticleNo(1);
      if (operation === 'incident') result.incidents!.map((incident) => incident.event_id);
    }
    expect(officialSources).toEqual(before);
  });
});
