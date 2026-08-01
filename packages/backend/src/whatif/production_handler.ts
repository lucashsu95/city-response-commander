/**
 * Production composition root for the What-if Lambda.
 *
 * Wires:
 *  - ProductionRuleEngineWhatIfFacade (verified baseline + deterministic rerun)
 *  - LocalSopRetriever (in-memory SOP citations)
 *  - ProductionBedrockInvoker (Bedrock Converse, real)
 *
 * The composition root returns a Lambda handler compatible with the
 * `APIGatewayProxyEventV2 -> APIGatewayProxyResultV2` contract.
 *
 * @module backend/whatif/production_handler
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { ingestData, type DataSourceProvider } from '@city-commander/domain';

import type { SopRetriever } from '@city-commander/rag';

import { createWhatIfHandler } from './whatif_fn.js';
import { ProductionRuleEngineWhatIfFacade } from './production_rule_engine_facade.js';
import { LocalSopRetriever } from './local_sop_retriever.js';
import { ProductionBedrockInvoker } from './production_bedrock_invoker.js';

/**
 * Build a Lambda handler backed by the production What-if pipeline.
 *
 * @param provider - DataSourceProvider pointing at the 5 official runtime
 *                   sources. Source integrity is verified by the facade
 *                   during loadBaseline().
 */
export function createProductionWhatIfHandler(
  provider: DataSourceProvider,
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2> {
  // Eager-load ingestion to derive the SOP retriever's view of articles.
  // The facade also runs ingestData internally; we keep one source of truth.
  const ingestion = ingestData(provider);
  if (ingestion.data_status !== 'ready' || ingestion.sopArticles === undefined) {
    throw new Error(
      `What-if Lambda cannot start: ingestion failed (${ingestion.stop_reason ?? 'unknown'})`,
    );
  }

  const facade = new ProductionRuleEngineWhatIfFacade(provider);
  const sopRetriever = new LocalSopRetriever(ingestion.sopArticles);
  const bedrockInvoker = new ProductionBedrockInvoker();

  return createWhatIfHandler({
    bedrockInvoker,
    // The official SopRetriever interface exposes the same `retrieve()`
    // contract as LocalSopRetriever; structural typing is sufficient.
    sopRetriever: sopRetriever as unknown as SopRetriever,
    ruleEngineFacade: facade,
  });
}
