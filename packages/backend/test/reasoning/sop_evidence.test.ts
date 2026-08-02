/**
 * Unit tests for sop_evidence.ts
 *
 * Verifies:
 * - buildRagTrace produces correct RagTrace structure
 * - mapRetrieverType maps correctly
 * - buildRetrievalContext builds correct context strings
 */

import { describe, it, expect } from 'vitest';
import {
  buildRagTrace,
  mapRetrieverType,
  buildRetrievalContext,
} from '../../src/reasoning/sop_evidence.js';
import type { SopCitationResult } from '@city-commander/rag';

const makeCitation = (articleNo: number, source: 'kb' | 's3_fallback' = 'kb'): SopCitationResult => ({
  article_no: articleNo,
  content: `SOP 第 ${articleNo} 條原文`,
  source_location: source === 'kb'
    ? `s3://kb-bucket/chunks/article-${articleNo}.json`
    : `s3://bucket/sop/article-${articleNo}.json`,
  relevancy_score: source === 'kb' ? 0.95 : null,
  source,
});

describe('buildRagTrace', () => {
  it('builds correct RagTrace with local_sop_knowledge_base retriever', () => {
    const citations = [makeCitation(2), makeCitation(7, 's3_fallback')];
    const trace = buildRagTrace(
      citations,
      'SOP 第 2、7 條查詢',
      'local_sop_knowledge_base',
      'emergency_traffic_sop.txt',
    );

    expect(trace.retriever_type).toBe('local_sop_knowledge_base');
    expect(trace.knowledge_source).toBe('emergency_traffic_sop.txt');
    expect(trace.query).toBe('SOP 第 2、7 條查詢');
    expect(trace.citations).toEqual([2, 7]);
    expect(trace.retrieval_count).toBe(2);
    expect(trace.retrieved_chunks).toHaveLength(2);
  });

  it('retrieved_chunks contain article, heading, excerpt, source, score', () => {
    const citations = [makeCitation(3, 's3_fallback')];
    const trace = buildRagTrace(citations, 'query', 'local_sop_knowledge_base', 'emergency_traffic_sop.txt');

    const chunk = trace.retrieved_chunks[0];
    expect(chunk.article).toBe(3);
    expect(chunk.heading).toBe('捷運與接駁分流');
    expect(chunk.excerpt).toBe('SOP 第 3 條原文');
    expect(chunk.score).toBeNull(); // s3_fallback → null
    expect(chunk.source).toBe('s3://bucket/sop/article-3.json');
  });

  it('kb citation preserves relevancy_score', () => {
    const citations = [makeCitation(1, 'kb')];
    const trace = buildRagTrace(citations, 'query', 'aws_bedrock_kb', 'AWS Bedrock Knowledge Base');

    const chunk = trace.retrieved_chunks[0];
    expect(chunk.score).toBe(0.95);
  });

  it('maps article 6 heading correctly', () => {
    const citations = [makeCitation(6)];
    const trace = buildRagTrace(citations, 'query', 'local_sop_knowledge_base', 'emergency_traffic_sop.txt');

    expect(trace.retrieved_chunks[0].heading).toBe('數位通報與多語化');
  });

  it('empty citations produces empty retrieved_chunks', () => {
    const trace = buildRagTrace([], 'empty query', 'local_sop_knowledge_base', 'emergency_traffic_sop.txt');

    expect(trace.citations).toEqual([]);
    expect(trace.retrieval_count).toBe(0);
    expect(trace.retrieved_chunks).toHaveLength(0);
  });
});

describe('mapRetrieverType', () => {
  it('kb → aws_bedrock_kb', () => {
    expect(mapRetrieverType('kb')).toBe('aws_bedrock_kb');
  });

  it('kb_partial_s3_fallback → local_sop_knowledge_base', () => {
    expect(mapRetrieverType('kb_partial_s3_fallback')).toBe('local_sop_knowledge_base');
  });

  it('s3_fallback → local_sop_knowledge_base', () => {
    expect(mapRetrieverType('s3_fallback')).toBe('local_sop_knowledge_base');
  });
});

describe('buildRetrievalContext', () => {
  it('includes triggered articles', () => {
    const ctx = buildRetrievalContext([2, 3], [], undefined, []);
    expect(ctx).toContain('SOP 第 2、3 條');
  });

  it('includes applied formula articles', () => {
    const ctx = buildRetrievalContext([], [7], undefined, []);
    expect(ctx).toContain('SOP 第 7 條');
  });

  it('includes ETE when provided', () => {
    const ctx = buildRetrievalContext([], [7], 64.4, []);
    expect(ctx).toContain('64.4');
  });

  it('includes first two expected actions', () => {
    const actions = ['動作A', '動作B', '動作C'];
    const ctx = buildRetrievalContext([2], [], undefined, actions);
    expect(ctx).toContain('動作A');
    expect(ctx).toContain('動作B');
    expect(ctx).not.toContain('動作C');
  });

  it('returns minimal string when all inputs are empty', () => {
    const ctx = buildRetrievalContext([], [], undefined, []);
    expect(ctx).toBe('What-if 假設情境');
  });
});
