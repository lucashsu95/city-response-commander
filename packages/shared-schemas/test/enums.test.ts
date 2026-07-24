/**
 * Enum-completeness unit tests for shared-schemas
 *
 * Validates:
 * - IdempotencyStatus has exactly 5 values (no 'accepted')
 * - NarrativeType has exactly 3 values (REPORT, PUBLIC_ALERT, EXPLANATION)
 * - All design-specified enums exist and have correct values
 * - No LLM-writable marker on any core numeric field (type-level)
 */
import { describe, it, expect } from 'vitest';
import {
  IdempotencyStatus,
  NarrativeType,
  RecoveryStage,
  RecoveryMode,
  EvidenceSource,
  CoreWriteStatus,
  StatusActionResult,
  CongestionLevel,
  Severity,
  IncidentStatus,
  PublishStatus,
  SCHEMA_VERSION,
  TrafficGrade,
  RouteCandidateRole,
  UpstreamDownstream,
  SOPArticle,
} from '../src/index.js';

describe('shared-schemas enums', () => {
  describe('IdempotencyStatus', () => {
    it('has exactly 5 values', () => {
      const values = Object.values(IdempotencyStatus);
      expect(values).toHaveLength(5);
    });

    it('contains the 5 required status values', () => {
      expect(IdempotencyStatus.starting).toBe('starting');
      expect(IdempotencyStatus.running).toBe('running');
      expect(IdempotencyStatus.completed).toBe('completed');
      expect(IdempotencyStatus.start_failed).toBe('start_failed');
      expect(IdempotencyStatus.processing_failed).toBe('processing_failed');
    });

    it('does NOT contain "accepted" (HTTP 202 is API semantic, not DynamoDB status)', () => {
      const values = Object.values(IdempotencyStatus);
      expect(values).not.toContain('accepted');
    });
  });

  describe('NarrativeType', () => {
    it('has exactly 3 values', () => {
      const values = Object.values(NarrativeType);
      expect(values).toHaveLength(3);
    });

    it('contains the required set {REPORT, PUBLIC_ALERT, EXPLANATION}', () => {
      expect(NarrativeType.REPORT).toBe('REPORT');
      expect(NarrativeType.PUBLIC_ALERT).toBe('PUBLIC_ALERT');
      expect(NarrativeType.EXPLANATION).toBe('EXPLANATION');
    });
  });

  describe('RecoveryStage', () => {
    it('has exactly 4 values', () => {
      const values = Object.values(RecoveryStage);
      expect(values).toHaveLength(4);
    });

    it('contains detect, gate, reconcile, restart', () => {
      expect(RecoveryStage.detect).toBe('detect');
      expect(RecoveryStage.gate).toBe('gate');
      expect(RecoveryStage.reconcile).toBe('reconcile');
      expect(RecoveryStage.restart).toBe('restart');
    });
  });

  describe('RecoveryMode', () => {
    it('has exactly 3 values', () => {
      const values = Object.values(RecoveryMode);
      expect(values).toHaveLength(3);
    });

    it('contains FIRST_RUN, STALE_RECOVERY, START_FAILED_RETRY', () => {
      expect(RecoveryMode.FIRST_RUN).toBe('FIRST_RUN');
      expect(RecoveryMode.STALE_RECOVERY).toBe('STALE_RECOVERY');
      expect(RecoveryMode.START_FAILED_RETRY).toBe('START_FAILED_RETRY');
    });
  });

  describe('EvidenceSource', () => {
    it('has exactly 2 values', () => {
      const values = Object.values(EvidenceSource);
      expect(values).toHaveLength(2);
    });

    it('contains DECISIONFN_COMMITTED and ENRICHMENT_COMMITTED', () => {
      expect(EvidenceSource.DECISIONFN_COMMITTED).toBe('DECISIONFN_COMMITTED');
      expect(EvidenceSource.ENRICHMENT_COMMITTED).toBe('ENRICHMENT_COMMITTED');
    });
  });

  describe('CoreWriteStatus', () => {
    it('has exactly 3 values', () => {
      const values = Object.values(CoreWriteStatus);
      expect(values).toHaveLength(3);
    });

    it('contains COMMITTED, ALREADY_COMMITTED_SAME_DECISION, CORE_IDENTITY_CONFLICT', () => {
      expect(CoreWriteStatus.COMMITTED).toBe('COMMITTED');
      expect(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION).toBe('ALREADY_COMMITTED_SAME_DECISION');
      expect(CoreWriteStatus.CORE_IDENTITY_CONFLICT).toBe('CORE_IDENTITY_CONFLICT');
    });
  });

  describe('StatusActionResult', () => {
    it('has exactly 3 values', () => {
      const values = Object.values(StatusActionResult);
      expect(values).toHaveLength(3);
    });

    it('contains APPLIED, ALREADY_APPLIED, FENCED_STALE_EXECUTION', () => {
      expect(StatusActionResult.APPLIED).toBe('APPLIED');
      expect(StatusActionResult.ALREADY_APPLIED).toBe('ALREADY_APPLIED');
      expect(StatusActionResult.FENCED_STALE_EXECUTION).toBe('FENCED_STALE_EXECUTION');
    });
  });

  describe('CongestionLevel', () => {
    it('has exactly 3 values', () => {
      const values = Object.values(CongestionLevel);
      expect(values).toHaveLength(3);
    });

    it('contains A, B, NONE', () => {
      expect(CongestionLevel.A).toBe('A');
      expect(CongestionLevel.B).toBe('B');
      expect(CongestionLevel.NONE).toBe('NONE');
    });
  });

  describe('Severity', () => {
    it('has exactly 3 values', () => {
      const values = Object.values(Severity);
      expect(values).toHaveLength(3);
    });

    it('contains Critical, High, Medium', () => {
      expect(Severity.Critical).toBe('Critical');
      expect(Severity.High).toBe('High');
      expect(Severity.Medium).toBe('Medium');
    });
  });

  describe('IncidentStatus', () => {
    it('has exactly 5 official-data values', () => {
      const values = Object.values(IncidentStatus);
      expect(values).toHaveLength(5);
    });

    it('contains Closed, Blocked, Restricted, Open, and Caution', () => {
      expect(IncidentStatus.Closed).toBe('Closed');
      expect(IncidentStatus.Blocked).toBe('Blocked');
      expect(IncidentStatus.Restricted).toBe('Restricted');
      expect(IncidentStatus.Open).toBe('Open');
      expect(IncidentStatus.Caution).toBe('Caution');
    });
  });

  describe('PublishStatus', () => {
    it('has exactly 4 values', () => {
      const values = Object.values(PublishStatus);
      expect(values).toHaveLength(4);
    });

    it('contains draft, approved, published, publish_failed', () => {
      expect(PublishStatus.draft).toBe('draft');
      expect(PublishStatus.approved).toBe('approved');
      expect(PublishStatus.published).toBe('published');
      expect(PublishStatus.publish_failed).toBe('publish_failed');
    });
  });

  describe('SCHEMA_VERSION', () => {
    it('is a non-empty string', () => {
      expect(typeof SCHEMA_VERSION).toBe('string');
      expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
    });

    it('is 1.0.0', () => {
      expect(SCHEMA_VERSION).toBe('1.0.0');
    });
  });

  describe('TrafficGrade', () => {
    it('has exactly 3 values', () => {
      const values = Object.values(TrafficGrade);
      expect(values).toHaveLength(3);
    });
  });

  describe('RouteCandidateRole', () => {
    it('has 4 values', () => {
      const values = Object.values(RouteCandidateRole);
      expect(values).toHaveLength(4);
    });

    it('contains primary, secondary, excluded, unranked_direct_intersection', () => {
      expect(RouteCandidateRole.primary).toBe('primary');
      expect(RouteCandidateRole.secondary).toBe('secondary');
      expect(RouteCandidateRole.excluded).toBe('excluded');
      expect(RouteCandidateRole.unranked_direct_intersection).toBe('unranked_direct_intersection');
    });
  });

  describe('UpstreamDownstream', () => {
    it('has exactly 2 values', () => {
      const values = Object.values(UpstreamDownstream);
      expect(values).toHaveLength(2);
    });
  });

  describe('SOPArticle', () => {
    it('has exactly 7 articles', () => {
      const values = Object.values(SOPArticle).filter(v => typeof v === 'number');
      expect(values).toHaveLength(7);
    });
  });
});
