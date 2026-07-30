/**
 * TASK-066 targeted tests — KnowledgeBase Construct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 * LOCAL_MOCK produces zero resources; PERSONAL/COMPETITION use the same
 * Construct with dummy props + tokens.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  KnowledgeBaseConstruct,
  KB_KNOWLEDGE_BASE_ID_CONFIG_KEY,
  KB_EMBEDDING_MODEL_ID_CONFIG_KEY,
  KB_DATA_SOURCE_BUCKET_CONFIG_KEY,
  KNOWLEDGE_BASE_SERVICE_ROLE_REQUIRED,
} from '../lib/constructs/knowledge_base.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const KB_ROLE_ARN = 'arn:aws:iam::111111111111:role/TestKBRole';
const DEPLOY_PRINCIPAL_ARN = 'arn:aws:iam::111111111111:role/TestDeployer';

// Full props (with envContext resolved by the test)
type FullProps = {
  envContext: import('../lib/env_context.js').EnvironmentContext;
  sopSourceBucketArn: string;
  knowledgeBaseName: string;
  dataSourceName: string;
  knowledgeBaseServiceRoleArn: string;
  embeddingModelId: string;
  collectionName: string;
  vectorIndexName: string;
  vectorFieldName: string;
  textFieldName: string;
  metadataFieldName: string;
  embeddingDimension: number;
  vectorIndexDeploymentPrincipalArns: string[];
  inclusionPrefixes?: string[];
};

/** Override any subset of full props except envContext */
type PropsOverride = Partial<Omit<FullProps, 'envContext'>>;

function dummyProps(overrides: PropsOverride = {}): Omit<FullProps, 'envContext'> {
  return {
    sopSourceBucketArn: 'arn:aws:s3:::test-sop-source-bucket',
    knowledgeBaseName: 'TestKB',
    dataSourceName: 'TestDataSource',
    knowledgeBaseServiceRoleArn: KB_ROLE_ARN,
    embeddingModelId: 'amazon.titan-embed-text-v2:0',
    collectionName: 'test-kb-collection',
    vectorIndexName: 'test-vector-index',
    vectorFieldName: 'vectorField',
    textFieldName: 'textField',
    metadataFieldName: 'metadataField',
    embeddingDimension: 1024,
    vectorIndexDeploymentPrincipalArns: [DEPLOY_PRINCIPAL_ARN],
    ...overrides,
  };
}

