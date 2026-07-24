/**
 * Unit tests for RuleEngine Article 3 — SOP-3 MRT Shuttle (捷運與接駁分流)
 *
 * Verifies:
 * - OR trigger: Growth_Rate > 0.30 OR User_Count > 25000
 * - Boundary: 25000 NOT met, 25001 met
 * - Boundary: Growth_Rate = 0.30 NOT met, must be strictly greater
 * - Actions present when triggered: skip-stop + bus shuttle + walk to BL18
 * - Missing readings (null) → insufficient_data, no trigger assumed
 * - Non-BL17 station returns not triggered (data_status=ready)
 * - Both conditions true → triggered with combined reason
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateArticle3,
  ARTICLE3_STATION_ID,
  ARTICLE3_WALK_TARGET,
  GROWTH_RATE_THRESHOLD,
  USER_COUNT_THRESHOLD,
  type Article3Input,
  type Article3Result,
} from '../../src/rule_engine/article3.js';

describe('RuleEngine Article 3 (SOP-3 MRT Shuttle)', () => {
  describe('Trigger conditions — OR logic', () => {
    it('triggers when Growth_Rate > 0.30', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 20000,
        growth_rate: 0.31,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.trigger_reason).toContain('Growth_Rate');
      expect(result.adds_to_triggered_articles).toEqual([3]);
      expect(result.data_status).toBe('ready');
    });

    it('triggers when User_Count > 25000', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 25001,
        growth_rate: 0.10,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.trigger_reason).toContain('User_Count');
      expect(result.adds_to_triggered_articles).toEqual([3]);
      expect(result.data_status).toBe('ready');
    });

    it('triggers when both conditions are met', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 31000,
        growth_rate: 0.50,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.trigger_reason).toContain('Growth_Rate');
      expect(result.trigger_reason).toContain('User_Count');
      expect(result.trigger_reason).toContain('OR');
      expect(result.adds_to_triggered_articles).toEqual([3]);
    });

    it('does NOT trigger when neither condition is met', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 20000,
        growth_rate: 0.20,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(false);
      expect(result.trigger_reason).toBeNull();
      expect(result.actions).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([]);
      expect(result.data_status).toBe('ready');
    });
  });

  describe('Boundary conditions — exact thresholds', () => {
    it('User_Count = 25000 does NOT trigger (strictly greater required)', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 25000,
        growth_rate: 0.10,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(false);
    });

    it('User_Count = 25001 triggers', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 25001,
        growth_rate: 0.10,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.trigger_reason).toContain('User_Count');
    });

    it('Growth_Rate = 0.30 does NOT trigger (strictly greater required)', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 20000,
        growth_rate: 0.30,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(false);
    });

    it('Growth_Rate = 0.3001 triggers', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 20000,
        growth_rate: 0.3001,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.trigger_reason).toContain('Growth_Rate');
    });
  });

  describe('Actions when triggered', () => {
    it('produces all 3 SOP-3 actions when triggered', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 31000,
        growth_rate: 0.10,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.actions).toHaveLength(3);
      // Check actions contain the required elements
      const actionsText = result.actions.join(' ');
      expect(actionsText).toContain('過站不停');
      expect(actionsText).toContain('shuttle');
      expect(actionsText).toContain('BS_MRT_BL18');
    });

    it('produces no actions when not triggered', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 20000,
        growth_rate: 0.20,
      };

      const result = evaluateArticle3(input);

      expect(result.actions).toEqual([]);
    });
  });

  describe('Failure cases — missing readings', () => {
    it('returns insufficient_data when both readings are null', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: null,
        growth_rate: null,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(false);
      expect(result.data_status).toBe('insufficient_data');
      expect(result.actions).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([]);
    });

    it('triggers if user_count is null but growth_rate exceeds threshold', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: null,
        growth_rate: 0.50,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.data_status).toBe('ready');
      expect(result.trigger_reason).toContain('Growth_Rate');
    });

    it('triggers if growth_rate is null but user_count exceeds threshold', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 30000,
        growth_rate: null,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(true);
      expect(result.data_status).toBe('ready');
      expect(result.trigger_reason).toContain('User_Count');
    });

    it('reports insufficient_data when user_count is unknown and known growth_rate is non-triggering', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: null,
        growth_rate: 0.30,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(false);
      expect(result.data_status).toBe('insufficient_data');
    });

    it('reports insufficient_data when growth_rate is unknown and known user_count is non-triggering', () => {
      const input: Article3Input = {
        bs_id: ARTICLE3_STATION_ID,
        user_count: 25000,
        growth_rate: null,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(false);
      expect(result.data_status).toBe('insufficient_data');
    });
  });

  describe('Non-BL17 station', () => {
    it('returns not triggered for a different station', () => {
      const input: Article3Input = {
        bs_id: 'BS_TPE_DOME',
        user_count: 50000,
        growth_rate: 0.90,
      };

      const result = evaluateArticle3(input);

      expect(result.triggered).toBe(false);
      expect(result.data_status).toBe('ready');
      expect(result.actions).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([]);
    });
  });

  describe('Constants', () => {
    it('ARTICLE3_STATION_ID is BS_MRT_BL17', () => {
      expect(ARTICLE3_STATION_ID).toBe('BS_MRT_BL17');
    });

    it('ARTICLE3_WALK_TARGET is BS_MRT_BL18', () => {
      expect(ARTICLE3_WALK_TARGET).toBe('BS_MRT_BL18');
    });

    it('GROWTH_RATE_THRESHOLD is 0.30', () => {
      expect(GROWTH_RATE_THRESHOLD).toBe(0.30);
    });

    it('USER_COUNT_THRESHOLD is 25000', () => {
      expect(USER_COUNT_THRESHOLD).toBe(25000);
    });
  });
});
