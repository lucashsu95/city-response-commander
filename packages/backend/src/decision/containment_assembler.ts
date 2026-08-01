/** Layer-2 containment assembler: external composition and output safety only. */
import {
  extractRoadIdLike,
  partitionByWhitelist,
  runDeterministicContainment,
} from '@city-commander/domain';
import type {
  DeterministicContainmentResult,
  DeterministicDecisionFacts,
  IngestionResult,
  PolicyStrategyConfigProvider,
} from '@city-commander/domain';
import type {
  ContainmentComposerValidation,
  ContainmentDecision,
  EntityScopeResult,
  Incident,
  MappedAnchorNode,
  SafeContext,
  SopCoverageResult,
  WhitelistViolation,
} from '@city-commander/shared-schemas';

/** External natural-language generator. Its payload is untrusted until validated. */
export interface BedrockComposerClient {
  generate(context: SafeContext): Promise<unknown>;
}

/** Adapter backed by RAG's canonical Bedrock payload validator. */
export interface BedrockComposerOutputValidator {
  validate(payload: unknown): ContainmentComposerValidation;
}

export interface AssembleContainmentInput {
  readonly ingestion: IngestionResult;
  readonly incident: Incident;
  readonly config: PolicyStrategyConfigProvider;
  readonly composer: BedrockComposerClient;
  readonly validator: BedrockComposerOutputValidator;
}

export interface ContainmentAssemblerResult {
  readonly error?: 'CONFIG_MISSING';
  readonly missing_key?: string;
  readonly data_status: DeterministicContainmentResult['data_status'];
  readonly stop_reason: string | null;
  readonly source_manifest_hash: string;
  readonly entity_scope: EntityScopeResult | null;
  readonly sop_coverage: SopCoverageResult | null;
  readonly data_scope_status: DeterministicContainmentResult['data_scope_status'];
  readonly mapped_anchor_node: MappedAnchorNode | null;
  readonly safe_context: SafeContext | null;
  readonly sop_coverage_status: SopCoverageResult['sop_coverage_status'] | null;
  readonly sop_authority: SopCoverageResult['sop_authority'] | null;
  readonly decision: ContainmentDecision;
  readonly whitelist_violations: readonly WhitelistViolation[];
  readonly facts: DeterministicDecisionFacts | null;
}

export type AssembleContainmentResult = ContainmentAssemblerResult;

function configFailure(ingestion: IngestionResult, missingKey: string): ContainmentAssemblerResult {
  return {
    error: 'CONFIG_MISSING',
    missing_key: missingKey,
    data_status: 'insufficient_data',
    stop_reason: `Containment configuration missing: ${missingKey}.`,
    source_manifest_hash: ingestion.source_manifest_hash,
    entity_scope: null,
    sop_coverage: null,
    data_scope_status: null,
    mapped_anchor_node: null,
    safe_context: null,
    sop_coverage_status: null,
    sop_authority: null,
    decision: { reroute_roads: [], perimeter_control: null, ai_reasoning: null },
    whitelist_violations: [],
    facts: null,
  };
}

function countViolations(
  extractedIds: readonly string[],
  rejectedIds: ReadonlySet<string>,
): readonly WhitelistViolation[] {
  return [...rejectedIds].sort().map((roadId) => ({
    road_id: roadId,
    occurrences: extractedIds.filter((candidate) => candidate === roadId).length,
  }));
}

function redactViolations(text: string, violations: readonly WhitelistViolation[]): string {
  return violations.reduce(
    (sanitized, violation) => sanitized.split(violation.road_id).join('[已阻擋非白名單道路]'),
    text,
  );
}

function disclose(
  deterministic: DeterministicContainmentResult,
  aiReasoning: string | null,
  whitelistViolations: readonly WhitelistViolation[],
): ContainmentAssemblerResult {
  return {
    data_status: deterministic.data_status,
    stop_reason: deterministic.stop_reason,
    source_manifest_hash: deterministic.source_manifest_hash,
    entity_scope: deterministic.entity_scope,
    sop_coverage: deterministic.sop_coverage,
    data_scope_status: deterministic.data_scope_status,
    mapped_anchor_node: deterministic.mapped_anchor_node,
    safe_context: deterministic.safe_context,
    sop_coverage_status: deterministic.sop_coverage?.sop_coverage_status ?? null,
    sop_authority: deterministic.sop_coverage?.sop_authority ?? null,
    decision: { ...deterministic.decision, ai_reasoning: aiReasoning },
    whitelist_violations: whitelistViolations,
    facts: deterministic.facts,
  };
}

/**
 * Run deterministic containment, then optionally ask Bedrock only for wording.
 * Invalid or prohibited composer output falls back to the deterministic result.
 */
export async function assembleContainment(
  input: AssembleContainmentInput,
): Promise<AssembleContainmentResult> {
  const deterministic = runDeterministicContainment(input);
  if ('error' in deterministic) return configFailure(input.ingestion, deterministic.missing_key);
  if (deterministic.data_scope_status === 'OUT_OF_JURISDICTION') {
    return disclose(
      deterministic,
      '事件超出本系統路網轄區，未執行道路吸附或 AI 指揮建議生成。',
      [],
    );
  }
  if (!deterministic.composer_allowed || deterministic.safe_context === null) {
    return disclose(deterministic, null, []);
  }

  try {
    const payload = await input.composer.generate(deterministic.safe_context);
    const validated = input.validator.validate(payload);
    if (validated.outcome !== 'accepted') return disclose(deterministic, null, []);

    const extractedIds = extractRoadIdLike(validated.text);
    const whitelist = new Set(deterministic.safe_context.allowed_road_whitelist);
    const { rejected } = partitionByWhitelist(extractedIds, whitelist);
    const violations = countViolations(extractedIds, rejected);
    return disclose(deterministic, redactViolations(validated.text, violations), violations);
  } catch {
    return disclose(deterministic, null, []);
  }
}
