/**
 * KnowledgeBase — Bedrock Knowledge Base + S3 Data Source + OpenSearch Serverless vector store.
 *
 * §4.1, §4.2, §14.1, §14.2, TASK-066
 *
 * This Construct defines (only):
 *   - 1 AWS::Bedrock::KnowledgeBase (Type = VECTOR)
 *   - 1 AWS::Bedrock::DataSource    (Type = S3)
 *   - 1 AWS::OpenSearchServerless::Collection      (Type = VECTORSEARCH)
 *   - 1 AWS::OpenSearchServerless::Index           (knn vector index)
 *   - 2 AWS::OpenSearchServerless::SecurityPolicy  (encryption, network)
 *   - 1 AWS::OpenSearchServerless::AccessPolicy    (data)
 *
 * Together: exactly 6 resource types, exactly 7 resource instances per profile
 * (1 KB + 1 DS + 1 Coll + 1 Idx + 2 SecPol + 1 AccPol).
 *
 * The Knowledge Base ID is a deployment-time OUTPUT (`GetAtt`/ref) — it is
 * NEVER a settable input prop. All configuration names are passed via props.
 *
 * The official SOP is pre-chunked into SEVEN article files; each file is one
 * complete chunk, paired with `article_no` metadata. ChunkingStrategy = NONE
 * preserves these article boundaries (no fixed-size, no semantic, no
 * hierarchical). This decision is documented in JSDoc; the actual upload and
 * ingestion are out of scope (TASK-178).
 *
 * ─── Role ownership (release-blocking pre-deploy boundary) ─────────────────
 *
 * This task names, accepts, and never conflates THREE distinct principals:
 *
 *   A. Knowledge Base SERVICE ROLE (the role wired into
 *      AWS::Bedrock::KnowledgeBase.RoleArn):
 *      - assumed by `bedrock.amazonaws.com`
 *      - used by the Bedrock service to read S3, call the embedding model,
 *        and read/write the AOSS vector index on behalf of the KB
 *      - MUST carry the collection-scoped IAM permission
 *        `aoss:APIAccessAll` against `arn:aws:aoss:...:collection/<name>`
 *        (and similarly scoped `aoss:*` actions as required by the chosen
 *        model contract). This IAM identity policy is NOT created here.
 *      - NOT created by TASK-083. May be provisioned by an earlier task or
 *        imported via SSM. Name `knowledgeBaseServiceRoleArn` in props.
 *
 *   B. IngestionRole (StartIngestionJob / GetIngestionJob):
 *      - defined and provisioned by TASK-083 (sole owner)
 *      - attached ONLY to the TASK-178 deployment-time ingestion provider
 *      - NEVER used as `AWS::Bedrock::KnowledgeBase.RoleArn`
 *      - NEVER attached to any application runtime Lambda (no IngestionFn)
 *      - Name in this task: only referenced by JSDoc; no prop is provided.
 *
 *   C. Vector-index DEPLOYMENT PRINCIPALS (CloudFormation control plane +
 *      earlier tasks' management roles):
 *      - required to CreateIndex/DescribeIndex/UpdateIndex/DeleteIndex at
 *        AOSS data plane via this AccessPolicy
 *      - supplied as `vectorIndexDeploymentPrincipalArns`
 *      - distinct from the KB service role; do not default-swap, do not
 *        silently coerce.
 *
 * The construct exposes the typed marker `KNOWLEDGE_BASE_SERVICE_ROLE_REQUIRED`
 * so TASK-180 / TASK-167 wiring can statically assert the integration
 * contract at deploy time (no TODO, no fake ARN, no silent fallback).
 *
 * The marker MUST be `true` once the prop is set; it is set to `true` inside
 * the construct body and is the deployment-readiness contract for the KB
 * service role.
 *
 * ─── IAM boundary (release-blocking pre-deploy requirement) ───────────────
 *
 * The AOSS access policy declared here (AWS::OpenSearchServerless::AccessPolicy)
 * is an AOSS DATA-PLANE policy. It is NOT an IAM identity policy.
 *
 * Separately, the following IAM identity policies are STILL REQUIRED for the
 * stack to function and are NOT created by this task (release-blockers for
 * TASK-167 / TASK-180):
 *   - Knowledge Base service role: an IAM identity policy granting
 *     `aoss:APIAccessAll` against
 *     `arn:<partition>:aoss:<region>:<account>:collection/<collectionName>`,
 *     plus any `aoss:*` actions required by the chosen embedding model.
 *     This is what connects the role (A) above to the AOSS data plane.
 *   - CloudFormation deployment role: the control-plane IAM permissions
 *     required to create, update, and delete AOSS resources
 *     (`aoss:CreateCollection`, `aoss:DeleteCollection`, `aoss:PutAccessPolicy`,
 *     `aoss:PutSecurityPolicy`, `aoss:CreateIndex`, `aoss:DeleteIndex`,
 *     etc.). The deployment principals in rule B above satisfy the
 *     DATA-plane half; the IAM identity policy on the deployment role
 *     supplies the CONTROL-plane half.
 *   - Bedrock service role also needs `bedrock:InvokeModel` for the chosen
 *     embedding model and `s3:GetObject` on the SOP source bucket.
 *
 * TASK-066 documents the boundary; it does NOT create any
 * `AWS::IAM::Role` or `AWS::IAM::Policy`.
 *
 * ─── AOSS access policy — exact rules ──────────────────────────────────────
 *
 * Exactly TWO data-access rules, scoped to the index ARN only:
 *
 *   Rule A — KB service role:
 *     ResourceType: index
 *     Resource:     index/<collectionName>/<vectorIndexName>
 *     Permission:   aoss:DescribeIndex, aoss:ReadDocument, aoss:WriteDocument
 *     Principal:    knowledgeBaseServiceRoleArn (single ARN)
 *
 *   Rule B — vector-index deployment principals:
 *     ResourceType: index
 *     Resource:     index/<collectionName>/<vectorIndexName>
 *     Permission:   aoss:CreateIndex, aoss:DescribeIndex,
 *                   aoss:UpdateIndex, aoss:DeleteIndex
 *     Principal:    vectorIndexDeploymentPrincipalArns (validated list)
 *
 * No collection-level rule is declared; the AWS::OpenSearchServerless::Index
 * control plane (create/update/delete) and the Bedrock runtime
 * read/write-document path can both target the index ARN directly under the
 * current AWS contract. If a future contract requires a collection-scoped
 * rule, add it here with an explicit explanation — never a wildcard.
 *
 * Forbidden in the rendered policy:
 *   - aoss:*
 *   - collection/<collectionName>/*
 *   - index/<collectionName>/*
 *   - wildcard principal (`*`)
 *   - any ReadDocument / WriteDocument on deployment principals
 *   - any CreateIndex / UpdateIndex / DeleteIndex on the KB service role
 *
 * ─── Deterministic-trust boundary (§4.1, §4.2, §14.1, §14.2) ──────────────
 *
 * - Bedrock produces LANGUAGE only; it never produces canonical numeric or
 *   boolean truth.
 * - The runtime use of this Construct is `Retrieve` (NOT `RetrieveAndGenerate`
 *   as a control path). `RetrieveAndGenerate` may appear as a non-control
 *   helper but does NOT override the deterministic Rule Engine.
 * - RendererFnRole's `Retrieve` permission is owned by TASK-078.
 *
 * ─── S3 direct-read fallback (deferred to Phase 6) ────────────────────────
 *
 * When the Knowledge Base / vector store is unavailable, `SopRetriever` is
 * expected to read SOP articles directly from S3 by `article_no` (TASK-108+).
 * This Construct only DOCUMENTS the fallback boundary; runtime fallback
 * behavior is NOT implemented here.
 *
 * LOCAL_MOCK: zero AWS resources — public readonly references are all
 * `undefined` (typed) so callers must handle the absence explicitly. No
 * fake ARN, no fake resource, no empty shell. Prop validation still runs so
 * callers see the same errors in every profile.
 *
 * Removal policy:
 *   PERSONAL_AWS_DEV  → DESTROY
 *   COMPETITION_AWS   → RETAIN  (deletionProtection enabled on Collection)
 *   LOCAL_MOCK        → zero AWS resources
 */

