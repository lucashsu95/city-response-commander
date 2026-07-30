/**
 * Environment Context — CDK context resolver for three profiles
 *
 * §23, §24, §4.13
 * No hard-coded account/region/credentials/ARNs.
 * All values sourced from CDK context or CDK_DEFAULT_* env vars.
 */

// ─── Allowed profile values ────────────────────────────────────────────────

export const ENVIRONMENT_PROFILES = ['LOCAL_MOCK', 'PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as const;
export type EnvironmentProfile = (typeof ENVIRONMENT_PROFILES)[number];

const VALID_PROFILES: readonly EnvironmentProfile[] = [...ENVIRONMENT_PROFILES];

// ─── Type definitions ───────────────────────────────────────────────────────

export interface EnvironmentContext {
  readonly profile: EnvironmentProfile;
  readonly resourcePrefix: string;
  readonly isLocalMock: boolean;
  readonly isCompetition: boolean;
  readonly account: string;
  readonly region: string;
}

// ─── Profile → resource prefix mapping ────────────────────────────────────

const PROFILE_PREFIX: Record<EnvironmentProfile, string> = {
  LOCAL_MOCK: 'local',
  PERSONAL_AWS_DEV: 'personal-dev',
  COMPETITION_AWS: 'competition',
} as const;

// ─── Context key ───────────────────────────────────────────────────────────

const ENV_CONTEXT_KEY = 'env';

/**
 * Resolve a typed EnvironmentContext from CDK app context.
 *
 * Rules:
 * - No default env; throws if missing or invalid.
 * - Account/region come from CDK_DEFAULT_* env vars.
 * - resourcePrefix is deterministic based on profile.
 * - LOCAL_MOCK: account/region are cosmetic placeholders.
 * - PERSONAL_AWS_DEV / COMPETITION_AWS: share same architecture.
 */
export function resolveEnvironmentContext(
  node: { tryGetContext: (key: string) => unknown },
): EnvironmentContext {
  const raw = node.tryGetContext(ENV_CONTEXT_KEY);

  if (raw === undefined || raw === null || raw === '') {
    throw new Error(
      `Context key '${ENV_CONTEXT_KEY}' is required. ` +
        `Provide it with: --context env=<PROFILE>\n` +
        `Valid profiles: ${VALID_PROFILES.join(', ')}`,
    );
  }

  if (typeof raw !== 'string') {
    throw new Error(
      `Context key '${ENV_CONTEXT_KEY}' must be a string, got: ${typeof raw}`,
    );
  }

  const profile = raw as EnvironmentProfile;

  if (!VALID_PROFILES.includes(profile)) {
    throw new Error(
      `Invalid env profile: '${profile}'.\n` +
        `Valid profiles: ${VALID_PROFILES.join(', ')}`,
    );
  }

  const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? '';
  const region = process.env['CDK_DEFAULT_REGION'] ?? '';

  return {
    profile,
    resourcePrefix: PROFILE_PREFIX[profile],
    isLocalMock: profile === 'LOCAL_MOCK',
    isCompetition: profile === 'COMPETITION_AWS',
    account,
    region,
  };
}
