/**
 * ETE Panel (§10.9, §11.3, §11.4, §16, R12/R13.8/R13.9; TASK-131)
 *
 * Renders the預計恢復時間 and — the point of the panel — its *complete* basis:
 * the event timestamp, the decision cutoff, the one exact snapshot timestamp
 * shared by the whole affected road set, each road's role and
 * `Saturation_Score`, the formula operands, the substituted art.7 formula, the
 * calculation status, and the HG-001 organizer-guidance provenance.
 *
 * Deterministic boundary (§9, R12), enforced by construction:
 *
 * - every number is a backend field. This panel performs no arithmetic: it does
 *   not divide the sum by the count, does not evaluate
 *   `max(0, (avg - 0.5) * 60)`, and does not add base clearance to the penalty.
 *   The substitution block writes the backend's own operands into the formula
 *   text (see `eteSubstitution`), which is why a missing operand shows as "not
 *   supplied" beside a supplied result instead of being back-computed.
 * - `road_count` is displayed only if supplied. The length of `affected_set` is
 *   not offered as a substitute, because that would be the frontend deriving a
 *   formula operand.
 * - when `calculation_status` reports `INSUFFICIENT_COMMON_SNAPSHOT`, **no ETE
 *   number is rendered anywhere**: no value, no substitution, and the lower
 *   bound is labelled as a lower bound that is explicitly not an ETE
 *   (R12.8 / R13.9).
 * - the organizer-guided policy is disclosed as `ORGANIZER_GUIDED_TEAM_POLICY`,
 *   `NON_UNIQUE`, `CONFIGURABLE` and `DETERMINISTIC_AND_REPRODUCIBLE`. The
 *   78.6-minute ACC_001 result is never presented as an official, host-mandated
 *   unique answer: HG-001 is written implementation guidance, not an SOP
 *   amendment and not an eighth official runtime source.
 *
 * @module frontend/decision/ete_panel
 */

import type { ReactNode } from 'react';
import {
  EmptyState,
  ErrorState,
  InsufficientDataState,
  LoadingIndicator,
} from '../components/system/async_state.js';
import {
  DataContractWarning,
  DeterministicBadge,
  FieldList,
  FieldRow,
  ManualConfirmationNotice,
  NOT_SUPPLIED,
  NotSuppliedNote,
  ProvisionalBadge,
  booleanText,
  numberText,
  textOrUnavailable,
} from './decision_display.js';
import type { DecisionCoreView } from './decision_read_model.js';
import type { AffectedSetConstructionView } from './evidence_model.js';
import {
  eteSubstitution,
  isInsufficientCommonSnapshot,
  resolveAffectedRoles,
} from './ete_model.js';
import type { AffectedRoleRow, EteSubstitution, EteView } from './ete_model.js';
import type { DecisionReadModelState } from './use_decision_read_model.js';
import type { EteViewResult } from './use_ete_view.js';

/**
 * HG-001 provenance, quoted from the design's amendment record (design §0
 * "HG-001 Organizer Guidance Amendment Record").
 *
 * These are documentation constants, not runtime data — they describe the
 * authority class of the guidance itself. The backend's own
 * `core.policy.guidance_id` is displayed beside them so the two can be
 * cross-checked rather than conflated.
 */
const HG001_RECORD = [
  ['guidance_id', 'HG-001'],
  ['guidance_date', '2026-07-24'],
  ['authority_class', 'ORGANIZER_WRITTEN_GUIDANCE'],
  ['implementation_uniqueness', 'NON_UNIQUE'],
  ['selected_policy_class', 'ORGANIZER_GUIDED_TEAM_POLICY'],
  ['runtime_official_source', 'false'],
  ['official_sop_amendment', 'false'],
  ['seven_source_manifest_member', 'false'],
] as const;