import { Construct } from 'constructs';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnKnowledgeBase, CfnDataSource, CfnDataSourceProps } from 'aws-cdk-lib/aws-bedrock';
import {
  CfnAccessPolicy,
  CfnCollection,
  CfnIndex,
  CfnSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchserverless';
import type { EnvironmentContext } from '../env_context.js';

// ─── Config key constants ──────────────────────────────────────────────────

/** Suggested config key for the deployed KB ID (output contract). */
export const KB_KNOWLEDGE_BASE_ID_CONFIG_KEY = 'kb.knowledge_base_id';

/** Suggested config key for the embedding model ID (e.g. `amazon.titan-embed-text-v2:0`). */
export const KB_EMBEDDING_MODEL_ID_CONFIG_KEY = 'kb.embedding_model_id';

/** Suggested config key for the S3 bucket holding the pre-chunked SOP articles. */
export const KB_DATA_SOURCE_BUCKET_CONFIG_KEY = 'kb.data_source_bucket';

// ─── Integration markers (typed deployment-readiness contract) ─────────────

/**
 * Typed deployment-readiness marker. TASK-180 / TASK-167 wiring layers
 * inspect this to assert that the KB service role integration contract is
 * satisfied before deploy. There is no fallback value.
 *
 * Once the construct body accepts a `knowledgeBaseServiceRoleArn` prop and
 * uses it as `AWS::Bedrock::KnowledgeBase.RoleArn` AND as the sole
 * `Principal` of Rule A in the AOSS access policy, this constant is `true`.
 */
export const KNOWLEDGE_BASE_SERVICE_ROLE_REQUIRED: true = true;

// ─── Props ──────────────────────────────────────────────────────────────────

export interface KnowledgeBaseConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /** ARN of the S3 bucket holding pre-chunked SOP article files. */
  readonly sopSourceBucketArn: string;

  /** Knowledge Base name (used for `AWS::Bedrock::KnowledgeBase.Name`). */
  readonly knowledgeBaseName: string;

  /** Data Source name (used for `AWS::Bedrock::DataSource.Name`). */
  readonly dataSourceName: string;

  /**
   * Knowledge Base SERVICE ROLE ARN — wired into
   * `AWS::Bedrock::KnowledgeBase.RoleArn`. Assumed by `bedrock.amazonaws.com`.
   * This is NOT the TASK-083 IngestionRole. It is NOT the CloudFormation
   * deployment role. The IAM identity policy granting `aoss:APIAccessAll`
   * against `collection/<collectionName>` MUST be attached to this role
   * BEFORE deployment; TASK-066 does not create it.
   */
  readonly knowledgeBaseServiceRoleArn: string;

  /** Foundation-model ID for embeddings (e.g. `amazon.titan-embed-text-v2:0`). */
  readonly embeddingModelId: string;

  /** OpenSearch Serverless collection name (3-28 chars, lowercase, hyphens). */
  readonly collectionName: string;

  /** Vector index name within the collection. */
  readonly vectorIndexName: string;

  /** Vector field name in the OpenSearch index mapping. */
  readonly vectorFieldName: string;

  /** Text field name in the OpenSearch index mapping. */
  readonly textFieldName: string;

  /** Metadata field name in the OpenSearch index mapping. */
  readonly metadataFieldName: string;

  /** Embedding dimension (must match the chosen model). */
  readonly embeddingDimension: number;

  /**
   * Vector-index DEPLOYMENT PRINCIPAL ARNs (CloudFormation deployment role +
   * earlier tasks' management roles). Authorized to Create/Describe/Update/
   * Delete the vector index in the AOSS data plane. Distinct from the KB
   * service role. May NOT default to the KB service role. Wildcard (`*`)
   * forbidden. Empty list forbidden. No duplicates. No empty entries.
   *
   * Forbids any ReadDocument / WriteDocument authorization — those are the
   * KB service role's exclusive data-plane rights.
   */
  readonly vectorIndexDeploymentPrincipalArns: string[];

  /**
   * Optional S3 key prefixes the Data Source should include. Restricts the
   * Data Source to a subset of objects inside the source bucket. Each
   * prefix must be non-empty, must not start with `/`, must not contain
   * `..`, `\`, or a URL scheme.
   */
  readonly inclusionPrefixes?: string[];
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateNonEmpty(value: string, field: string): void {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new Error(`${field} must not have leading or trailing whitespace`);
  }
}

