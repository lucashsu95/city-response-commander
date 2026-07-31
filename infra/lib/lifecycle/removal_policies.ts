/**
 * Data lifecycle policy contract — TASK-084
 *
 * This module is the SINGLE typed contract that describes how AWS data-layer
 * resources (S3 buckets, DynamoDB tables, Bedrock Knowledge Base, OpenSearch
 * Serverless vector store) are destroyed across the three deployment profiles.
 *
 * It does NOT:
 *   - execute any shell command
 *   - call `cdk destroy`
 *   - call any AWS SDK
 *   - create any AWS resource (no Bucket, Table, KB, AOSS collection, Custom
 *     Resource, Lambda, IAM role)
 *   - modify RemovalPolicy on any existing construct
 *   - read environment variables, hard-code account/region, or read AWS credentials
 *
 * What it does:
 *   - encodes the three-profile teardown contract as a typed, readonly object
 *   - resolves that contract from a profile string via `resolveDataLifecyclePolicy`
 *   - gates the COMPETITION teardown path with `assertDestroyAuthorized`
 *
 * Integration owner: TASK-180 (stack wiring).
 * Operator runbook owner: Phase 11.
 *
 * This module's behavior is intentionally side-effect-free. Destroying the
 * stack is performed by Phase 11 / the operator, NOT by this task. The
 * `destroyExecutedByThisTask` field is permanently `false` and the
 * `phase11Only` flag is permanently `true`.
 */

import type { EnvironmentProfile } from '../env_context.js';

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * The three deployment profiles supported by the lifecycle contract.
 * Mirrors `EnvironmentProfile` in `../env_context.ts` but is intentionally
 * a LOCAL literal here so this module does not transitively depend on the
 * CDK context resolver.
 */
export type DataLifecycleProfile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

export const DATA_LIFECYCLE_PROFILES = [
  'LOCAL_MOCK',
  'PERSONAL_AWS_DEV',
  'COMPETITION_AWS',
] as const;

/**
 * Cleanup modality for a single resource family.
 *
 * - `'cleanup-enabled'`: the resource is destroyed on stack delete (either
 *   via CloudFormation DeletionPolicy / UpdateReplacePolicy or via an AWS-
 *   managed protection being DISABLED).
 * - `'retain-guarded'`:  the resource is preserved on stack delete (either
 *   via CloudFormation RETAIN or via an AWS-managed protection being ENABLED).
 *
 * The contract uses this two-state semantic so TASK-180 / Phase 11 can
 * reason uniformly across S3, DynamoDB, Bedrock KB, Data Source, and AOSS
 * without leaking L1-specific knobs.
 */
export type CleanupModality = 'cleanup-enabled' | 'retain-guarded';

/**
 * The complete, resolved lifecycle contract for a single profile.
 *
 * `Readonly<…>` so callers cannot mutate the contract at runtime.
 */
export interface DataLifecyclePolicy {
  /** Source profile. */
  readonly profile: DataLifecycleProfile;

  /** Aggregate number of AWS resources the profile synthesizes (logical count). */
  readonly awsResources: number;

  /** CDK `RemovalPolicy` value applied to data-layer L1 resources. */
  readonly removalPolicy: 'DESTROY' | 'RETAIN';

  /** Whether S3 buckets are configured with `autoDeleteObjects: true`. */
  readonly s3AutoDeleteObjects: boolean;

  /** DynamoDB table cleanup (DeletionPolicy/UpdateReplacePolicy). */
  readonly dynamoCleanup: 'Delete' | 'Retain';

  /** S3 bucket cleanup (DeletionPolicy/UpdateReplacePolicy). */
  readonly bucketCleanup: 'Delete' | 'Retain';

  /** Knowledge Base cleanup modality. */
  readonly knowledgeBaseCleanup: CleanupModality;

  /** Data Source cleanup modality. */
  readonly dataSourceCleanup: CleanupModality;

