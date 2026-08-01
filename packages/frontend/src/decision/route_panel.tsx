/**
 * Evacuation Route Panel (§10.8, §10.8a, §11.5, §11.7, §16, R6/R13; TASK-130)
 *
 * Renders the SOP-2 route decision: the selected primary evacuation, the
 * secondary routes, every excluded candidate with the reason it was excluded,
 * the Strategy-D incident anchor the upstream/downstream judgement rests on, and
 * the congestion disposition when the selected primary is already congested.
 *
 * Deterministic boundary (§9), which is the whole point of this panel:
 *
 * - the primary is the backend's selection. This panel never re-ranks: an
 *   excluded candidate with a *lower* `saturation_at_snapshot` than the primary
 *   is still shown as excluded, in the order the backend sent it.
 * - the three art.2 qualification conditions are shown as the backend evaluated
 *   them. Nothing here compares `capacity_vph` to 1000, checks an intersection
 *   list, or derives upstream from geometry — and saturation is never treated as
 *   a fourth filter (§11.7 hard boundary).
 * - the「維持壅塞主疏散 + 長綠燈 + 併行大眾運輸」disposition is displayed only
 *   when the backend supplies it. It is never inferred from
 *   `saturation_at_snapshot >= 0.85` on the client; the live payload does not
 *   carry it yet, so the panel discloses the gap instead (see `route_model.ts`).
 * - an unresolved anchor (§11.5) renders `manual_confirmation_required`, no
 *   primary, and the `unranked_direct_intersections` list as *unranked*. No
 *   primary is fabricated and no ordering is implied.
 * - an excluded candidate without a reason is surfaced as an R13.3 contract
 *   breach, never hidden and never given an invented reason.
 *
 * @module frontend/decision/route_panel
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
  idListText,
  numberText,
  textOrUnavailable,
} from './decision_display.js';
import { anchorPrimaryConflict, anchorUnresolved } from './route_model.js';
import type {
  CongestionDispositionView,
  IncidentAnchorView,
  RouteCandidateView,
  RouteView,
} from './route_model.js';
import type { DecisionReadModelState } from './use_decision_read_model.js';
import type { RouteViewResult } from './use_route_view.js';

// ─── Selection (R6.4 / R6.5 / §11.5) ─────────────────────────

function SelectionSection({ routes }: { readonly routes: RouteView }): ReactNode {
  const unresolved = anchorUnresolved(routes);

  return (
    <section className="route-panel__section" aria-labelledby="route-selection-heading">
      <h4 id="route-selection-heading" className="route-panel__subheading">
        選定疏散路徑 <DeterministicBadge />
      </h4>
      <FieldList>
        <FieldRow
          label="主疏散路徑"
          marker={<ProvisionalBadge>Strategy A/D 相依</ProvisionalBadge>}
        >
          <span data-testid="route-primary">
            {routes.primaryEvacuation === null
              ? unresolved
                ? '未選定（事故錨點無法唯一解析，§11.5 禁止選定主疏散）'
                : '未選定'
              : routes.primaryEvacuation}
          </span>
        </FieldRow>
        <FieldRow
          label="次要疏散路徑（下游相交幹道）"
          marker={<ProvisionalBadge>Strategy A/D 相依</ProvisionalBadge>}
        >
          <span data-testid="route-secondary">{idListText(routes.secondaryEvacuation)}</span>
        </FieldRow>
        <FieldRow label="主疏散路段快照飽和度">
          {/*
            `saturation_at_snapshot` is carried on each RouteCandidate, and the
            live core only persists the *excluded* candidates — so the selected
            primary's own reading is absent from the wire. It is disclosed, not
            reconstructed from the ETE snapshot (a different time basis).
          */}
          {NOT_SUPPLIED}
        </FieldRow>
      </FieldList>
      {routes.primaryEvacuation === null && !unresolved ? (
        <EmptyState
          message={
            routes.noCandidateNote ??
            '後端未選定主疏散路徑，且未提供 no_candidate_note（R6.8 要求載明查無合規替代路段）'
          }
        />
      ) : null}
      {routes.noCandidateNote !== null ? (
        <p className="route-panel__note" data-testid="route-no-candidate-note">
          後端載明：{routes.noCandidateNote}
        </p>
      ) : null}
      <p className="route-panel__note">
        主疏散為後端 EvacuationSelector 於合格候選中取最低 Saturation_Score
        之結果；前端僅呈現，不重新排序、不重新篩選（§9、§11.7）。
      </p>
    </section>
  );
}

