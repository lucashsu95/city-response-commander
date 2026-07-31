/**
 * config_helpers — ConfigProvider 共用工具函式
 *
 * 避免 bedrock_adapter、sop_retriever、sop_s3_fallback 各自複製相同的 requireString。
 *
 * @module rag/config_helpers
 */

import type { ConfigProvider } from '@city-commander/config';

/**
 * 從 ConfigProvider 取得 string 值。
 *
 * 即使外部未執行 validateConfig()，也能在 runtime 確保型別正確。
 *
 * @throws {TypeError} 當值不是 string 時
 */
export function requireString(config: ConfigProvider, key: string): string {
  const value = config.get(key);
  if (typeof value !== 'string') {
    throw new TypeError(
      `Config key "${key}" must be a string, got ${typeof value}. ` +
        'Ensure validateConfig() has been called before constructing this adapter.',
    );
  }
  return value;
}

/**
 * 從 ConfigProvider 取得 string[] 值。
 *
 * @throws {TypeError} 當值不是 string[] 時
 */
export function requireStringArray(config: ConfigProvider, key: string): readonly string[] {
  const value = config.get(key);
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new TypeError(
      `Config key "${key}" must be a string[], got ${typeof value}. ` +
        'Ensure validateConfig() has been called before constructing this adapter.',
    );
  }
  return value as readonly string[];
}