function validateBedrockName(name: string, field: string): void {
  validateNonEmpty(name, field);
  if (name.length > 64) {
    throw new Error(`${field} must be 64 characters or fewer`);
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    throw new Error(
      `${field} must contain only alphanumeric characters, spaces, underscores, or hyphens`,
    );
  }
}

function validateRoleArn(arn: string, field: string): void {
  validateNonEmpty(arn, field);
  if (arn.includes('*')) {
    throw new Error(`${field} must not contain wildcard characters`);
  }
  // arn:aws:iam::...:role/... (accept any partition prefix, e.g. aws / aws-cn / aws-us-gov)
  if (!/^arn:[^:]+:iam::\d{12}:role\/.+/.test(arn)) {
    throw new Error(`${field} '${arn}' is not a valid IAM role ARN`);
  }
}

function validatePrincipalArn(arn: string, listField: string): void {
  validateNonEmpty(arn, `${listField} entry`);
  if (arn.includes('*')) {
    throw new Error(`${listField} must not contain wildcard principal '${arn}'`);
  }
  // Accept IAM role ARN or any AWS principal ARN (role / user / federated)
  if (!/^arn:[^:]+:[^:]*:[^:]*:\d{12}:.+/i.test(arn) && !/^arn:[^:]+:iam::\d{12}:(role|user)\/.+/.test(arn)) {
    throw new Error(`${listField} entry '${arn}' is not a valid AWS principal ARN`);
  }
}

