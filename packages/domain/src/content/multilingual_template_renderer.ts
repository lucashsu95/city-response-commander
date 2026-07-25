/** Approved deterministic multilingual fallback used when Bedrock is unavailable. */

export type SupportedLanguage = 'zh' | 'en' | 'ja' | 'ko';

export interface MultilingualTemplateFacts {
  readonly location: string;
  readonly primary_evacuation: string;
  readonly delay_minutes: number;
  readonly timestamp_display: string;
}

export interface MultilingualTemplateResult {
  readonly languages: readonly SupportedLanguage[];
  readonly text: Readonly<Record<SupportedLanguage, string>>;
  readonly fallback_used: true;
}

export function requiredAlertLanguages(sop6Triggered: boolean, bonusLanguages: boolean): readonly SupportedLanguage[] {
  if (!sop6Triggered) return ['zh'];
  return bonusLanguages ? ['zh', 'en', 'ja', 'ko'] : ['zh', 'en'];
}

export function renderApprovedMultilingualFallback(
  facts: MultilingualTemplateFacts,
  sop6Triggered: boolean,
  bonusLanguages: boolean,
): MultilingualTemplateResult {
  const all: Record<SupportedLanguage, string> = {
    zh: `${facts.timestamp_display} ${facts.location}，請改道 ${facts.primary_evacuation}，延誤 ${facts.delay_minutes} 分鐘。`,
    en: `${facts.timestamp_display} Incident at ${facts.location}. Use ${facts.primary_evacuation}; delay ${facts.delay_minutes} minutes.`,
    ja: `${facts.timestamp_display} ${facts.location}で事故。${facts.primary_evacuation}へ迂回、遅延${facts.delay_minutes}分。`,
    ko: `${facts.timestamp_display} ${facts.location} 사고. ${facts.primary_evacuation} 우회, ${facts.delay_minutes}분 지연.`,
  };
  const languages = requiredAlertLanguages(sop6Triggered, bonusLanguages);
  return {
    languages,
    text: Object.fromEntries(languages.map((language) => [language, all[language]])) as Record<SupportedLanguage, string>,
    fallback_used: true,
  };
}
