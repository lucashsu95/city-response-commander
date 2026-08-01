/**
 * Demo Timeseries Panel
 *
 * Renders the raw `/demo/timeseries` projection in three vertical blocks:
 * - timeline: the list of timestamps (the demo backend sometimes returns
 *   duplicate timestamps — they are kept verbatim, never deduplicated)
 * - traffic: each road segment's reading (`Segment_ID`, road name, average
 *   speed, vehicle count, saturation score, lane status)
 * - crowd: each base station's reading (`BS_ID`, location, user count, stay
 *   time, growth rate, roaming percentages)
 *
 * Every value displayed is taken verbatim from the backend payload. The
 * panel never computes a level, threshold, classification, A/B verdict, ETE,
 * or rate — anything not present in the demo response is shown as the
 * `null` placeholder reserved for "後端未提供".
 *
 * @module frontend/demo/demo_timeseries_panel
 */

import type { ReactNode } from 'react';
import type { DemoTimeseriesResponse } from '../api/demo_api_adapter.js';

export interface DemoTimeseriesPanelProps {
  readonly snapshot: DemoTimeseriesResponse | null;
  readonly onRetry?: () => void;
  readonly errorMessage?: string | null;
  readonly loading?: boolean;
}

export function DemoTimeseriesPanel({
  snapshot,
  onRetry,
  errorMessage,
  loading,
}: DemoTimeseriesPanelProps): ReactNode {
  if (snapshot === null) {
    return (
      <div className="demo-timeseries-panel" data-testid="demo-timeseries-panel">
        <h3 className="demo-timeseries-panel__title">Demo /demo/timeseries</h3>
        {loading ? (
          <p>載入中…</p>
        ) : (
          <p>
            尚未取得 demo 時序資料。
            {errorMessage === null ? null : <small>（{errorMessage}）</small>}
          </p>
        )}
        {onRetry !== undefined && (
          <button type="button" onClick={onRetry}>
            重試
          </button>
        )}
      </div>
    );
  }
  const { timeline, traffic, crowd, stations, data_status: dataStatus } = snapshot;
  return (
    <div className="demo-timeseries-panel" data-testid="demo-timeseries-panel">
      <h3 className="demo-timeseries-panel__title">Demo /demo/timeseries</h3>
      <p className="demo-timeseries-panel__status">
        data_status：<code>{dataStatus}</code> ｜ 後端 stations：{stations.length} 個
      </p>

      <section className="demo-timeseries-panel__section" data-testid="demo-timeline-section">
        <h4>timeline</h4>
        <ul>
          {timeline.map((timestamp, idx) => (
            <li key={`${timestamp}-${idx}`}>
              <code>{timestamp}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="demo-timeseries-panel__section" data-testid="demo-traffic-section">
        <h4>traffic（{traffic.length} 筆）</h4>
        <table>
          <thead>
            <tr>
              <th>timestamp_raw</th>
              <th>Segment_ID</th>
              <th>Road_Name</th>
              <th>Avg_Speed</th>
              <th>Vehicle_Count</th>
              <th>Saturation_Score</th>
              <th>Lane_Status</th>
            </tr>
          </thead>
          <tbody>
            {traffic.map((row) => (
              <tr key={`${row.timestamp_raw}-${row.Segment_ID}`}>
                <td>
                  <code>{row.timestamp_raw}</code>
                </td>
                <td>
                  <code>{row.Segment_ID}</code>
                </td>
                <td>{row.Road_Name}</td>
                <td>{row.Avg_Speed}</td>
                <td>{row.Vehicle_Count}</td>
                <td>{row.Saturation_Score}</td>
                <td>{row.Lane_Status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="demo-timeseries-panel__section" data-testid="demo-crowd-section">
        <h4>crowd（{crowd.length} 筆）</h4>
        <table>
          <thead>
            <tr>
              <th>timestamp_raw</th>
              <th>BS_ID</th>
              <th>Location_Name</th>
              <th>User_Count</th>
              <th>Growth_Rate</th>
              <th>Roaming_User_Pct</th>
            </tr>
          </thead>
          <tbody>
            {crowd.map((row) => (
              <tr key={`${row.timestamp_raw}-${row.BS_ID}`}>
                <td>
                  <code>{row.timestamp_raw}</code>
                </td>
                <td>
                  <code>{row.BS_ID}</code>
                </td>
                <td>{row.Location_Name}</td>
                <td>{row.User_Count}</td>
                <td>{row.Growth_Rate}</td>
                <td>
                  <code>{row.Roaming_User_Pct}</code>（{row.roaming_pct_value}）
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
