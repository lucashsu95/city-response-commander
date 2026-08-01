import {
  validateScenario as validateScenarioWithCatalog,
  type LoadedEntityCatalog,
} from '../../src/whatif/validators.js';
import type { WhatIfAssumption, ValidateScenarioResult } from '../../src/whatif/whatif_types.js';

export const LOADED_ENTITIES: LoadedEntityCatalog = {
  roadSegmentIds: new Set(['RD_TPE_001', 'RD_TPE_002', 'RD_TPE_007', 'RD_TPE_009']),
  baseStationIds: new Set(['BS_MRT_BL17', 'BS_MRT_BL18', 'BS_TPE_DOME', 'BS_X']),
};

export function validateScenario(
  assumptions: readonly WhatIfAssumption[],
): ValidateScenarioResult {
  return validateScenarioWithCatalog(assumptions, LOADED_ENTITIES);
}
