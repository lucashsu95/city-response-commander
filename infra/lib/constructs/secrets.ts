/**
 * SecretsManager — Secrets Manager secret placeholders for the city-response-commander application
 *
 * §4.12, §17, TASK-074
 *
 * This construct does NOT store any real secret material.
 * All secrets are either:
 *   - managed placeholders (AWS-generated via GenerateSecretString), or
 *   - imported references by name or ARN (existing secrets created out-of-band).
 *
 * No CloudFormation template will contain SecretString or SecretBinary as literal text.
 *
 * LOCAL_MOCK: zero AWS resources are created.
 *
 * Removal policy:
 *   PERSONAL_AWS_DEV  -> DESTROY
 *   COMPETITION_AWS  -> RETAIN
 *
 * IAM grants are handled by TASK-076..083 and TASK-177..179 only.
 * Stack composition is handled by TASK-180 only.
 */

import { Construct } from 'constructs';
import { Secret, ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { EnvironmentContext } from '../env_context.js';

// ─── Typed secret definition ────────────────────────────────────────────────

/**
 * A single secret definition passed into the construct via props.
 *
 * Exactly one of `name` (managed placeholder) OR `arn` (imported reference)
 * must be provided — never both, never neither.
 */
export interface SecretDefinition {
  /**
   * Logical key used to look up this secret in the exported handle map.
   * Must be unique within a single SecretsManager construct instance.
   */
  readonly secretKey: string;

  /**
   * Secret name for a managed placeholder.
   *
   * When provided:
   *   - A new AWS::SecretsManager::Secret is created.
   *   - AWS generates the secret value via GenerateSecretString.
   *   - `arn` must NOT be set.
   */
  readonly name?: string;

  /**
   * Full secret ARN to import an existing secret.
   *
   * When provided:
   *   - No new AWS::SecretsManager::Secret is created.
   *   - The secret is referenced via fromSecretArn().
   *   - `name` must NOT be set.
   */
  readonly arn?: string;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface SecretsManagerProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Explicit list of secret definitions.
   *
   * Empty array -> zero AWS resources in all profiles (including AWS environments).
   * Each entry must have either `name` (managed placeholder) or `arn` (import).
   */
  readonly secrets: readonly SecretDefinition[];
}

// ─── Validation helpers ────────────────────────────────────────────────────

/** Secrets Manager ARN shape: arn:aws:secretsmanager:<region>:<account>:secret:<path> */
const SECRET_ARN_RE = /^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+$/;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

function validateDefinitions(defs: SecretDefinition[]): void {
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();

  for (const def of defs) {
    // ── secretKey non-empty ────────────────────────────────────────────────
    if (isBlank(def.secretKey)) {
      throw new Error('Secret definition has a blank secretKey');
    }

    // ── no duplicate logical key ─────────────────────────────────────────────
    if (seenKeys.has(def.secretKey)) {
      throw new Error(`Duplicate secretKey: '${def.secretKey}'`);
    }
    seenKeys.add(def.secretKey);

    const hasName = !isBlank(def.name);
    const hasArn = !isBlank(def.arn);

    // ── must have either name or arn, not both, not neither ────────────────
    if (!hasName && !hasArn) {
      throw new Error(`Secret definition '${def.secretKey}' must have either name or arn`);
    }
    if (hasName && hasArn) {
      throw new Error(
        `Secret definition '${def.secretKey}' must not have both name and arn`,
      );
    }

    if (hasName) {
      const n = def.name!;

      // ── no duplicate name ─────────────────────────────────────────────────
      if (seenNames.has(n)) {
        throw new Error(`Duplicate secret name: '${n}'`);
      }
      seenNames.add(n);

      // ── name must be non-blank ───────────────────────────────────────────
      if (n.trim() === '') {
        throw new Error(`Secret definition '${def.secretKey}' has a blank name`);
      }
    }

    if (hasArn) {
      const a = def.arn!;

      // ── no wildcard ARN ───────────────────────────────────────────────────
      if (a.includes('*')) {
        throw new Error(`Secret definition '${def.secretKey}' has a wildcard ARN`);
      }

      // ── must match Secrets Manager ARN shape ──────────────────────────────
      if (!SECRET_ARN_RE.test(a)) {
        throw new Error(
          `Secret definition '${def.secretKey}' has a malformed ARN: '${a}'`,
        );
      }
    }
  }
}

// ─── SecretsManager Construct ───────────────────────────────────────────────

export class SecretsManager extends Construct {
  /**
   * Typed map of ISecret handles for use by IAM grant tasks
   * (TASK-076..083, TASK-177, TASK-179) and TASK-180 stack wiring.
   *
   * Key: secretKey from the props definition.
   * Value: ISecret (either Secret.fromSecretNameV2 or Secret.fromSecretArn).
   */
  public readonly secrets: ReadonlyMap<string, ISecret>;

  public constructor(scope: Construct, id: string, props: SecretsManagerProps) {
    super(scope, id);

    const { envContext, secrets: definitions } = props;

    validateDefinitions([...definitions]);

    // LOCAL_MOCK: no Secrets Manager resources
    if (envContext.isLocalMock) {
      this.secrets = new Map();
      return;
    }

    const removalPolicy = envContext.isCompetition
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const secretHandles = new Map<string, ISecret>();

    for (const def of definitions) {
      if (def.arn !== undefined) {
        // ── Imported secret by ARN ─────────────────────────────────────────
        // No new AWS::SecretsManager::Secret is created.
        // Use fromSecretPartialArn — accepts ARNs without the 6-char random suffix
        // that AWS appends to the physical name. This is a pure import; no new
        // AWS::SecretsManager::Secret resource is created beyond the L1 CfnSecret
        // reference used internally by CDK for ARN resolution.
        const imported = Secret.fromSecretPartialArn(
          this,
          `ImportedSecret_${def.secretKey}`,
          def.arn,
        );
        secretHandles.set(def.secretKey, imported);
      } else {
        // ── Managed placeholder ─────────────────────────────────────────────
        // No secretValue literal; uses GenerateSecretString so CloudFormation
        // never contains SecretString or SecretBinary plaintext.
        const managed = new Secret(this, `ManagedSecret_${def.secretKey}`, {
          secretName: def.name,
          generateSecretString: {
            secretStringTemplate: '{}',
            generateStringKey: 'generated_value',
          },
          removalPolicy,
        });
        secretHandles.set(def.secretKey, managed);
      }
    }

    this.secrets = secretHandles;
  }
}
