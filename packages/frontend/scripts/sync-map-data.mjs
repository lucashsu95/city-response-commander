/**
 * Sync Map Data Script
 *
 * Copies road_network_geometry.json from demo-data-source/ to
 * packages/frontend/public/data/ so it is served as a static asset at
 *   /data/road_network_geometry.json
 *
 * Run automatically via predev / prebuild hooks, and can be run manually:
 *   node packages/frontend/scripts/sync-map-data.mjs
 *
 * @module scripts/sync-map-data
 */

import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SOURCE_DIR = join(REPO_ROOT, 'demo-data-source');
const DEST_DIR = join(__dirname, '..', 'public', 'data');

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function syncFile(filename) {
  const src = join(SOURCE_DIR, filename);
  const dest = join(DEST_DIR, filename);

  try {
    await stat(src);
  } catch {
    console.error(`❌ Source file not found: ${src}`);
    console.error('   Copy road_network_geometry.json to demo-data-source/ first.');
    process.exit(1);
  }

  await ensureDir(DEST_DIR);
  await copyFile(src, dest);
  console.log(`✅ Synced: ${filename}`);
}

async function main() {
  console.log('📦 Syncing map data...\n');

  // List all files we want to sync
  const filesToSync = ['road_network_geometry.json'];

  for (const file of filesToSync) {
    await syncFile(file);
  }

  console.log('\n✨ Done.');
}

main().catch((err) => {
  console.error('❌ Sync failed:', err.message);
  process.exit(1);
});
