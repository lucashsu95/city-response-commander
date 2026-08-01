/**
 * Deterministic language-floor decision for multilingual alerts (§9, P36).
 *
 * Actual template text rendering lives in `packages/rag/src/multilingual_templates.ts`
 * (the real Bedrock-fallback path); this module only decides which languages are
 * required, which `rag`'s PublicAlertComposer delegates to.
 */

export type SupportedLanguage = 'zh' | 'en' | 'ja' | 'ko';

export function requiredAlertLanguages(
  sop6Triggered: boolean,
  bonusLanguages: boolean,
): readonly SupportedLanguage[] {
  if (!sop6Triggered) return ['zh'];
  return bonusLanguages ? ['zh', 'en', 'ja', 'ko'] : ['zh', 'en'];
}