function validateDeploymentPrincipalArns(arns: string[], kbRoleArn: string): void {
  if (!Array.isArray(arns) || arns.length === 0) {
    throw new Error('vectorIndexDeploymentPrincipalArns must contain at least one ARN');
  }
  const seen = new Set<string>();
  for (const a of arns) {
    validatePrincipalArn(a, 'vectorIndexDeploymentPrincipalArns');
    if (seen.has(a)) {
      throw new Error(
        `vectorIndexDeploymentPrincipalArns must not contain duplicates; duplicate '${a}'`,
      );
    }
    seen.add(a);
    if (a === kbRoleArn) {
      throw new Error(
        'vectorIndexDeploymentPrincipalArns must not silently default to the Knowledge Base service role; ' +
          'split deployment principals from the KB service role ARN (Rule A vs Rule B)',
      );
    }
  }
}

function validateEmbeddingModelId(id: string): void {
  validateNonEmpty(id, 'embeddingModelId');
  // Reject a fully-qualified foundation-model ARN — the Construct composes
  // the ARN from Stack partition + region + this short ID.
  if (id.startsWith('arn:')) {
    throw new Error(
      'embeddingModelId must be a short model identifier (e.g. amazon.titan-embed-text-v2:0); ' +
        'do not pass a fully-qualified foundation-model ARN',
    );
  }
  if (!/^[A-Za-z0-9.\-_:]+$/.test(id)) {
    throw new Error(
      `embeddingModelId '${id}' contains illegal characters; allowed: alphanumeric, dot, dash, underscore, colon`,
    );
  }
}

function validateEmbeddingDimension(dim: number): void {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`embeddingDimension must be a positive integer, got: ${dim}`);
  }
}

/** AOSS collection name: 3-28 chars, lowercase start, [a-z0-9-]. */
const AOSS_COLLECTION_RE = /^[a-z][a-z0-9-]{2,27}$/;

function validateCollectionName(name: string): void {
  validateNonEmpty(name, 'collectionName');
  if (!AOSS_COLLECTION_RE.test(name)) {
    throw new Error(
      `collectionName '${name}' is not a valid OpenSearch Serverless collection name. ` +
        'Allowed: 3-28 chars, must start with a lowercase letter, only a-z, 0-9, hyphen.',
    );
  }
}

/** Vector index name: starts lowercase letter, no leading `_`/`-`, [a-z0-9_-]. */
const VECTOR_INDEX_RE = /^[a-z][a-z0-9_-]*$/;

function validateVectorIndexName(name: string): void {
  validateNonEmpty(name, 'vectorIndexName');
  if (!VECTOR_INDEX_RE.test(name)) {
    throw new Error(
      `vectorIndexName '${name}' is not a valid OpenSearch vector index name. ` +
        'Must start with a lowercase letter and contain only a-z, 0-9, underscore, hyphen.',
    );
  }
}

function validateFieldName(name: string, field: string): void {
  validateNonEmpty(name, field);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `${field} '${name}' is not a valid field name; must start with a letter and contain only alphanumeric or underscore`,
    );
  }
}

function validateDistinctFieldNames(...names: Array<{ value: string; field: string }>): void {
  const seen = new Set<string>();
  for (const { value, field } of names) {
    if (seen.has(value)) {
      throw new Error(`field names must be distinct; duplicate '${value}' in ${field}`);
    }
    seen.add(value);
  }
}

