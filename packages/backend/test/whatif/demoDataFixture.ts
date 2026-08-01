/**
 * Test fixture: in-memory DataSourceProvider backed by the project's
 * `demo-data-source/` files. Used by the production facade tests to
 * exercise the real ingestion + Rule Engine pipeline against the
 * canonical demo baseline.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DataSourceProvider } from '@city-commander/domain';
import { RUNTIME_SOURCE_FILES } from '@city-commander/domain';

const FILES: Record<string, string> = {
  [RUNTIME_SOURCE_FILES.TRAFFIC]: 'city_traffic_flow.csv',
  [RUNTIME_SOURCE_FILES.CROWD]: 'signaling_crowd_density.csv',
  [RUNTIME_SOURCE_FILES.ROAD_NETWORK]: 'road_network_geometry.json',
  [RUNTIME_SOURCE_FILES.SOP]: 'emergency_traffic_sop.txt',
  [RUNTIME_SOURCE_FILES.INCIDENTS]: 'live_incidents.json',
};

/**
 * Locate the demo-data-source directory by walking upward from the test file's
 * compile-time folder. In source mode this resolves to `<root>/demo-data-source`.
 */
function locateDataDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../../../demo-data-source'),
    path.resolve(__dirname, '../../../demo-data-source'),
    path.resolve(__dirname, '../../demo-data-source'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'emergency_traffic_sop.txt'))) return c;
  }
  throw new Error(
    `[demoDataFixture] demo-data-source not found in: ${candidates.join(', ')}`,
  );
}

export function buildDemoDataProvider(): DataSourceProvider {
  const dataDir = locateDataDir();
  const buffers: Record<string, Buffer> = {};
  for (const [officialName, fileName] of Object.entries(FILES)) {
    const fullPath = path.join(dataDir, fileName);
    buffers[officialName] = fs.readFileSync(fullPath);
  }
  return {
    getBuffer(officialFilename: string): Buffer | null {
      return buffers[officialFilename] ?? null;
    },
  };
}