  /** Vector store (OpenSearch Serverless collection + index) cleanup modality. */
  readonly vectorStoreCleanup: CleanupModality;

  /** AWS-managed `DeletionProtection` on AOSS Collection. */
  readonly awsDeletionProtection: 'ENABLED' | 'DISABLED';

  /** Whether organizer (host) confirmation is required before destroy. */
  readonly organizerConfirmationRequired: boolean;

  /** Whether the lifecycle contract permits `cdk destroy` for this profile. */
  readonly destroyAllowed: boolean;

  /** Whether lifecycle control is delegated exclusively to Phase 11. */
  readonly phase11Only: true;

  /** Permanently false: this task never executes the destroy itself. */
  readonly destroyExecutedByThisTask: false;

  /** Owning task for stack-level integration wiring. */
  readonly integrationOwner: 'TASK-180';

  /** Owning phase for the operator runbook that invokes `cdk destroy`. */
  readonly operatorRunbookOwner: 'Phase 11';
}

// ─── Profile matrix ─────────────────────────────────────────────────────────

const PERSONAL_AWS_DEV_POLICY: DataLifecyclePolicy = {
  profile: 'PERSONAL_AWS_DEV',
  awsResources: 9, // 3 S3 buckets + 5 DynamoDB tables + 1 AOSS Collection (+ auxiliary resources)
  removalPolicy: 'DESTROY',
  s3AutoDeleteObjects: true,
  dynamoCleanup: 'Delete',
  bucketCleanup: 'Delete',
  knowledgeBaseCleanup: 'cleanup-enabled',
  dataSourceCleanup: 'cleanup-enabled',
  vectorStoreCleanup: 'cleanup-enabled',
  awsDeletionProtection: 'DISABLED',
  organizerConfirmationRequired: false,
  destroyAllowed: true,
  phase11Only: true,
  destroyExecutedByThisTask: false,
  integrationOwner: 'TASK-180',
  operatorRunbookOwner: 'Phase 11',
} as const;

const COMPETITION_AWS_POLICY: DataLifecyclePolicy = {
  profile: 'COMPETITION_AWS',
  awsResources: 9,
  removalPolicy: 'RETAIN',
  s3AutoDeleteObjects: false,
  dynamoCleanup: 'Retain',
  bucketCleanup: 'Retain',
  knowledgeBaseCleanup: 'retain-guarded',
  dataSourceCleanup: 'retain-guarded',
  vectorStoreCleanup: 'retain-guarded',
  awsDeletionProtection: 'ENABLED',
  organizerConfirmationRequired: true,
  destroyAllowed: false,
  phase11Only: true,
  destroyExecutedByThisTask: false,
  integrationOwner: 'TASK-180',
  operatorRunbookOwner: 'Phase 11',
} as const;

const LOCAL_MOCK_POLICY: DataLifecyclePolicy = {
  profile: 'LOCAL_MOCK',
  awsResources: 0,
  removalPolicy: 'RETAIN', // value is meaningless: there are no resources to remove.
  s3AutoDeleteObjects: false,
  dynamoCleanup: 'Retain',
  bucketCleanup: 'Retain',
  knowledgeBaseCleanup: 'retain-guarded',
  dataSourceCleanup: 'retain-guarded',
  vectorStoreCleanup: 'retain-guarded',
  awsDeletionProtection: 'DISABLED',
  organizerConfirmationRequired: false,
  destroyAllowed: false,
  phase11Only: true,
  destroyExecutedByThisTask: false,
  integrationOwner: 'TASK-180',
  operatorRunbookOwner: 'Phase 11',
} as const;

const POLICY_MATRIX: Readonly<Record<DataLifecycleProfile, DataLifecyclePolicy>> = Object.freeze({
  LOCAL_MOCK: LOCAL_MOCK_POLICY,
  PERSONAL_AWS_DEV: PERSONAL_AWS_DEV_POLICY,
  COMPETITION_AWS: COMPETITION_AWS_POLICY,
});

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve the typed lifecycle contract for the given profile.
 *
 * Throws on any string that is not one of the three documented profiles.
 */