function validateInclusionPrefixes(prefixes: string[] | undefined): void {
  if (prefixes === undefined) return;
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    throw new Error('inclusionPrefixes, when provided, must be a non-empty array');
  }
  for (const p of prefixes) {
    validateNonEmpty(p, 'inclusionPrefixes entry');
    if (p.startsWith('/')) {
      throw new Error(`inclusionPrefixes entry '${p}' must not start with '/'`);
    }
    if (p.includes('..')) {
      throw new Error(`inclusionPrefixes entry '${p}' must not contain '..'`);
    }
    if (p.includes('\\')) {
      throw new Error(`inclusionPrefixes entry '${p}' must not contain a backslash`);
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p)) {
      throw new Error(
        `inclusionPrefixes entry '${p}' must not contain a URL scheme`,
      );
    }
  }
}

// ─── KnowledgeBaseConstruct ────────────────────────────────────────────────

export class KnowledgeBaseConstruct extends Construct {
  public readonly knowledgeBase?: CfnKnowledgeBase;
  public readonly dataSource?: CfnDataSource;
  public readonly collection?: CfnCollection;
  public readonly vectorIndex?: CfnIndex;

  public readonly knowledgeBaseId?: string;
  public readonly dataSourceId?: string;
  public readonly collectionArn?: string;
  public readonly collectionEndpoint?: string;

