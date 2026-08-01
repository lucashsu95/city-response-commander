/**
 * RAG trace types for What-if and incident responses.
 *
 * Exposes the full retrieval provenance of SOP citations so that:
 * - Dashboard / frontend can display which articles were retrieved
 * - Backend can verify deterministic article selection matches retrieval
 * - Auditors can trace SOP grounding without access to AWS KB
 *
 * @module shared-schemas/rag_trace
 */

/**
 * Single retrieved SOP chunk.
 */
export interface RagTraceChunk {
  /** Article number (1-7) */
  readonly article: number;
  /** Heading / title of the article section */
  readonly heading: string;
  /** Verbatim excerpt from the SOP article */
  readonly excerpt: string;
  /** Relevance score from the retriever (null for local_kb) */
  readonly score: number | null;
  /** Source identifier (KB URI, S3 path, or local SOP file) */
  readonly source: string;
}

/**
 * The canonical RAG trace shape attached to both What-if responses
 * and incident decision responses.
 *
 * `retriever_type` is the authoritative label:
 *  - "aws_bedrock_kb"  → real AWS Bedrock Knowledge Base (managed KB)
 *  - "local_sop_knowledge_base" → in-memory SOP lookup (no AWS KB)
 *
 * Frontend consumers must NOT claim AWS KB usage when retriever_type
 * is "local_sop_knowledge_base".
 */
export interface RagTrace {
  /** Which retriever was used */
  readonly retriever_type: 'aws_bedrock_kb' | 'local_sop_knowledge_base';
  /**
   * Human-readable knowledge source label.
   * - AWS KB: `"AWS Bedrock Knowledge Base"`
   * - Local KB: `"emergency_traffic_sop.txt"`
   */
  readonly knowledge_source: string;
  /** The original user / system query that triggered retrieval */
  readonly query: string;
  /** Ordered retrieved chunks (one per cited article, sorted by article number) */
  readonly retrieved_chunks: readonly RagTraceChunk[];
  /** Article numbers that were cited */
  readonly citations: readonly number[];
  /** Total number of chunks retrieved */
  readonly retrieval_count: number;
}