export function resolveDataLifecyclePolicy(
  profile: DataLifecycleProfile,
): DataLifecyclePolicy {
  const policy = POLICY_MATRIX[profile];
  if (!policy) {
    throw new Error(
      `Unknown DataLifecycleProfile '${String(profile)}'. ` +
        `Valid profiles: ${DATA_LIFECYCLE_PROFILES.join(', ')}`,
    );
  }
  return policy;
}

/**
 * Resolve the lifecycle contract from a raw CDK-context string.
 *
 * Accepts the same profile set as `resolveEnvironmentContext` and treats any
 * other string as a contract violation.
 */
export function resolveDataLifecyclePolicyFromContext(
  rawContextValue: string,
): DataLifecyclePolicy {
  if (typeof rawContextValue !== 'string') {
    throw new Error(
      `resolveDataLifecyclePolicyFromContext: expected a string profile, got ${typeof rawContextValue}`,
    );
  }
  if (!(DATA_LIFECYCLE_PROFILES as readonly string[]).includes(rawContextValue)) {
    throw new Error(
      `Invalid env profile: '${rawContextValue}'. ` +
        `Valid profiles: ${DATA_LIFECYCLE_PROFILES.join(', ')}`,
    );
  }
  return POLICY_MATRIX[rawContextValue as DataLifecycleProfile];
}

/**
 * Assertion that the destroy path is authorized for this profile.
 *
 * Behavior matrix:
 *
 *   LOCAL_MOCK:
 *     - ALWAYS throws. There are no AWS resources in LOCAL_MOCK; the
 *       operator must never invoke `cdk destroy` against this profile.
 *
 *   PERSONAL_AWS_DEV:
 *     - `organizerConfirmed` is ignored (no host approval required).
 *     - Returns the resolved policy when `destroyAllowed === true`.
 *
 *   COMPETITION_AWS:
 *     - `organizerConfirmed === false` → throws (host approval is mandatory).
 *     - `organizerConfirmed === true`  → returns the resolved policy.
 *
 * The function performs no I/O and constructs no AWS resource.
 */
export function assertDestroyAuthorized(
  profile: DataLifecycleProfile,
  organizerConfirmed: boolean,
): DataLifecyclePolicy {
  const policy = resolveDataLifecyclePolicy(profile);

  if (profile === 'LOCAL_MOCK') {
    throw new Error(
      'TASK-084: destroy is not permitted for LOCAL_MOCK. ' +
        'This profile synthesizes zero AWS resources and has no CloudFormation ' +
        'stack to destroy. The operator runbook (Phase 11) does not apply.',
    );
  }

  if (profile === 'COMPETITION_AWS') {
    if (!organizerConfirmed) {
      throw new Error(
        'TASK-084: COMPETITION_AWS teardown requires explicit organizer (host) ' +
          'confirmation. Pass `organizerConfirmed: true` only after the host has ' +
          'authorized destruction of the competition data set.',
      );
    }
    // Organizer confirmed. Note: even with confirmation, the contract still
    // exposes `destroyAllowed === false` because the host's confirmation is a
    // runtime gate, not a permanent policy change. The actual flip to destroy
    // is done by Phase 11 via a deliberate config / stack update.
    return policy;
  }

  // PERSONAL_AWS_DEV: organizerConfirmed is intentionally ignored.
  return policy;
}

/**
 * Bridge helper for TASK-180 wiring: derive the profile label from a
 * fully-formed `EnvironmentContext`. This helper exists purely so the
 * integration layer does not need to import `env_context` directly when
 * computing the lifecycle contract.
 */
export function lifecycleProfileFromEnvironment(
  env: { readonly profile: EnvironmentProfile },
): DataLifecycleProfile {
  return env.profile;
}