/** The four classifications tasks.md requires for the selected ETE policy. */
const SELECTED_POLICY_CLASSES = [
  'ORGANIZER_GUIDED_TEAM_POLICY',
  'NON_UNIQUE',
  'CONFIGURABLE',
  'DETERMINISTIC_AND_REPRODUCIBLE',
] as const;

function roleSourceText(row: AffectedRoleRow): string {
  switch (row.roleSource) {
    case 'ete.affected_set':
      return 'core.ete.affected_set';
    case 'evidence.affected_set_construction':
      return 'core.evidence.affected_set_construction';
    default:
      return NOT_SUPPLIED;
  }
}

// ─── Result (R12.1, R12.8) ───────────────────────────────────

function ResultSection({ ete }: { readonly ete: EteView }): ReactNode {
  const insufficient = isInsufficientCommonSnapshot(ete.calculationStatus);
  const noValue = ete.eteMinutes === null;

  return (
    <section className="ete-panel__section" aria-labelledby="ete-result-heading">
      <h4 id="ete-result-heading" className="ete-panel__subheading">
        ETE 結果 <DeterministicBadge />
      </h4>
      <FieldList>
        <FieldRow
          label="ETE（分鐘）"
          marker={<ProvisionalBadge>Strategy A/C 相依</ProvisionalBadge>}
        >
          <span data-testid="ete-value">
            {noValue
              ? insufficient
                ? '未計算（無共同 exact 快照，依規定不得顯示任何 ETE 數值）'
                : '未計算'
              : numberText(ete.eteMinutes)}
          </span>
        </FieldRow>
        <FieldRow label="計算狀態">
          <span data-testid="ete-calculation-status">
            {textOrUnavailable(ete.calculationStatus)}
          </span>
        </FieldRow>
        <FieldRow label="嚴重度（官方）">{textOrUnavailable(ete.severity)}</FieldRow>
        <FieldRow label="公式適用性">{textOrUnavailable(ete.formulaApplicability)}</FieldRow>
        <FieldRow label="僅下限（lower_bound_only）">{booleanText(ete.lowerBoundOnly)}</FieldRow>
        <FieldRow label="需人工確認">
          <span data-testid="ete-manual-confirmation">
            {booleanText(ete.manualConfirmationRequired)}
          </span>
        </FieldRow>
        <FieldRow label="依據說明">{textOrUnavailable(ete.basisNote)}</FieldRow>
      </FieldList>

      {noValue ? (
        <div className="ete-panel__lower-bound">
          <InsufficientDataState message="受影響路段集合無共同 exact 快照，禁止 partial-set average；僅呈現已知下限，不呈現任何 ETE 數值（§11.3、R12.8）。" />
          <FieldList>
            <FieldRow label="已知下限（分鐘，等於 base_clearance，非 ETE）">
              <span data-testid="ete-lower-bound">{numberText(ete.eteLowerBoundMinutes)}</span>
            </FieldRow>
          </FieldList>
          <p className="ete-panel__note" data-testid="ete-lower-bound-note">
            以上為由 severity 單獨可知之下限，<strong>不得</strong>當作 ETE 使用或對外發布。
          </p>
        </div>
      ) : null}

      {ete.manualConfirmationRequired === true ? (
        <ManualConfirmationNotice message="ETE 未完整計算，需人工確認後方可作為恢復時程依據。" />
      ) : null}
    </section>
  );
}

// ─── Timing Evidence (R13.8) ─────────────────────────────────

