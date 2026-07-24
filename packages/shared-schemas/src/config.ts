/**
 * 設定型別
 *
 * 定義三種環境設定檔共用的設定 schema。
 *
 * @module shared-schemas/config
 */

/** 環境設定檔 */
export type EnvironmentProfile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

/** 設定 key namespace */
export interface ConfigSchema {
  // ── 環境 ──
  /** 環境設定檔 */
  readonly env: EnvironmentProfile;

  // ── Bedrock ──
  readonly bedrock: {
    readonly region: string;
    readonly model_id: string;
    readonly model_id_fallbacks: readonly string[];
    readonly embedding_model_id: string;
  };

  // ── Knowledge Base ──
  readonly kb: {
    readonly knowledge_base_id: string;
    readonly data_source_bucket: string;
  };

  // ── S3 ──
  readonly s3: {
    readonly raw_bucket: string;
    readonly sop_source_bucket: string;
    readonly artifact_bucket: string;
  };

  // ── API ──
  readonly api: {
    readonly endpoint: string;
  };

  // ── WebSocket ──
  readonly ws: {
    readonly endpoint: string;
  };

  // ── Auth ──
  readonly auth: {
    readonly user_pool_id: string;
    readonly app_client_id: string;
  };

  // ── Observability ──
  readonly observability: {
    readonly xray_enabled: boolean;
  };

  // ── Orchestration ──
  readonly orchestration: {
    /** stepfunctions | lambda_direct */
    readonly mode: 'stepfunctions' | 'lambda_direct';
  };

  // ── Enrichment ──
  readonly enrichment: {
    /** stepfunctions | eventbridge */
    readonly fanout: 'stepfunctions' | 'eventbridge';
  };

  // ── Frontend ──
  readonly frontend: {
    /** amplify | s3_cloudfront */
    readonly hosting: 'amplify' | 's3_cloudfront';
  };

  // ── Config Provider ──
  readonly config: {
    /** local_file | ssm */
    readonly provider: 'local_file' | 'ssm';
  };

  // ── Policy knobs (PROVISIONAL) ──
  readonly policy: StrategyConfig;
}

/** 策略設定 (OQ-001~011 的暫定方案) */
export interface StrategyConfig {
  /** Strategy A: 事件時間對齊 (OQ-001) */
  readonly time_alignment: {
    /** exact_or_latest_prior | linear_interpolation */
    readonly mode: 'exact_or_latest_prior' | 'linear_interpolation';
    /** 最大允許延遲 (分鐘) */
    readonly max_staleness_minutes: number;
  };

  /** Strategy B: affected_road 用途 (OQ-002) */
  readonly affected_road: {
    /** ignore | include_in_sop3 | include_in_eta */
    readonly role: 'ignore' | 'include_in_sop3' | 'include_in_eta';
  };

  /** Strategy C: ETE 受影響路段集合 (OQ-003) */
  readonly ete: {
    /** incident_only | incident_plus_alternatives | all_adjacent */
    readonly affected_set: 'incident_only' | 'incident_plus_alternatives' | 'all_adjacent';
  };

  /** Strategy D: 事故錨點解析 (OQ-004) */
  readonly incident_anchor: {
    /** llm_parse | keyword_match | manual */
    readonly mode: 'llm_parse' | 'keyword_match' | 'manual';
  };

  /** Strategy E: SOP5 受影響路口範圍 (OQ-010) */
  readonly affected_intersection_scope: {
    /** all_intersections | direct_only */
    readonly mode: 'all_intersections' | 'direct_only';
  };

  /** Strategy F: SOP6 「任一基地台」範圍 (OQ-005) */
  readonly multilingual_scope: {
    /** all_stations | event_area | time_snapshot */
    readonly mode: 'all_stations' | 'event_area' | 'time_snapshot';
  };
}
