/**
 * ja Translation Bundle (TASK-134)
 *
 * Fixed UI framing text only. Backend-provided decision facts, entity IDs,
 * trace IDs, EvidenceTrace content, and citations are never translated here.
 *
 * @module frontend/i18n/translations/ja
 */

import type { ZhTWKeys } from './zh-TW.js';

export const ja: Readonly<Record<ZhTWKeys, string>> = {
  // ─── Shell ───────────────────────────────────────────────
  'shell.title': 'CHT City Response Commander｜城市應變指揮中心',
  'shell.footer': 'CHT City Response Commander｜城市應變指揮中心',
  'shell.languageSwitcher.label': '表示言語',

  // ─── Region Headings ─────────────────────────────────────
  'region.timeline.heading': 'タイムライン',
  'region.timeline.empty': '表示できるタイムラインデータがありません',
  'region.roads.heading': '道路交通状況',
  'region.roads.empty': '表示できる道路データがありません',
  'region.crowd.heading': '基地局人流',
  'region.crowd.empty': '表示できる基地局データがありません',
  'region.decision.heading': '意思決定指令',
  'region.decision.empty': '現在表示できる決定結果はありません',
  'region.whatif.heading': 'What-if シナリオ',
  'region.whatif.empty': 'What-if シナリオはまだありません',
  'region.map.heading': '事態マップ',
  'region.map.empty': '地図データがありません',
  'region.injection.heading': 'インシデント投入',
  'region.injection.empty': 'インシデント投入の内容がありません',

  // ─── Operational Status (§16.4) ─────────────────────────
  'status.region.label': 'システム状態',
  'status.fresh': 'データは最新です',
  'status.stale': 'データが古くなっています',
  'status.stale.withMinutes': 'データが {minutes} 分前から更新されていません',
  'status.connection.websocket': 'リアルタイム接続（WebSocket）',
  'status.connection.polling': 'リアルタイム接続がポーリングに降格',
  'status.connection.disconnected': '接続切断',
  'status.polling.error': 'ポーリング更新に失敗：{message}',
  'status.polling.ok': 'ポーリング更新を {count} 回完了',
  'status.provisional': '暫定ポリシー',
  'status.manualConfirmation': '手動確認が必要',

  // ─── Generic Async States ───────────────────────────────
  'async.loading': '読み込み中',
  'async.error.unknown': '不明なエラーが発生しました',
  'async.insufficient': 'データ不足のため完全に表示できません',
  'async.backgroundError': 'バックグラウンド更新に失敗：{message}（前回成功したデータを表示）',
  'async.dataMayBeStale':
    'バックグラウンド更新に失敗：{message}（データが古い可能性があります。前回成功した結果を表示）',
  'async.executionMayBeStale':
    'バックグラウンド更新に失敗：{message}（実行状態が古い可能性があります。前回成功した結果を表示）',

  // ─── Common display labels ────────────────────────────────
  'common.unavailable': 'データなし',
  'common.notProvided': '未提供',
  'common.yes': 'はい',
  'common.no': 'いいえ',
  'common.none': 'なし',

  // ─── Common Actions ──────────────────────────────────────
  'action.retry': '再試行',
  'action.cancel': 'キャンセル',
  'action.confirm': '確認',
  'action.close': '閉じる',

  // ─── Timeline Panel ──────────────────────────────────────
  'timeline.heading': 'タイムライン再生',
  'timeline.loading': 'タイムラインを読み込み中',
  'timeline.errorFallback': 'タイムラインの読み込みに失敗しました',
  'timeline.empty': '現在再生可能な時点がありません',
  'timeline.currentLabel': '現在の再生位置',
  'timeline.previous': '前へ',
  'timeline.previousAria': '前の時点',
  'timeline.next': '次へ',
  'timeline.nextAria': '次の時点',
  'timeline.selectLabel': '時点を選択',
  'timeline.selectedLabel': '選択された時点：',
  'timeline.selectedPosition': '選択位置 {position}',
  'timeline.currentPositionAria': '現在の再生位置 {position}',
  'timeline.refreshing': '更新中…',
  'timeline.evidenceHeading': 'HG-001 時間的根拠',

  // ─── Road Panel ──────────────────────────────────────────
  'roads.heading': '道路交通状況',
  'roads.loading': '道路交通状況を読み込み中',
  'roads.errorFallback': '道路交通状況の読み込みに失敗しました',
  'roads.empty': '現在表示できる道路データがありません',
  'roads.insufficient': 'データ不足のため道路交通状況を完全に表示できません（insufficient_data）',
  'roads.levelA': 'レベル A',
  'roads.levelB': 'レベル B',
  'roads.levelNeutral': '未分類',
  'roads.refreshing': '更新中…',

  // ─── Crowd Panel ─────────────────────────────────────────
  'crowd.heading': '基地局人流・信号情報',
  'crowd.loading': '基地局人流を読み込み中',
  'crowd.errorFallback': '基地局人流の読み込みに失敗しました',
  'crowd.empty': '現在の再生位置で利用可能な基地局観測がありません',
  'crowd.refreshing': '更新中…',

  // ─── Anomaly Popup ───────────────────────────────────────
  'anomaly.framingTitle': '異常を検知しました',
  'anomaly.framingDescription': 'リアルタイムの道路・人流アラートをご確認ください',
  'anomaly.close': '閉じる',

  // ─── Map ─────────────────────────────────────────────────
  'map.heading': '事態マップ',
  'map.disclosure': '運用イメージ図（実際の地理縮尺ではありません）',
  'map.legendHeading': '凡例',
  'map.legendAria': '地図の凡例',
  'map.detailEmpty': '地図上の道路または基地局をクリックまたは矢印キーで選択して詳細を確認してください。',
  'map.roadsLoading': '地図の道路を読み込み中',
  'map.crowdLoading': '地図の基地局を読み込み中',

  // ─── Decision: Report Panel ──────────────────────────────
  'report.heading': '指揮センター報告書',
  'report.loading': '指揮センター報告書を読み込み中',
  'report.errorFallback': '報告書の読み込みに失敗しました',
  'report.idle': '報告書を生成する決定がまだありません（インシデント投入またはリアルタイムイベント待ち）',
  'report.refreshing': '更新中…',

  // ─── Decision: Public Alert Panel ────────────────────────
  'alert.heading': '多言語住民向けアラート',
  'alert.loading': '多言語住民向けアラートを読み込み中',
  'alert.errorFallback': '住民向けアラートの読み込みに失敗しました',
  'alert.idle': 'アラートを生成する決定がまだありません（インシデント投入またはリアルタイムイベント待ち）',
  'alert.refreshing': '更新中…',

  // ─── Decision: Route Panel ───────────────────────────────
  'route.heading': '避難経路と除外理由（SOP 第2条）',
  'route.loading': '避難経路の決定を読み込み中',
  'route.errorFallback': '避難経路の読み込みに失敗しました',
  'route.idle': '避難経路を表示する決定がまだありません（インシデント投入またはリアルタイムイベント待ち）',
  'route.refreshing': '更新中…',

  // ─── Decision: ETE Panel ─────────────────────────────────
  'ete.heading': '推定復旧時間 ETE（SOP 第7条）',
  'ete.loading': 'ETE 計算根拠を読み込み中',
  'ete.errorFallback': 'ETE の読み込みに失敗しました',
  'ete.idle': 'ETE を表示する決定がまだありません（インシデント投入またはリアルタイムイベント待ち）',
  'ete.refreshing': '更新中…',

  // ─── Decision: Explanation Chain ─────────────────────────
  'explanation.heading': '意思決定の推論と説明チェーン',
  'explanation.loading': '意思決定の推論チェーンを読み込み中',
  'explanation.errorFallback': '推論チェーンの読み込みに失敗しました',
  'explanation.idle': '推論過程を表示する決定がまだありません（インシデント投入またはリアルタイムイベント待ち）',
  'explanation.refreshing': '更新中…',

  // ─── Decision: Execution Status ──────────────────────────
  'execution.heading': '実行状態と失敗メッセージ',
  'execution.loading': '実行状態を読み込み中',
  'execution.refreshing': '更新中…',

  // ─── What-if Dialog ───────────────────────────────────────
  'whatif.heading': 'What-if シナリオシミュレーション',
  'whatif.submit': '質問を準備中…',
  'whatif.confirmQuestion': '仮定シナリオを送信しますか？この操作はシステム状態を変更しません。',
  'whatif.confirmYes': '質問を確認',
  'whatif.confirmNo': 'キャンセル',
  'whatif.loading': 'What-if 計算中',
  'whatif.reset': '再入力',
  'whatif.restart': '新しい What-if シナリオを開始',

  // ─── Injection Panel ──────────────────────────────────────
  'injection.heading': 'インシデント投入（管理者）',
  'injection.submit': '投入を準備中…',
  'injection.confirmYes': '投入を確認',
  'injection.confirmNo': 'キャンセル',
  'injection.submitting': '投入リクエストを送信中…',
  'injection.retry': '再送信を試みる',
  'injection.resetLabel': 'イベント ID を再入力',
  'injection.again': '別のイベントを投入',

  // ─── Admin Session ─────────────────────────────────────────
  'admin.heading': '管理者資格情報',
  'admin.loadButton': '資格情報を読み込む',
  'admin.clearButton': '管理者資格情報を消去',
  'admin.statusLoaded': '状態：資格情報を読み込み済み',
  'admin.statusEmpty': '状態：資格情報未読み込み',

  // ─── Not Found Page ──────────────────────────────────────
  'notFound.title': '404 - ページが見つかりません',
  'notFound.description': 'お探しのページは存在しないか、削除されました。',
  'notFound.link': '指揮台トップへ戻る',

  // ─── Configuration Error Screen ─────────────────────────
  'configError.title': 'アプリケーション設定エラー',
  'configError.description': '環境設定が不足または無効なため、アプリケーションを起動できません。システム管理者に連絡してください。',
  'configError.subtitle': '設定の問題',
};