function TimingSection({
  ete,
  core,
}: {
  readonly ete: EteView;
  readonly core: DecisionCoreView;
}): ReactNode {
  return (
    <section className="ete-panel__section" aria-labelledby="ete-timing-heading">
      <h4 id="ete-timing-heading" className="ete-panel__subheading">
        時間依據 <ProvisionalBadge>Strategy A</ProvisionalBadge>
      </h4>
      <FieldList>
        <FieldRow label="事件時間（event timestamp）">
          <span data-testid="ete-event-timestamp">
            {ete.eventTimestamp ?? textOrUnavailable(core.occurredAt)}
          </span>
        </FieldRow>
        <FieldRow label="決策截止（decision cutoff）">
          <span data-testid="ete-decision-cutoff">
            {core.decisionCutoffTimestamp ?? NOT_SUPPLIED}
          </span>
        </FieldRow>
        <FieldRow label="ETE 共同 exact 快照時間">
          <span data-testid="ete-snapshot-timestamp">
            {ete.eteSnapshotTimestamp === null ? '無共同 exact 快照' : ete.eteSnapshotTimestamp}
          </span>
        </FieldRow>
        <FieldRow label="快照選取狀態">{textOrUnavailable(ete.snapshotSelectionStatus)}</FieldRow>
        <FieldRow label="快照模式（snapshot_mode）">
          {ete.snapshotMode ?? textOrUnavailable(core.policy?.eteSnapshotMode ?? null)}
        </FieldRow>
      </FieldList>
      <p className="ete-panel__note">
        共同快照時間為「小於或等於事件時間、且集合中每一路段皆有 exact
        紀錄」之最新時點；不得混用不同時間戳、不得插值、不得只平均可取得的子集合（§11.3、R12.7）。
      </p>
    </section>
  );
}

// ─── Affected Set + Roles (R12.4, R12.9) ─────────────────────