// ─── Incident Anchor (§10.8a, §11.5, P30) ────────────────────

function AnchorSection({ anchor }: { readonly anchor: IncidentAnchorView | null }): ReactNode {
  return (
    <section className="route-panel__section" aria-labelledby="route-anchor-heading">
      <h4 id="route-anchor-heading" className="route-panel__subheading">
        事故錨點解析（Strategy D） <ProvisionalBadge />
      </h4>
      {anchor === null ? (
        <NotSuppliedNote message="後端未提供 core.incident_anchor（設計 §10.8a 欄位）；上/下游判定依據無法揭露，前端不自行推定方位。" />
      ) : (
        <>
          <FieldList>
            <FieldRow label="受影響幹道">{textOrUnavailable(anchor.affectedRoad)}</FieldRow>
            <FieldRow label="錨定路口">{textOrUnavailable(anchor.anchorIntersection)}</FieldRow>
            <FieldRow label="錨點索引（intersections）">{numberText(anchor.anchorIndex)}</FieldRow>
            <FieldRow label="行進方向（flow_direction）">
              {textOrUnavailable(anchor.travelDirection)}
            </FieldRow>
            <FieldRow label="相對路口方位">
              {textOrUnavailable(anchor.positionRelativeToIntersection)}
            </FieldRow>
            <FieldRow label="解析信心">{textOrUnavailable(anchor.resolutionConfidence)}</FieldRow>
            <FieldRow label="location 原文佐證">
              {textOrUnavailable(anchor.sourceEvidence)}
            </FieldRow>
            <FieldRow label="需人工確認">
              <span data-testid="route-anchor-manual-confirmation">
                {booleanText(anchor.manualConfirmationRequired)}
              </span>
            </FieldRow>
            <FieldRow label="暫定政策標記">{booleanText(anchor.provisional)}</FieldRow>
          </FieldList>

          {anchor.manualConfirmationRequired === true ? (
            <>
              <ManualConfirmationNotice message="事故錨點無法由 location 文字唯一解析；依 §11.5 不選定主疏散、不對直接相交路口自動排名，需人工確認錨點後再定案。" />
              <h5 className="route-panel__subheading">
                未排名之直接相交幹道（unranked_direct_intersections）
              </h5>
              {anchor.unrankedDirectIntersections.length === 0 ? (
                <EmptyState message="後端未提供任何未排名之直接相交幹道" />
              ) : (
                <ul className="route-panel__unranked" data-testid="route-unranked-list">
                  {anchor.unrankedDirectIntersections.map((segmentId) => (
                    <li
                      key={segmentId}
                      className="route-panel__unranked-item"
                      data-unranked-segment={segmentId}
                    >
                      {segmentId}
                    </li>
                  ))}
                </ul>
              )}
              <p className="route-panel__note">
                以上清單刻意未排名，呈現順序不代表優先序，亦不代表上游或下游（§11.5、P30）。
              </p>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

// ─── Congestion Disposition (§11.7, R6.6) ────────────────────

function CongestionSection({
  congestion,
}: {
  readonly congestion: CongestionDispositionView | null;
}): ReactNode {
  return (
    <section className="route-panel__section" aria-labelledby="route-congestion-heading">
      <h4 id="route-congestion-heading" className="route-panel__subheading">
        壅塞主疏散處置（SOP 第 2 條、§11.7） <DeterministicBadge />
      </h4>
      {congestion === null ? (
        <NotSuppliedNote message="後端未提供壅塞處置欄位（primary_congested / long_green_timing_for_primary / public_transit_recommended / congestion_note）；前端不得以 Saturation ≥ 0.85 自行判定，故不顯示任何處置結論。" />
      ) : (
        <>
          <FieldList>
            <FieldRow label="主疏散是否已壅塞（後端判定）">
              <span data-testid="route-primary-congested">
                {booleanText(congestion.primaryCongested)}
              </span>
            </FieldRow>
            <FieldRow label="維持該主疏散路徑">
              {/*
                §11.7: a congested primary is maintained, never discarded. The
                backend expresses that by keeping `primary_evacuation` while
                flagging congestion; this row restates that fact and derives
                nothing.
              */}
              <span data-testid="route-maintain-primary">
                {congestion.primaryCongested === null
                  ? NOT_SUPPLIED
                  : congestion.primaryCongested
                    ? '維持（壅塞不改道，依 SOP 第 2 條）'
                    : '無壅塞處置需求'}
              </span>
            </FieldRow>
            <FieldRow label="啟動長綠燈時制">
              <span data-testid="route-long-green">
                {booleanText(congestion.longGreenTimingForPrimary)}
              </span>
            </FieldRow>
            <FieldRow label="建議併行大眾運輸">
              <span data-testid="route-public-transit">
                {booleanText(congestion.publicTransitRecommended)}
              </span>
            </FieldRow>
            <FieldRow label="壅塞註記">{textOrUnavailable(congestion.congestionNote)}</FieldRow>
          </FieldList>
          <p className="route-panel__note">
            以上處置為後端規則引擎之結論（OQ-008 `PARTIALLY_DEFINED` 暫定調和）；飽和度不作為第 2
            條第四道硬性篩選。
          </p>
        </>
      )}
    </section>
  );
}

// ─── Excluded Candidates (R13.3) ─────────────────────────────

function ExcludedSection({
  candidates,
  reasonlessExclusions,
}: {
  readonly candidates: readonly RouteCandidateView[];
  readonly reasonlessExclusions: readonly string[];
}): ReactNode {
  return (
    <section className="route-panel__section" aria-labelledby="route-excluded-heading">
      <h4 id="route-excluded-heading" className="route-panel__subheading">
        排除之候選路段與理由 <DeterministicBadge />
      </h4>
      {candidates.length === 0 ? (
        <EmptyState message="後端未提供任何被排除之候選路段" />
      ) : (
        <table className="route-panel__table" data-testid="route-excluded-table">
          <caption className="route-panel__table-caption">
            資格為三項 AND（capacity_vph ≥
            1000、直接相交、位於事故點上游）；下列旗標與理由皆由後端判定，
            前端不重算門檻、不依飽和度重新排序
          </caption>
          <thead>
            <tr>
              <th scope="col">路段</th>
              <th scope="col">角色</th>
              <th scope="col">capacity_vph</th>
              <th scope="col">通過容量條件</th>
              <th scope="col">直接相交</th>
              <th scope="col">上游／下游</th>
              <th scope="col">快照飽和度</th>
              <th scope="col">排除理由</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.segmentId} data-excluded-candidate={candidate.segmentId}>
                <th scope="row">{candidate.segmentId}</th>
                <td>{textOrUnavailable(candidate.role)}</td>
                <td>{numberText(candidate.capacityVph)}</td>
                <td>{booleanText(candidate.passesCapacity)}</td>
                <td>{booleanText(candidate.isDirectIntersection)}</td>
                <td>{textOrUnavailable(candidate.upstreamOrDownstream)}</td>
                <td data-testid={`route-saturation-${candidate.segmentId}`}>
                  {numberText(candidate.saturationAtSnapshot)}
                </td>
                <td data-testid={`route-exclusion-reason-${candidate.segmentId}`}>
                  {candidate.exclusionReason ?? '後端未提供排除理由（違反 R13.3 非空理由保證）'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {reasonlessExclusions.length > 0 ? (
        <DataContractWarning
          message={`以下被排除候選缺少非空 exclusion_reason：${idListText(
            reasonlessExclusions,
          )}（R13.3 要求逐一載明排除理由）`}
        />
      ) : null}
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface RoutePanelProps {
  readonly decision: DecisionReadModelState;
  /** Decoded route blocks, from {@link useRouteView}. */
  readonly routes: RouteViewResult;
  /** Retries the initial (non-background) read. */
  readonly onRetry: () => void;
}

/**
 * Evacuation route panel (TASK-130).
 *
 * State → UI mapping:
 * - `idle` → explicit "no decision identified yet"
 * - `loading` → {@link LoadingIndicator}
 * - `error` → {@link ErrorState} plus a retry control
 * - `insufficient_data` → the backend STOP: no core, so no route decision
 * - `ready` / `partial` → the deterministic route decision (route facts are
 *   deterministic, so `partial` — pending AI text — changes nothing here)
 * - background refresh in flight → a refreshing notice over existing content
 * - background refresh failed → a degraded/stale notice; content is preserved
 * - a malformed route block → a data-contract error, never an empty route list
 */
export function RoutePanel({ decision, routes, onRetry }: RoutePanelProps): ReactNode {
  const { state, error, core } = decision;

  if (state === 'idle') {
    return (
      <div className="route-panel">
        <EmptyState message="尚未有決策可顯示疏散路徑（等待事件注入或即時事件）" />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="route-panel">
        <LoadingIndicator label="載入疏散路徑決策中" />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="route-panel">
        <ErrorState
          message={error === null ? '疏散路徑讀取失敗' : `疏散路徑讀取失敗：${error.message}`}
        />
        <button type="button" className="route-panel__retry" onClick={onRetry}>
          重試
        </button>
      </div>
    );
  }

  if (state === 'insufficient_data' || core === null) {
    return (
      <div className="route-panel">
        <h3 className="route-panel__heading">疏散路徑與排除理由（SOP 第 2 條）</h3>
        <InsufficientDataState message="尚無已提交的決策核心，不顯示任何疏散路徑或候選排序" />
      </div>
    );
  }

  return (
    <div className="route-panel">
      <h3 className="route-panel__heading">疏散路徑與排除理由（SOP 第 2 條）</h3>

      <div className="route-panel__status" role="status" aria-live="polite">
        {decision.refreshStatus === 'refreshing' ? '背景更新中…' : null}
        {decision.refreshStatus === 'idle' && error !== null
          ? `背景更新失敗：${error.message}（資料可能過時，顯示上次成功的讀取結果）`
          : null}
      </div>

      {decision.provisional === true ? (
        <ProvisionalBadge>
          路徑事實依賴暫定政策（Strategy A 時間對齊 / Strategy D 錨點解析），非官方標準答案
        </ProvisionalBadge>
      ) : null}

      {routes.kind === 'error' ? (
        <DataContractWarning
          message={`core 路徑區塊無法解析（${routes.error.code}）：${routes.error.message}。不以空白候選清單呈現。`}
        />
      ) : routes.kind === 'absent' ? (
        <InsufficientDataState message="無決策核心，故無疏散路徑決策" />
      ) : (
        <>
          {anchorPrimaryConflict(routes.routes) ? (
            <DataContractWarning message="後端同時回報 incident_anchor.manual_confirmation_required=true 與非空 primary_evacuation；§11.5 規定二者互斥，此為資料合約異常，所示主疏散不得視為有效選定。" />
          ) : null}
          <SelectionSection routes={routes.routes} />
          <AnchorSection anchor={routes.routes.incidentAnchor} />
          <CongestionSection congestion={routes.routes.congestion} />
          <ExcludedSection
            candidates={routes.routes.excludedCandidates}
            reasonlessExclusions={routes.routes.reasonlessExclusions}
          />
        </>
      )}
    </div>
  );
}