  public constructor(scope: Construct, id: string, props: KnowledgeBaseConstructProps) {
    super(scope, id);

    const {
      envContext,
      sopSourceBucketArn,
      knowledgeBaseName,
      dataSourceName,
      knowledgeBaseServiceRoleArn,
      embeddingModelId,
      collectionName,
      vectorIndexName,
      vectorFieldName,
      textFieldName,
      metadataFieldName,
      embeddingDimension,
      vectorIndexDeploymentPrincipalArns,
      inclusionPrefixes,
    } = props;

    // ─── Cross-cutting validation (run BEFORE LOCAL_MOCK bail-out so callers
    //     see the same errors in every profile). ───────────────────────────

    validateBedrockName(knowledgeBaseName, 'knowledgeBaseName');
    validateBedrockName(dataSourceName, 'dataSourceName');
    validateRoleArn(knowledgeBaseServiceRoleArn, 'knowledgeBaseServiceRoleArn');
    validateEmbeddingModelId(embeddingModelId);
    validateEmbeddingDimension(embeddingDimension);
    validateCollectionName(collectionName);
    validateVectorIndexName(vectorIndexName);
    validateFieldName(vectorFieldName, 'vectorFieldName');
    validateFieldName(textFieldName, 'textFieldName');
    validateFieldName(metadataFieldName, 'metadataFieldName');
    validateDistinctFieldNames(
      { value: vectorFieldName, field: 'vectorFieldName' },
      { value: textFieldName, field: 'textFieldName' },
      { value: metadataFieldName, field: 'metadataFieldName' },
    );
    validateDeploymentPrincipalArns(vectorIndexDeploymentPrincipalArns, knowledgeBaseServiceRoleArn);
    validateInclusionPrefixes(inclusionPrefixes);

    if (envContext.isLocalMock) {
      // Zero AWS resources. Public readonly references stay `undefined`.
      return;
    }

    const stack = Stack.of(this);
    const partition = stack.partition;
    const region = stack.region;

    const isCompetition = envContext.isCompetition;
    const removalPolicy = isCompetition ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const indexResourceArn = `index/${collectionName}/${vectorIndexName}`;

    // ─── Security policies (encryption + network) ──────────────────────────

    const encryptionPolicy = new CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${collectionName}-enc`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{ ResourceType: 'collection', Resource: [`collection/${collectionName}`] }],
        AWSOwnedKey: true,
      }),
    });

    const networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${collectionName}-net`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              AllowFromPublic: false,
            },
          ],
        },
      ]),
    });

    // ─── Collection ─────────────────────────────────────────────────────────

    const collection = new CfnCollection(this, 'Collection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      deletionProtection: isCompetition ? 'ENABLED' : 'DISABLED',
    });
    collection.addResourceDependency(encryptionPolicy);
    collection.applyRemovalPolicy(removalPolicy);

    // ─── Data access policy (exactly TWO rules, index-scoped) ───────────────
    //
    // Rule A — KB service role (data-plane read/write on the index):
    //   resource: index/<collection>/<vector>
    //   perms:    DescribeIndex, ReadDocument, WriteDocument
    //   principal: knowledgeBaseServiceRoleArn (single)
    //
    // Rule B — vector-index deployment principals (control-plane lifecycle):
    //   resource: index/<collection>/<vector>
    //   perms:    CreateIndex, DescribeIndex, UpdateIndex, DeleteIndex
    //   principal: vectorIndexDeploymentPrincipalArns (validated)
    //
    // The AWS::OpenSearchServerless::Index lifecycle (Create/Update/Delete) and
    // the Bedrock runtime data path (Read/WriteDocument) both target the index
    // ARN under the current AWS contract. No collection-level rule is
    // declared; if a future contract requires one, add it here with an
    // explicit explanation — never a wildcard.

    const accessPolicy = new CfnAccessPolicy(this, 'AccessPolicy', {
      name: `${collectionName}-access`,
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'index',
              Resource: [indexResourceArn],
              Permission: ['aoss:DescribeIndex', 'aoss:ReadDocument', 'aoss:WriteDocument'],
            },
            {
              ResourceType: 'index',
              Resource: [indexResourceArn],
              Permission: ['aoss:CreateIndex', 'aoss:DescribeIndex', 'aoss:UpdateIndex', 'aoss:DeleteIndex'],
            },
          ],
          Principal: [knowledgeBaseServiceRoleArn, ...vectorIndexDeploymentPrincipalArns],
        },
      ]),
    });

    // ─── Vector index ───────────────────────────────────────────────────────

    const vectorIndex = new CfnIndex(this, 'VectorIndex', {
      collectionEndpoint: collection.attrCollectionEndpoint,
      indexName: vectorIndexName,
      mappings: {
        properties: {
          [vectorFieldName]: {
            type: 'knn_vector',
            dimension: embeddingDimension,
            method: {
              name: 'hnsw',
              engine: 'faiss',
              // `spaceType` is left unspecified here to keep the Construct
              // agnostic to the chosen embedding model (cosine / l2 / innerproduct).
              // TASK-180/SSM wiring may set this via props if required by the
              // foundation model contract.
            },
          },
          [textFieldName]: {
            type: 'text',
          },
          [metadataFieldName]: {
            type: 'text',
            index: false,
          },
        },
      },
      settings: {
        index: {
          knn: true,
        },
      },
    });
    vectorIndex.addResourceDependency(collection);
    vectorIndex.addResourceDependency(encryptionPolicy);
    vectorIndex.addResourceDependency(networkPolicy);
    vectorIndex.addResourceDependency(accessPolicy);
    vectorIndex.applyRemovalPolicy(removalPolicy);

    // ─── Knowledge Base ─────────────────────────────────────────────────────

    const foundationModelArn = `arn:${partition}:bedrock:${region}::foundation-model/${embeddingModelId}`;

    const knowledgeBase = new CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: knowledgeBaseName,
      roleArn: knowledgeBaseServiceRoleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: foundationModelArn,
        },
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: collection.attrArn,
          vectorIndexName,
          fieldMapping: {
            vectorField: vectorFieldName,
            textField: textFieldName,
            metadataField: metadataFieldName,
          },
        },
      },
    });
    knowledgeBase.addResourceDependency(vectorIndex);
    knowledgeBase.addResourceDependency(collection);
    knowledgeBase.addResourceDependency(encryptionPolicy);
    knowledgeBase.addResourceDependency(networkPolicy);
    knowledgeBase.addResourceDependency(accessPolicy);
    knowledgeBase.applyRemovalPolicy(removalPolicy);

    // ─── Data Source ────────────────────────────────────────────────────────

    const dataSourceProps: CfnDataSourceProps = {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: dataSourceName,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: sopSourceBucketArn,
          ...(inclusionPrefixes && inclusionPrefixes.length > 0
            ? { inclusionPrefixes }
            : {}),
        },
      },
      // ChunkingStrategy = NONE — each of the seven SOP article files is one
      // complete chunk and carries its own `article_no` metadata sidecar.
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'NONE',
        },
      },
    };

    const dataSource = new CfnDataSource(this, 'DataSource', dataSourceProps);
    dataSource.addResourceDependency(knowledgeBase);
    dataSource.applyRemovalPolicy(removalPolicy);

    // ─── Public references ──────────────────────────────────────────────────

    this.knowledgeBase = knowledgeBase;
    this.dataSource = dataSource;
    this.collection = collection;
    this.vectorIndex = vectorIndex;
    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.dataSourceId = dataSource.attrDataSourceId;
    this.collectionArn = collection.attrArn;
    this.collectionEndpoint = collection.attrCollectionEndpoint;
  }
}