function synthTemplate(
  profile: Profile,
  propsOverride: PropsOverride = {},
): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-kb-test`);
  const props: FullProps = {
    envContext: ctx,
    ...dummyProps(propsOverride),
  };
  new KnowledgeBaseConstruct(stack, 'KB', props);
  const assembly = app.synth();
  return assembly.stacks[0].template as Record<string, unknown>;
}

function getResources(template: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (template['Resources'] as Record<string, Record<string, unknown>>) ?? {};
}

function countResourcesByType(resources: Record<string, Record<string, unknown>>, typeName: string): number {
  return Object.values(resources).filter((r) => r['Type'] === typeName).length;
}

function countNonCdkResources(resources: Record<string, Record<string, unknown>>): number {
  return Object.values(resources).filter((r) => {
    const t = r['Type'] as string;
    return t && !t.startsWith('AWS::CDK::');
  }).length;
}

function getResourcesOfType(resources: Record<string, Record<string, unknown>>, typeName: string): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === typeName),
  );
}

function getProps(r: Record<string, unknown>): Record<string, unknown> {
  return (r['Properties'] as Record<string, unknown>) ?? {};
}

function parseAccessPolicyRules(template: Record<string, unknown>) {
  const ap = Object.values(
    getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::AccessPolicy'),
  )[0];
  return JSON.parse(getProps(ap)['Policy'] as string) as Array<{
    Rules: Array<{
      ResourceType: string;
      Resource: string[];
      Permission: string[];
    }>;
    Principal: string[];
  }>;
}

// ─── A. PERSONAL_AWS_DEV resource topology ─────────────────────────────────

describe('A. PERSONAL_AWS_DEV resource topology', () => {
  let resources: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    resources = getResources(template);
  });

  it('exactly 6 distinct resource types', () => {
    const types = new Set(Object.values(resources).map((r) => r['Type'] as string));
    expect(types.size).toBe(6);
    expect(types.has('AWS::Bedrock::KnowledgeBase')).toBe(true);
    expect(types.has('AWS::Bedrock::DataSource')).toBe(true);
    expect(types.has('AWS::OpenSearchServerless::Collection')).toBe(true);
    expect(types.has('AWS::OpenSearchServerless::Index')).toBe(true);
    expect(types.has('AWS::OpenSearchServerless::SecurityPolicy')).toBe(true);
    expect(types.has('AWS::OpenSearchServerless::AccessPolicy')).toBe(true);
  });

  it('exactly 7 resource instances (1+1+1+1+2+1)', () => {
    // 1 KB + 1 DS + 1 Collection + 1 Index + 2 SecurityPolicy + 1 AccessPolicy
    const nonCdkCount = countNonCdkResources(resources);
    expect(nonCdkCount).toBe(7);
    expect(countResourcesByType(resources, 'AWS::Bedrock::KnowledgeBase')).toBe(1);
    expect(countResourcesByType(resources, 'AWS::Bedrock::DataSource')).toBe(1);
    expect(countResourcesByType(resources, 'AWS::OpenSearchServerless::Collection')).toBe(1);
    expect(countResourcesByType(resources, 'AWS::OpenSearchServerless::Index')).toBe(1);
    expect(countResourcesByType(resources, 'AWS::OpenSearchServerless::SecurityPolicy')).toBe(2);
    expect(countResourcesByType(resources, 'AWS::OpenSearchServerless::AccessPolicy')).toBe(1);
  });

  it('exactly 0 AWS::IAM::Role', () => {
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
  });

  it('exactly 0 AWS::IAM::Policy', () => {
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
  });

  it('exactly 0 AWS::Lambda::Function', () => {
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(0);
  });

  it('exactly 0 Custom:: resources', () => {
    const customCount = Object.values(resources).filter((r) => {
      const t = r['Type'] as string;
      return t && t.startsWith('Custom::');
    }).length;
    expect(customCount).toBe(0);
  });
});

// ─── B. COMPETITION_AWS ────────────────────────────────────────────────────

describe('B. COMPETITION_AWS', () => {
  it('uses same Construct with identical resource topology', () => {
    const personalT = synthTemplate('PERSONAL_AWS_DEV');
    const competitionT = synthTemplate('COMPETITION_AWS');
    const personalRes = getResources(personalT);
    const competitionRes = getResources(competitionT);
    for (const t of [
      'AWS::Bedrock::KnowledgeBase',
      'AWS::Bedrock::DataSource',
      'AWS::OpenSearchServerless::Collection',
      'AWS::OpenSearchServerless::Index',
      'AWS::OpenSearchServerless::SecurityPolicy',
      'AWS::OpenSearchServerless::AccessPolicy',
    ]) {
      expect(countResourcesByType(competitionRes, t)).toBe(countResourcesByType(personalRes, t));
    }
  });

  it('Competition Collection has deletionProtection enabled', () => {
    const template = synthTemplate('COMPETITION_AWS');
    const collections = getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::Collection');
    const collection = Object.values(collections)[0];
    expect(getProps(collection)['DeletionProtection']).toBe('ENABLED');
  });

  it('Personal Collection has deletionProtection disabled', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const collections = getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::Collection');
    const collection = Object.values(collections)[0];
    expect(getProps(collection)['DeletionProtection']).toBe('DISABLED');
  });

  it('COMPETITION Data Source has DeletionPolicy = Retain', () => {
    const template = synthTemplate('COMPETITION_AWS');
    const dss = getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource');
    const ds = Object.values(dss)[0];
    expect(ds['DeletionPolicy']).toBe('Retain');
  });

  it('PERSONAL Data Source has DeletionPolicy = Delete', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const dss = getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource');
    const ds = Object.values(dss)[0];
    expect(ds['DeletionPolicy']).toBe('Delete');
  });
});

// ─── C. LOCAL_MOCK ─────────────────────────────────────────────────────────

describe('C. LOCAL_MOCK', () => {
  it('produces 0 AWS resources', () => {
    const template = synthTemplate('LOCAL_MOCK');
    expect(countNonCdkResources(getResources(template))).toBe(0);
  });
});

// ─── D. Knowledge Base configuration ───────────────────────────────────────

describe('D. Knowledge Base configuration', () => {
  it('Type = VECTOR', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const kb = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::KnowledgeBase'))[0];
    const cfg = getProps(kb)['KnowledgeBaseConfiguration'] as Record<string, unknown>;
    expect(cfg['Type']).toBe('VECTOR');
  });

  it('RoleArn equals props.knowledgeBaseServiceRoleArn', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const kb = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::KnowledgeBase'))[0];
    expect(getProps(kb)['RoleArn']).toBe(KB_ROLE_ARN);
  });

  it('RoleArn is NOT the TASK-083 IngestionRole (the same string never appears here)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const kb = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::KnowledgeBase'))[0];
    // The KB service role is wired to exactly one ARN: knowledgeBaseServiceRoleArn.
    // There is no `IngestionRole` prop here and the construct never produces a
    // placeholder for TASK-083; the same string never appears as a fallback.
    expect(getProps(kb)['RoleArn']).toBe(KB_ROLE_ARN);
    expect(getProps(kb)['RoleArn']).not.toBe('IngestionRole');
    expect(getProps(kb)['RoleArn']).not.toContain('ingestion');
  });

  it('embedding model ARN uses Stack region token (no hard-coded region)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const kb = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::KnowledgeBase'))[0];
    const cfg = getProps(kb)['KnowledgeBaseConfiguration'] as Record<string, unknown>;
    const vec = cfg['VectorKnowledgeBaseConfiguration'] as Record<string, unknown>;
    const arn = vec['EmbeddingModelArn'] as Record<string, unknown>;
    expect(arn).toBeDefined();
    const joined = arn['Fn::Join'] as unknown[];
    expect(joined).toBeDefined();
    const pieces = joined[1] as Array<unknown>;
    expect(JSON.stringify(pieces)).toMatch(/AWS::Region/);
    expect(JSON.stringify(pieces)).toContain('amazon.titan-embed-text-v2:0');
    expect(JSON.stringify(pieces)).not.toMatch(/bedrock:ap-northeast-1::foundation-model/);
    expect(JSON.stringify(pieces)).not.toMatch(/bedrock:us-east-1::foundation-model/);
    expect(JSON.stringify(pieces)).not.toMatch(/bedrock:us-west-2::foundation-model/);
  });

  it('storage type = OPENSEARCH_SERVERLESS with CollectionArn token', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const kb = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::KnowledgeBase'))[0];
    const storage = getProps(kb)['StorageConfiguration'] as Record<string, unknown>;
    expect(storage['Type']).toBe('OPENSEARCH_SERVERLESS');
    const aoss = storage['OpensearchServerlessConfiguration'] as Record<string, unknown>;
    expect(typeof aoss['CollectionArn']).toBe('object');
    expect(aoss['VectorIndexName']).toBe('test-vector-index');
  });

  it('FieldMapping: Vector/Text/Metadata fields wired to props', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const kb = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::KnowledgeBase'))[0];
    const storage = getProps(kb)['StorageConfiguration'] as Record<string, unknown>;
    const aoss = storage['OpensearchServerlessConfiguration'] as Record<string, unknown>;
    const fm = aoss['FieldMapping'] as Record<string, string>;
    expect(fm['VectorField']).toBe('vectorField');
    expect(fm['TextField']).toBe('textField');
    expect(fm['MetadataField']).toBe('metadataField');
  });

  it('Name comes from props (not a hard-coded KB ID)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const kb = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::KnowledgeBase'))[0];
    expect(getProps(kb)['Name']).toBe('TestKB');
    expect(getProps(kb)['KnowledgeBaseId']).toBeUndefined();
  });
});

// ─── E. Data Source configuration ──────────────────────────────────────────

describe('E. Data Source configuration', () => {
  it('Type = S3 with BucketArn = props', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', {
      sopSourceBucketArn: 'arn:aws:s3:::test-sop-source-bucket',
    });
    const ds = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource'))[0];
    const cfg = getProps(ds)['DataSourceConfiguration'] as Record<string, unknown>;
    expect(cfg['Type']).toBe('S3');
    const s3 = cfg['S3Configuration'] as Record<string, unknown>;
    expect(s3['BucketArn']).toBe('arn:aws:s3:::test-sop-source-bucket');
  });

  it('inclusionPrefixes from props when provided', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', {
      inclusionPrefixes: ['canonical/articles/'],
    });
    const ds = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource'))[0];
    const cfg = getProps(ds)['DataSourceConfiguration'] as Record<string, unknown>;
    const s3 = cfg['S3Configuration'] as Record<string, unknown>;
    expect(s3['InclusionPrefixes']).toEqual(['canonical/articles/']);
  });

  it('inclusionPrefixes omitted when not provided', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ds = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource'))[0];
    const cfg = getProps(ds)['DataSourceConfiguration'] as Record<string, unknown>;
    const s3 = cfg['S3Configuration'] as Record<string, unknown>;
    expect(s3['InclusionPrefixes']).toBeUndefined();
  });

  it('ChunkingStrategy = NONE; no fixed-size/semantic/hierarchical config', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ds = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource'))[0];
    const ing = getProps(ds)['VectorIngestionConfiguration'] as Record<string, unknown>;
    const chunk = ing['ChunkingConfiguration'] as Record<string, unknown>;
    expect(chunk['ChunkingStrategy']).toBe('NONE');
    expect(chunk['FixedSizeChunkingConfiguration']).toBeUndefined();
    expect(chunk['SemanticChunkingConfiguration']).toBeUndefined();
    expect(chunk['HierarchicalChunkingConfiguration']).toBeUndefined();
  });

  it('Data Source references KnowledgeBaseId token (not a literal)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ds = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource'))[0];
    const kbId = getProps(ds)['KnowledgeBaseId'];
    expect(typeof kbId).toBe('object');
  });

  it('Data Source has no ingestion job references', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ds = Object.values(getResourcesOfType(getResources(template), 'AWS::Bedrock::DataSource'))[0];
    const json = JSON.stringify(getProps(ds));
    expect(json).not.toMatch(/StartIngestionJob/);
    expect(json).not.toMatch(/GetIngestionJob/);
  });
});

// ─── F. OpenSearch Serverless Collection & policies ────────────────────────

describe('F. OpenSearch Serverless Collection & policies', () => {
  it('Collection Type = VECTORSEARCH with name from props', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const collection = Object.values(
      getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::Collection'),
    )[0];
    const p = getProps(collection);
    expect(p['Type']).toBe('VECTORSEARCH');
    expect(p['Name']).toBe('test-kb-collection');
  });

  it('Encryption policy uses AWS-owned key, resource scoped to this collection only', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const policies = getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::SecurityPolicy');
    const encPolicy = Object.values(policies).find((r) => getProps(r)['Type'] === 'encryption');
    expect(encPolicy).toBeDefined();
    const policyDoc = JSON.parse(getProps(encPolicy!)['Policy'] as string);
    expect(policyDoc.AWSOwnedKey).toBe(true);
    const rules = policyDoc.Rules;
    const collRule = rules.find((r: { ResourceType: string }) => r.ResourceType === 'collection');
    expect(collRule.Resource).toEqual(['collection/test-kb-collection']);
    for (const r of rules) {
      for (const res of r.Resource) {
        expect(res).not.toBe('collection/*');
      }
    }
  });

  it('Network policy: AllowFromPublic false per rule, no dashboard rule', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const policies = getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::SecurityPolicy');
    const netPolicy = Object.values(policies).find((r) => getProps(r)['Type'] === 'network');
    expect(netPolicy).toBeDefined();
    const parsed = JSON.parse(getProps(netPolicy!)['Policy'] as string);
    expect(Array.isArray(parsed)).toBe(true);
    const rule = parsed[0].Rules[0];
    expect(rule.ResourceType).toBe('collection');
    expect(rule.Resource).toEqual(['collection/test-kb-collection']);
    expect(rule.AllowFromPublic).toBe(false);
    expect(parsed[0].Rules.some((r: { ResourceType: string }) => r.ResourceType === 'dashboard')).toBe(false);
  });
});

// ─── G. AOSS ACCESS POLICY (split rules) ───────────────────────────────────

describe('G. AOSS AccessPolicy: exactly two index-scoped rules with split principals', () => {
  const INDEX_ARN = 'index/test-kb-collection/test-vector-index';

  function rulesFromTemplate(): {
    rules: Array<{ ResourceType: string; Resource: string[]; Permission: string[] }>;
    principals: string[];
  } {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const doc = parseAccessPolicyRules(template);
    return { rules: doc[0].Rules, principals: doc[0].Principal };
  }

  it('Policy declares exactly TWO rules, both index-scoped to the exact index ARN', () => {
    const { rules } = rulesFromTemplate();
    expect(rules).toHaveLength(2);
    for (const r of rules) {
      expect(r.ResourceType).toBe('index');
      expect(r.Resource).toEqual([INDEX_ARN]);
      // No wildcard anywhere
      for (const res of r.Resource) {
        expect(res).not.toBe('collection/*');
        expect(res).not.toMatch(/index\/[^\/]+\/\*$/);
        expect(res).not.toMatch(/index\/\*\//);
        expect(res).not.toBe('*');
      }
      for (const p of r.Permission) {
        expect(p).not.toBe('aoss:*');
      }
    }
  });

  it('Rule A: KB service role gets ONLY DescribeIndex, ReadDocument, WriteDocument', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', {
      vectorIndexDeploymentPrincipalArns: ['arn:aws:iam::222222222222:role/Other'],
    });
    const doc = parseAccessPolicyRules(template);
    const principals = doc[0].Principal;
    // The KB role must be among the principals
    expect(principals).toContain(KB_ROLE_ARN);
    // Find the rule that does NOT include lifecycle actions (ReadDocument/WriteDocument rule)
    const ruleWithDoc = doc[0].Rules.find((r) =>
      r.Permission.includes('aoss:ReadDocument') && r.Permission.includes('aoss:WriteDocument'),
    );
    expect(ruleWithDoc).toBeDefined();
    expect(ruleWithDoc!.Permission.sort()).toEqual(
      ['aoss:DescribeIndex', 'aoss:ReadDocument', 'aoss:WriteDocument'],
    );
    // No lifecycle permissions in this rule
    expect(ruleWithDoc!.Permission).not.toContain('aoss:CreateIndex');
    expect(ruleWithDoc!.Permission).not.toContain('aoss:UpdateIndex');
    expect(ruleWithDoc!.Permission).not.toContain('aoss:DeleteIndex');
  });

  it('Rule B: deployment principals get ONLY CreateIndex, DescribeIndex, UpdateIndex, DeleteIndex', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', {
      vectorIndexDeploymentPrincipalArns: [
        'arn:aws:iam::222222222222:role/DeployerA',
        'arn:aws:iam::333333333333:role/DeployerB',
      ],
    });
    const doc = parseAccessPolicyRules(template);
    // The lifecycle rule
    const ruleWithLifecycle = doc[0].Rules.find((r) =>
      r.Permission.includes('aoss:CreateIndex'),
    );
    expect(ruleWithLifecycle).toBeDefined();
    expect(ruleWithLifecycle!.Permission.sort()).toEqual(
      ['aoss:CreateIndex', 'aoss:DeleteIndex', 'aoss:DescribeIndex', 'aoss:UpdateIndex'],
    );
    // No document read/write on the deployment-rule
    expect(ruleWithLifecycle!.Permission).not.toContain('aoss:ReadDocument');
    expect(ruleWithLifecycle!.Permission).not.toContain('aoss:WriteDocument');
    expect(ruleWithLifecycle!.Permission).not.toContain('aoss:APIAccessAll');
  });

  it('NO aoss:* anywhere in the rendered access policy', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ap = Object.values(
      getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::AccessPolicy'),
    )[0];
    const json = JSON.stringify(getProps(ap));
    expect(json).not.toMatch(/aoss:\*/);
  });

  it('NO collection wildcard anywhere in the rendered access policy', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ap = Object.values(
      getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::AccessPolicy'),
    )[0];
    const json = JSON.stringify(getProps(ap));
    expect(json).not.toMatch(/collection\/\*/);
  });

  it('NO index wildcard anywhere in the rendered access policy', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ap = Object.values(
      getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::AccessPolicy'),
    )[0];
    const json = JSON.stringify(getProps(ap));
    expect(json).not.toMatch(/index\/[^\/]+\/\*/);
    expect(json).not.toMatch(/"index\/\*\//);
  });

  it('NO principal wildcard anywhere in the rendered access policy', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const ap = Object.values(
      getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::AccessPolicy'),
    )[0];
    const json = JSON.stringify(getProps(ap));
    expect(json).not.toMatch(/"\*"/);
    expect(json).not.toMatch(/\["\*"\]/);
  });

  it('Both deployment principals appear in the Principal list', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', {
      vectorIndexDeploymentPrincipalArns: [
        'arn:aws:iam::222222222222:role/DeployerA',
        'arn:aws:iam::333333333333:role/DeployerB',
      ],
    });
    const doc = parseAccessPolicyRules(template);
    expect(doc[0].Principal).toContain('arn:aws:iam::222222222222:role/DeployerA');
    expect(doc[0].Principal).toContain('arn:aws:iam::333333333333:role/DeployerB');
    expect(doc[0].Principal).toContain(KB_ROLE_ARN);
  });
});

// ─── H. Vector Index ───────────────────────────────────────────────────────

describe('H. Vector Index', () => {
  it('index name and collection endpoint from props/token', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const idx = Object.values(getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::Index'))[0];
    const p = getProps(idx);
    expect(p['IndexName']).toBe('test-vector-index');
    expect(typeof p['CollectionEndpoint']).toBe('object');
  });

  it('index.knn = true and vector field dimension matches props', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', { embeddingDimension: 1536 });
    const idx = Object.values(getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::Index'))[0];
    const p = getProps(idx);
    const settings = p['Settings'] as Record<string, unknown>;
    const idxBlock = settings['Index'] as Record<string, unknown>;
    expect(idxBlock['Knn']).toBe(true);
    const mappings = p['Mappings'] as Record<string, unknown>;
    const properties = (mappings['Properties'] as Record<string, unknown>)['vectorField'] as Record<string, unknown>;
    expect(properties['Type']).toBe('knn_vector');
    expect(properties['Dimension']).toBe(1536);
    const method = properties['Method'] as Record<string, unknown>;
    expect(method['Engine']).toBe('faiss');
    expect(method['Name']).toBe('hnsw');
  });

  it('text and metadata fields present and not knn_vector', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV');
    const idx = Object.values(getResourcesOfType(getResources(template), 'AWS::OpenSearchServerless::Index'))[0];
    const p = getProps(idx);
    const mappings = p['Mappings'] as Record<string, unknown>;
    const properties = mappings['Properties'] as Record<string, unknown>;
    const text = properties['textField'] as Record<string, unknown>;
    expect(text['Type']).toBe('text');
    const meta = properties['metadataField'] as Record<string, unknown>;
    expect(meta['Type']).not.toBe('knn_vector');
  });
});

// ─── I. Input validation ───────────────────────────────────────────────────

describe('I. Input validation', () => {
  function makeValidation(): { stack: Stack; ctx: import('../lib/env_context.js').EnvironmentContext } {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    return { stack: new Stack(app, `${ctx.resourcePrefix}-validation-test`), ctx };
  }

  function buildProps(overrides: PropsOverride = {}): FullProps {
    const { ctx } = makeValidation();
    return { envContext: ctx, ...dummyProps(overrides) };
  }

  it('invalid collection name (uppercase) throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ collectionName: 'InvalidUpper' }))).toThrow(/collectionName/);
  });

  it('invalid collection name (too short) throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ collectionName: 'ab' }))).toThrow(/collectionName/);
  });

  it('invalid vector index name (starts with underscore) throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ vectorIndexName: '_bad' }))).toThrow(/vectorIndexName/);
  });

  it('empty embeddingModelId throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ embeddingModelId: '' }))).toThrow(/embeddingModelId/);
  });

  it('embeddingModelId as full foundation-model ARN throws', () => {
    expect(() =>
      new KnowledgeBaseConstruct(
        makeValidation().stack,
        'X',
        buildProps({
          embeddingModelId: 'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0',
        }),
      ),
    ).toThrow(/embeddingModelId/);
  });

  it('non-positive embeddingDimension throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ embeddingDimension: 0 }))).toThrow(/embeddingDimension/);
  });

  it('empty role ARN throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ knowledgeBaseServiceRoleArn: '' }))).toThrow(/knowledgeBaseServiceRoleArn/);
  });

  it('wildcard role ARN throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ knowledgeBaseServiceRoleArn: 'arn:aws:iam::*:role/*' }))).toThrow(/wildcard/i);
  });

  it('empty vectorIndexDeploymentPrincipalArns throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ vectorIndexDeploymentPrincipalArns: [] }))).toThrow(/vectorIndexDeploymentPrincipalArns/);
  });

  it('wildcard deployment principal throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ vectorIndexDeploymentPrincipalArns: [DEPLOY_PRINCIPAL_ARN, '*'] }))).toThrow(/wildcard/i);
  });

  it('deployment principal list duplicating the KB role throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ vectorIndexDeploymentPrincipalArns: [KB_ROLE_ARN] }))).toThrow(/split deployment principals/i);
  });

  it('deployment principal list with duplicate ARNs throws', () => {
    const dup = 'arn:aws:iam::222222222222:role/Deployer';
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ vectorIndexDeploymentPrincipalArns: [dup, dup] }))).toThrow(/duplicates/);
  });

  it('empty deployment principal entry throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ vectorIndexDeploymentPrincipalArns: [DEPLOY_PRINCIPAL_ARN, ''] }))).toThrow(/non-empty/i);
  });

  it('malformed deployment principal entry throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ vectorIndexDeploymentPrincipalArns: ['not-an-arn'] }))).toThrow(/vectorIndexDeploymentPrincipalArns/);
  });

  it('duplicate field names throws', () => {
    expect(() =>
      new KnowledgeBaseConstruct(
        makeValidation().stack,
        'X',
        buildProps({ vectorFieldName: 'f', textFieldName: 'f', metadataFieldName: 'm' }),
      ),
    ).toThrow(/distinct/);
  });

  it('inclusion prefix starting with "/" throws', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps({ inclusionPrefixes: ['/absolute'] }))).toThrow(/inclusionPrefixes/);
  });

  it('valid params are accepted', () => {
    expect(() => new KnowledgeBaseConstruct(makeValidation().stack, 'X', buildProps())).not.toThrow();
  });
});

// ─── J. Source-level boundary tests ────────────────────────────────────────

describe('J. Source-level boundary tests', () => {
  function readConstructSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'knowledge_base.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('no hard-coded AWS account (12 digits)', () => {
    const content = readConstructSource();
    const matches = content.match(/\b\d{12}\b/g) ?? [];
    expect(matches).toEqual([]);
  });

  it('no hard-coded AWS region (ap-*/us-*/eu-*/cn-*)', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('no hard-coded foundation model ID literal in runtime path', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/embeddingModelArn\s*[:=]\s*['"`]/);
  });

  it('source does NOT claim TASK-083 creates the KB service role', () => {
    const content = readConstructSource();
    // Acceptable phrasings: "not created by TASK-083", "NOT created by TASK-083",
    // "TASK-083 (sole owner)" only referring to IngestionRole, etc.
    // Forbidden phrasing: a direct claim that TASK-083 creates the KB service role.
    expect(content).not.toMatch(/TASK-083[^.]*creates\s+(?:the\s+)?Knowledge\s+Base\s+service\s+role/i);
    expect(content).not.toMatch(/TASK-083\s+(?:creates|provision(?:s|ed)|owns)\s+(?:the\s+)?KB\s+service\s+role/i);
  });

  it('source distinguishes Knowledge Base service role from IngestionRole', () => {
    const content = readConstructSource();
    expect(content).toMatch(/Knowledge Base SERVICE ROLE/);
    expect(content).toMatch(/IngestionRole/);
    expect(content).toMatch(/not\s+(?:created|provisioned)\s+by\s+TASK-083/i);
  });

  it('source documents IAM aoss:APIAccessAll as a later deployment requirement', () => {
    const content = readConstructSource();
    expect(content).toMatch(/aoss:APIAccessAll/);
    // It must NOT be implemented as a CFN IAM resource here. Strip JSDoc and
    // string literals; the prohibition concerns runtime implementation, not
    // documentation or ARN regex literals.
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^import .*$/gm, '')
      .replace(/'[^']*'/g, "''");
    expect(stripped).not.toMatch(/AWS::IAM::(?:Role|Policy)/);
    expect(stripped).not.toMatch(/new\s+iam\./);
    expect(stripped).not.toMatch(/new\s+aws_iam\./);
  });

  it('Construct source has no StartIngestionJob / GetIngestionJob implementation', () => {
    const content = readConstructSource();
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/StartIngestionJob/);
    expect(stripped).not.toMatch(/GetIngestionJob/);
  });

  it('no runtime Lambda, no AwsCustomResource, no SDK client', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/new\s+(Function|NodejsFunction)\b/);
    expect(content).not.toMatch(/AwsCustomResource/);
    expect(content).not.toMatch(/@aws-sdk\//);
    expect(content).not.toMatch(/from\s+['"]aws-sdk/);
  });

  it('JSDoc documents seven-article chunking and S3 fallback boundary', () => {
    const content = readConstructSource();
    expect(content).toMatch(/seven|7\s*article/i);
    expect(content).toMatch(/article_no/);
    expect(content).toMatch(/Fallback|fallback/i);
    expect(content).toMatch(/SopRetriever|S3/);
  });

  it('JSDoc documents deterministic-truth boundary', () => {
    const content = readConstructSource();
    expect(content).toMatch(/LANGUAGE|numeric|truth|deterministic/i);
  });

  it('Construct does NOT contain the deprecated CfnResource#addDependency call (only addResourceDependency)', () => {
    const content = readConstructSource();
    // Strip comments and string literals before scanning
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\.addDependency\s*\(/);
    expect(stripped).toMatch(/\.addResourceDependency\s*\(/);
  });
});

// ─── K. Public exports & config keys ───────────────────────────────────────

describe('K. Public exports & config keys', () => {
  it('exports the three required config-key constants', () => {
    expect(KB_KNOWLEDGE_BASE_ID_CONFIG_KEY).toBe('kb.knowledge_base_id');
    expect(KB_EMBEDDING_MODEL_ID_CONFIG_KEY).toBe('kb.embedding_model_id');
    expect(KB_DATA_SOURCE_BUCKET_CONFIG_KEY).toBe('kb.data_source_bucket');
  });

  it('exports KNOWLEDGE_BASE_SERVICE_ROLE_REQUIRED = true (typed deployment-readiness marker)', () => {
    expect(KNOWLEDGE_BASE_SERVICE_ROLE_REQUIRED).toBe(true);
  });
});
