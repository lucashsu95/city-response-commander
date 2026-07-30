/**
 * DataBuckets — Three S3 buckets for the city-response-commander application
 *
 * §4.8, §15.1, §10.0, §24, TASK-060
 *
 * Three buckets:
 *   rawBucket        — official raw data (read-only for decision path, per §4.8)
 *   sopSourceBucket — SOP KB source documents for RAG
 *   artifactBucket  — generated reports and multilingual alert artifacts
 *
 * Security defaults for all three buckets:
 *   - blockPublicAccess: BLOCK_ALL
 *   - encryption: S3_MANAGED (AES-256)
 *   - enforceSSL: true
 *   - versioning: enabled
 *
 * LOCAL_MOCK: no S3 resources are created (zero AWS resources).
 *
 * Removal policy:
 *   PERSONAL_AWS_DEV  → DESTROY + autoDeleteObjects
 *   COMPETITION_AWS  → RETAIN
 */

import { Construct } from 'constructs';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
} from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { EnvironmentContext } from '../env_context.js';

// ─── S3 key names (map to config schema s3.*) ───────────────────────────────

export const S3_KEY_RAW_BUCKET = 's3.raw_bucket';
export const S3_KEY_SOP_SOURCE_BUCKET = 's3.sop_source_bucket';
export const S3_KEY_ARTIFACT_BUCKET = 's3.artifact_bucket';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface DataBucketsProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Name for the raw data bucket.
   * Must match `s3.raw_bucket` from config schema.
   * Must be non-empty, lowercase, unique within the construct.
   */
  readonly rawBucketName: string;

  /**
   * Name for the SOP source bucket.
   * Must match `s3.sop_source_bucket` from config schema.
   * Must be non-empty, lowercase, unique within the construct.
   */
  readonly sopSourceBucketName: string;

  /**
   * Name for the artifact bucket.
   * Must match `s3.artifact_bucket` from config schema.
   * Must be non-empty, lowercase, unique within the construct.
   */
  readonly artifactBucketName: string;
}

// ─── Validation helpers ─────────────────────────────────────────────────────

/** S3 bucket name must be lowercase alphanumeric plus hyphens/periods */
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{2,}[a-z0-9]$/;

function validateBucketName(name: string, keyName: string): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error(`${keyName} must be a non-empty string`);
  }
  if (!BUCKET_NAME_RE.test(name)) {
    throw new Error(
      `${keyName} '${name}' is not a valid S3 bucket name. ` +
        'Names must be 3-63 chars, lowercase, start/end with alphanumeric, ' +
        'and contain only alphanumeric chars, hyphens, or periods.',
    );
  }
}

// ─── DataBuckets Construct ──────────────────────────────────────────────────

export class DataBuckets extends Construct {
  /** S3 Bucket for official raw data (decision path read-only) */
  public readonly rawBucket: IBucket;

  /** S3 Bucket for SOP KB source documents */
  public readonly sopSourceBucket: IBucket;

  /** S3 Bucket for generated reports and multilingual alert artifacts */
  public readonly artifactBucket: IBucket;

  public constructor(scope: Construct, id: string, props: DataBucketsProps) {
    super(scope, id);

    const { envContext, rawBucketName, sopSourceBucketName, artifactBucketName } = props;

    // Validate all three names
    validateBucketName(rawBucketName, S3_KEY_RAW_BUCKET);
    validateBucketName(sopSourceBucketName, S3_KEY_SOP_SOURCE_BUCKET);
    validateBucketName(artifactBucketName, S3_KEY_ARTIFACT_BUCKET);

    // Ensure all three names are distinct
    const names = [rawBucketName, sopSourceBucketName, artifactBucketName];
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      throw new Error(
        `Bucket names must be unique. Duplicates found: ${[...new Set(duplicates)].join(', ')}`,
      );
    }

    // LOCAL_MOCK: no S3 resources
    if (envContext.isLocalMock) {
      // Placeholder so the construct still instantiates cleanly in LOCAL_MOCK
      // without any AWS resources
      this.rawBucket = (undefined as unknown) as IBucket;
      this.sopSourceBucket = (undefined as unknown) as IBucket;
      this.artifactBucket = (undefined as unknown) as IBucket;
      return;
    }

    const removalPolicy = envContext.isCompetition
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const autoDeleteObjects = !envContext.isCompetition;

    // ── rawBucket ───────────────────────────────────────────────────────────

    const rawBucket = new Bucket(this, 'RawBucket', {
      bucketName: rawBucketName,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects,
    });
    this.rawBucket = rawBucket;

    // ── sopSourceBucket ────────────────────────────────────────────────────

    const sopSourceBucket = new Bucket(this, 'SopSourceBucket', {
      bucketName: sopSourceBucketName,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects,
    });
    this.sopSourceBucket = sopSourceBucket;

    // ── artifactBucket ─────────────────────────────────────────────────────

    const artifactBucket = new Bucket(this, 'ArtifactBucket', {
      bucketName: artifactBucketName,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects,
    });
    this.artifactBucket = artifactBucket;
  }
}