function AffectedSetSection({
  roles,
  roadCount,
}: {
  readonly roles: readonly AffectedRoleRow[];
  readonly roadCount: number | null;
}): ReactNode {
  const missingRoles = roles.filter((row) => row.role === null);

  return (
    <section className="ete-panel__section" aria-labelledby="ete-affected-heading">
      <h4 id="ete-affected-heading" className="ete-panel__subheading">
        受影響路段集合與角色 <ProvisionalBadge>Strategy C</ProvisionalBadge>
      </h4>
      {roles.length === 0 ? (
        <EmptyState message="後端未提供 ETE 受影響路段集合" />
      ) : (
        <table className="ete-panel__table" data-testid="ete-affected-set-table">
          <caption className="ete-panel__table-caption">
            集合由後端 Strategy C 以 `stable_unique([事故路段, 主疏散, 選定次要])`
            建立；角色取自後端欄位，前端不以集合順序推定角色
          </caption>
          <thead>
            <tr>
              <th scope="col">路段</th>
              <th scope="col">角色</th>
              <th scope="col">角色來源欄位</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((row) => (
              <tr key={row.segmentId} data-affected-road={row.segmentId}>
                <th scope="row">{row.segmentId}</th>
                <td data-testid={`ete-role-${row.segmentId}`}>{textOrUnavailable(row.role)}</td>
                <td>{roleSourceText(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <FieldList>
        <FieldRow label="road_count（後端提供之筆數）">
          <span data-testid="ete-road-count">{numberText(roadCount)}</span>
        </FieldRow>
      </FieldList>
      {roadCount === null ? (
        <NotSuppliedNote message="後端未提供 core.ete.road_count；前端不得以 affected_set 長度代算公式輸入之筆數。" />
      ) : null}
      {missingRoles.length > 0 ? (
        <NotSuppliedNote message="部分路段之角色（INCIDENT / PRIMARY / SECONDARY）未由後端提供；§11.3 的語意順序不作為角色證據，故不予推定。" />
      ) : null}
    </section>
  );
}

// ─── Per-Road Saturation Inputs (R12.9) ──────────────────────

function SaturationInputsSection({ ete }: { readonly ete: EteView }): ReactNode {
  const inputs = ete.saturationInputs;

  return (
    <section className="ete-panel__section" aria-labelledby="ete-inputs-heading">
      <h4 id="ete-inputs-heading" className="ete-panel__subheading">
        各路段 Saturation_Score 輸入 <DeterministicBadge />
      </h4>
      {inputs === null ? (
        <NotSuppliedNote message="後端未提供 core.ete.saturation_inputs（亦無 snapshot_provenance.readings）；前端不得由其他快照拼湊公式輸入。" />
      ) : inputs.length === 0 ? (
        <EmptyState message="後端提供了空的 Saturation_Score 輸入清單" />
      ) : (
        <table className="ete-panel__table" data-testid="ete-inputs-table">
          <caption className="ete-panel__table-caption">
            每筆讀值皆須落在同一共同 exact 快照時間；下列數值逐字呈現，前端不加總、不平均
          </caption>
          <thead>
            <tr>
              <th scope="col">路段</th>
              <th scope="col">角色</th>
              <th scope="col">Saturation_Score</th>
              <th scope="col">觀測時間戳</th>
            </tr>
          </thead>
          <tbody>
            {inputs.map((input, index) => (
              <tr
                key={`${input.segmentId ?? 'unknown'}-${index}`}
                data-input-road={input.segmentId ?? ''}
              >
                <th scope="row">{input.segmentId ?? NOT_SUPPLIED}</th>
                <td>{textOrUnavailable(input.role)}</td>
                <td data-testid={`ete-saturation-${input.segmentId ?? index}`}>
                  {numberText(input.saturation)}
                </td>
                <td>{textOrUnavailable(input.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── Formula Operands + Substitution (R12.9, §11.4) ──────────

function SubstitutionLine({
  label,
  line,
  testId,
}: {
  readonly label: string;
  readonly line: {
    readonly expression: string;
    readonly substituted: string;
    readonly result: string;
  };
  readonly testId: string;
}): ReactNode {
  return (
    <li className="ete-panel__formula-line" data-testid={testId}>
      <code className="ete-panel__formula-expression">{line.expression}</code>
      <span className="ete-panel__formula-substituted">
        {label}：{line.substituted} = {line.result}
      </span>
    </li>
  );
}

function FormulaSection({
  ete,
  substitution,
}: {
  readonly ete: EteView;
  readonly substitution: EteSubstitution | null;
}): ReactNode {
  return (
    <section className="ete-panel__section" aria-labelledby="ete-formula-heading">
      <h4 id="ete-formula-heading" className="ete-panel__subheading">
        公式輸入與代入（SOP 第 7 條） <DeterministicBadge />
      </h4>
      <FieldList>
        <FieldRow label="飽和度總和 saturation_sum">
          <span data-testid="ete-sum">{numberText(ete.saturationSum)}</span>
        </FieldRow>
        <FieldRow label="筆數 road_count">{numberText(ete.roadCount)}</FieldRow>
        <FieldRow label="平均飽和度 avg_saturation">
          <span data-testid="ete-average">{numberText(ete.avgSaturation)}</span>
        </FieldRow>
        <FieldRow label="基礎清除時間 base_clearance">
          <span data-testid="ete-base-clearance">{numberText(ete.baseClearance)}</span>
        </FieldRow>
        <FieldRow label="壅塞加乘 congestion_penalty">
          <span data-testid="ete-penalty">{numberText(ete.congestionPenalty)}</span>
        </FieldRow>
      </FieldList>

      {ete.saturationSum === null || ete.roadCount === null ? (
        <NotSuppliedNote message="後端未提供 saturation_sum／road_count；平均值由後端 avg_saturation 直接呈現，前端不得以各路段讀值自行加總或相除。" />
      ) : null}

      {substitution === null ? (
        <InsufficientDataState message="無可計算之 ETE，故不呈現任何公式代入結果（避免以下限或部分平均冒充 ETE）。" />
      ) : (
        <ol className="ete-panel__formula" data-testid="ete-formula-substitution">
          <SubstitutionLine
            label="代入"
            line={substitution.average}
            testId="ete-substitution-average"
          />
          <SubstitutionLine
            label="代入"
            line={substitution.penalty}
            testId="ete-substitution-penalty"
          />
          <SubstitutionLine label="代入" line={substitution.ete} testId="ete-substitution-ete" />
        </ol>
      )}
      <p className="ete-panel__note">
        以上代入之運算元與結果均為後端 `core.ete` 欄位，逐字呈現；前端不執行任何加減乘除（§9）。
      </p>
    </section>
  );
}

// ─── Organizer-Guidance Provenance (R12 notes, §31.2) ────────

function ProvenanceSection({
  ete,
  core,
}: {
  readonly ete: EteView;
  readonly core: DecisionCoreView;
}): ReactNode {
  return (
    <section className="ete-panel__section" aria-labelledby="ete-provenance-heading">
      <h4 id="ete-provenance-heading" className="ete-panel__subheading">
        政策來源與分類（HG-001） <ProvisionalBadge />
      </h4>

      <FieldList>
        <FieldRow label="ETE 受影響集合模式 policy_mode">
          <span data-testid="ete-policy-mode">
            {ete.policyMode ?? textOrUnavailable(core.policy?.eteAffectedSetMode ?? null)}
          </span>
        </FieldRow>
        <FieldRow label="快照模式 snapshot_mode">
          {ete.snapshotMode ?? textOrUnavailable(core.policy?.eteSnapshotMode ?? null)}
        </FieldRow>
        <FieldRow label="指引依據 guidance_id（core.ete）">
          {ete.guidanceId ?? NOT_SUPPLIED}
        </FieldRow>
        <FieldRow label="指引依據 guidance_id（core.policy）">
          {textOrUnavailable(core.policy?.guidanceId ?? null)}
        </FieldRow>
        <FieldRow label="政策分類（core.policy）">
          {textOrUnavailable(core.policy?.classification ?? null)}
        </FieldRow>
        <FieldRow label="政策狀態（core.policy）">
          {textOrUnavailable(core.policy?.status ?? null)}
        </FieldRow>
        <FieldRow label="是否官方規則 is_official">
          {booleanText(core.policy?.isOfficial ?? null)}
        </FieldRow>
        <FieldRow label="是否官方唯一規則 official_unique_rule">
          {core.policy?.officialUniqueRule === null || core.policy?.officialUniqueRule === undefined
            ? NOT_SUPPLIED
            : booleanText(core.policy.officialUniqueRule)}
        </FieldRow>
        <FieldRow label="是否可配置 configurable">
          {booleanText(core.policy?.configurable ?? null)}
        </FieldRow>
      </FieldList>

      <h5 className="ete-panel__subheading">選定政策之分類</h5>
      <ul className="ete-panel__policy-classes" data-testid="ete-policy-classes">
        {SELECTED_POLICY_CLASSES.map((label) => (
          <li key={label} className="ete-panel__policy-class">
            {label}
          </li>
        ))}
      </ul>

      <h5 className="ete-panel__subheading">HG-001 指引記錄（設計文件常數）</h5>
      <FieldList className="ete-panel__hg001">
        {HG001_RECORD.map(([field, value]) => (
          <FieldRow key={field} label={field}>
            {value}
          </FieldRow>
        ))}
      </FieldList>

      <p className="ete-panel__note" data-testid="ete-not-official-answer">
        主辦方<strong>未</strong>指定唯一 ETE 演算法。本系統採用之
        `INCIDENT_PRIMARY_AND_SELECTED_SECONDARY` 與 `COMMON_EXACT_TIMESTAMP`
        為團隊在主辦書面指引（HG-001）下選定之決定性、可重現、可配置政策； 依此政策所得之任何 ETE
        結果（含上方數值）
        <strong>不是</strong>官方指定之唯一標準答案，亦非 SOP 條文之修訂。
      </p>
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface EtePanelProps {
  readonly decision: DecisionReadModelState;
  /** Decoded `core.ete`, from {@link useEteView}. */
  readonly ete: EteViewResult;
  /**
   * `evidence.affected_set_construction`, when the backend supplied it: the
   * second authoritative source of an affected road's role (§10.10). Passed in
   * rather than re-decoded so the evidence block is decoded once per core.
   */
  readonly roleEvidence: readonly AffectedSetConstructionView[] | null;
  /** Retries the initial (non-background) read. */
  readonly onRetry: () => void;
}

/**
 * ETE panel (TASK-131).
 *
 * State → UI mapping:
 * - `idle` → explicit "no decision identified yet"
 * - `loading` → {@link LoadingIndicator}
 * - `error` → {@link ErrorState} plus a retry control
 * - `insufficient_data` → the backend STOP: no core, so no ETE
 * - core without an `ete` block → "not applicable to this event", never a zero
 * - `INSUFFICIENT_COMMON_SNAPSHOT` → lower bound + manual confirmation, and no
 *   ETE number anywhere
 * - `ready` / `partial` → the value with its full basis (ETE is deterministic,
 *   so pending AI text changes nothing here)
 * - background refresh in flight / failed → refreshing or degraded notice, with
 *   existing content preserved
 * - a malformed `ete` block → a data-contract error, never a blank basis
 */
export function EtePanel({ decision, ete, roleEvidence, onRetry }: EtePanelProps): ReactNode {
  const { state, error, core } = decision;

  if (state === 'idle') {
    return (
      <div className="ete-panel">
        <EmptyState message="尚未有決策可顯示 ETE（等待事件注入或即時事件）" />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="ete-panel">
        <LoadingIndicator label="載入 ETE 計算依據中" />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="ete-panel">
        <ErrorState message={error === null ? 'ETE 讀取失敗' : `ETE 讀取失敗：${error.message}`} />
        <button type="button" className="ete-panel__retry" onClick={onRetry}>
          重試
        </button>
      </div>
    );
  }

  if (state === 'insufficient_data' || core === null) {
    return (
      <div className="ete-panel">
        <h3 className="ete-panel__heading">預計恢復時間 ETE（SOP 第 7 條）</h3>
        <InsufficientDataState message="尚無已提交的決策核心，不顯示任何 ETE 或計算依據" />
      </div>
    );
  }

  return (
    <div className="ete-panel">
      <h3 className="ete-panel__heading">預計恢復時間 ETE（SOP 第 7 條）</h3>

      <div className="ete-panel__status" role="status" aria-live="polite">
        {decision.refreshStatus === 'refreshing' ? '背景更新中…' : null}
        {decision.refreshStatus === 'idle' && error !== null
          ? `背景更新失敗：${error.message}（資料可能過時，顯示上次成功的讀取結果）`
          : null}
      </div>

      {decision.provisional === true ? (
        <ProvisionalBadge>
          ETE 依賴暫定政策（Strategy A 時間對齊 / Strategy C 受影響集合與快照 / Strategy D
          錨點解析），非官方標準答案
        </ProvisionalBadge>
      ) : null}

      {ete.kind === 'error' ? (
        <DataContractWarning
          message={`core.ete 無法解析（${ete.error.code}）：${ete.error.message}。不以空白計算依據或 0 分鐘呈現。`}
        />
      ) : ete.kind === 'absent' ? (
        <InsufficientDataState message="無決策核心，故無 ETE" />
      ) : ete.kind === 'not_applicable' ? (
        <EmptyState message="本事件之決策核心未帶 core.ete（例如 BS_ 人流事件不適用 SOP 第 7 條）；不顯示任何恢復時間數值" />
      ) : (
        <>
          <ResultSection ete={ete.ete} />
          <TimingSection ete={ete.ete} core={core} />
          <AffectedSetSection
            roles={resolveAffectedRoles(ete.ete.affectedSet, roleEvidence)}
            roadCount={ete.ete.roadCount}
          />
          <SaturationInputsSection ete={ete.ete} />
          <FormulaSection ete={ete.ete} substitution={eteSubstitution(ete.ete, NOT_SUPPLIED)} />
          <ProvenanceSection ete={ete.ete} core={core} />
        </>
      )}
    </div>
  );
}
