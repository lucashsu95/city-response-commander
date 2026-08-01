/**
 * zh-TW Translation Bundle (TASK-134)
 *
 * Default locale. Every key here is fixed UI framing text only — entity IDs,
 * trace IDs, EvidenceTrace content, citations, and backend-provided decision
 * facts/numbers are never covered by this bundle; those panels interpolate
 * backend values directly regardless of the active locale.
 *
 * @module frontend/i18n/translations/zh-TW
 */

export const zhTW = {
  // ─── Shell ───────────────────────────────────────────────
  'shell.title': 'CHT City Response Commander｜城市應變指揮中心',
  'shell.footer': 'CHT City Response Commander｜城市應變指揮中心',
  'shell.languageSwitcher.label': '介面語言',

  // ─── Region Headings ─────────────────────────────────────
  'region.timeline.heading': '時間軸',
  'region.timeline.empty': '尚無可顯示的時間軸資料',
  'region.roads.heading': '路段車流',
  'region.roads.empty': '尚無可顯示的路段資料',
  'region.crowd.heading': '基地台人流',
  'region.crowd.empty': '尚無可顯示的基地台資料',
  'region.decision.heading': '決策指令',
  'region.decision.empty': '目前尚無可顯示的決策結果',
  'region.whatif.heading': 'What-if 假設情境',
  'region.whatif.empty': '尚無 What-if 假設情境',
  'region.map.heading': '事件態勢地圖',
  'region.map.empty': '尚無地圖資料',
  'region.injection.heading': '事件注入',
  'region.injection.empty': '尚無事件注入內容',

  // ─── Operational Status (§16.4) ─────────────────────────
  'status.region.label': '系統狀態',
  'status.fresh': '資料為最新',
  'status.stale': '資料已過時',
  'status.stale.withMinutes': '資料已過時 {minutes} 分鐘',
  'status.connection.websocket': '即時連線（WebSocket）',
  'status.connection.polling': '即時連線降級為輪詢',
  'status.connection.disconnected': '已斷線',
  'status.polling.error': '輪詢更新失敗：{message}',
  'status.polling.ok': '已完成 {count} 次輪詢更新',
  'status.provisional': '暫定政策',
  'status.manualConfirmation': '需人工確認',

  // ─── Generic Async States ───────────────────────────────
  'async.loading': '載入中',
  'async.error.unknown': '發生未知錯誤',
  'async.insufficient': '資料不足，無法完整顯示',
  'async.backgroundError': '背景更新失敗：{message}（顯示上次成功的資料）',
  'async.dataMayBeStale': '背景更新失敗：{message}（資料可能過時，顯示上次成功的讀取結果）',
  'async.executionMayBeStale':
    '背景更新失敗：{message}（執行狀態可能過時，顯示上次成功讀取的結果）',

  // ─── Common display labels ────────────────────────────────
  'common.unavailable': '尚無資料',
  'common.notProvided': '未提供',
  'common.yes': '是',
  'common.no': '否',
  'common.none': '無',

  // ─── Common Actions ──────────────────────────────────────
  'action.retry': '重試',
  'action.cancel': '取消',
  'action.confirm': '確認',
  'action.close': '關閉',

  // ─── Timeline Panel ──────────────────────────────────────
  'timeline.heading': '時間軸重播',
  'timeline.loading': '載入時間軸中',
  'timeline.errorFallback': '時間軸讀取失敗',
  'timeline.empty': '目前時間軸尚無可播放的時點',
  'timeline.currentLabel': '目前重播位置',
  'timeline.previous': '上一個',
  'timeline.previousAria': '上一個時點',
  'timeline.next': '下一個',
  'timeline.nextAria': '下一個時點',
  'timeline.selectLabel': '選擇時點',
  'timeline.selectedLabel': '已選時點：',
  'timeline.selectedPosition': '選擇位置 {position}',
  'timeline.currentPositionAria': '目前重播位置 {position}',
  'timeline.refreshing': '背景更新中…',
  'timeline.evidenceHeading': 'HG-001 時間證據',

  // ─── Road Panel ──────────────────────────────────────────
  'roads.heading': '路段車流',
  'roads.loading': '載入路段車流中',
  'roads.errorFallback': '路段車流讀取失敗',
  'roads.empty': '目前無可顯示的路段資料',
  'roads.insufficient': '資料不足，無法完整顯示路段車流（後端回報 insufficient_data）',
  'roads.levelA': 'A 級',
  'roads.levelB': 'B 級',
  'roads.levelNeutral': '未分級',
  'roads.refreshing': '背景更新中…',

  // ─── Crowd Panel ─────────────────────────────────────────
  'crowd.heading': '基地台人流與信令',
  'crowd.loading': '載入基地台人流中',
  'crowd.errorFallback': '基地台人流讀取失敗',
  'crowd.empty': '目前重播位置沒有可用的基地台觀測',
  'crowd.refreshing': '背景更新中…',

  // ─── Anomaly Popup ───────────────────────────────────────
  'anomaly.framingTitle': '偵測到異常',
  'anomaly.framingDescription': '請查看即時道路與人流警示',
  'anomaly.close': '關閉',

  // ─── Map ─────────────────────────────────────────────────
  'map.heading': '事件態勢地圖',
  'map.disclosure': '營運示意圖，非實際地理比例',
  'map.legendHeading': '圖例',
  'map.legendAria': '地圖圖例',
  'map.detailEmpty': '點選或以方向鍵選取地圖上的道路或基地台以查看詳細資訊。',
  'map.roadsLoading': '載入路段中',
  'map.crowdLoading': '載入基地台中',

  // ─── Decision: Report Panel ──────────────────────────────
  'report.heading': '交控中心建議書',
  'report.loading': '載入交控中心建議書中',
  'report.errorFallback': '建議書讀取失敗',
  'report.idle': '尚未有決策可產出建議書（等待事件注入或即時事件）',
  'report.refreshing': '背景更新中…',

  // ─── Decision: Public Alert Panel ────────────────────────
  'alert.heading': '多語民眾簡訊',
  'alert.loading': '載入多語民眾簡訊中',
  'alert.errorFallback': '民眾簡訊讀取失敗',
  'alert.idle': '尚未有決策可產出民眾簡訊（等待事件注入或即時事件）',
  'alert.refreshing': '背景更新中…',

  // ─── Decision: Route Panel ───────────────────────────────
  'route.heading': '疏散路徑與排除理由（SOP 第 2 條）',
  'route.loading': '載入疏散路徑決策中',
  'route.errorFallback': '疏散路徑讀取失敗',
  'route.idle': '尚未有決策可顯示疏散路徑（等待事件注入或即時事件）',
  'route.refreshing': '背景更新中…',

  // ─── Decision: ETE Panel ─────────────────────────────────
  'ete.heading': '預計恢復時間 ETE（SOP 第 7 條）',
  'ete.loading': '載入 ETE 計算依據中',
  'ete.errorFallback': 'ETE 讀取失敗',
  'ete.idle': '尚未有決策可顯示 ETE（等待事件注入或即時事件）',
  'ete.refreshing': '背景更新中…',

  // ─── Decision: Explanation Chain ─────────────────────────
  'explanation.heading': '決策推理與解釋鏈',
  'explanation.loading': '載入決策推理鏈中',
  'explanation.errorFallback': '推理鏈讀取失敗',
  'explanation.idle': '尚未有決策可顯示推理過程（等待事件注入或即時事件）',
  'explanation.refreshing': '背景更新中…',

  // ─── Decision: Execution Status ──────────────────────────
  'execution.heading': '執行狀態與失敗訊息',
  'execution.loading': '載入執行狀態中',
  'execution.refreshing': '背景更新中…',

  // ─── What-if Dialog ───────────────────────────────────────
  'whatif.heading': 'What-if 假設情境模擬',
  'whatif.submit': '準備詢問…',
  'whatif.confirmQuestion': '確認送出假設情境？此操作不會變更任何系統狀態。',
  'whatif.confirmYes': '確認詢問',
  'whatif.confirmNo': '取消',
  'whatif.loading': 'What-if 計算中',
  'whatif.reset': '重新輸入',
  'whatif.restart': '啟動新的假設情境',

  // ─── Injection Panel ──────────────────────────────────────
  'injection.heading': '事件注入（管理員）',
  'injection.submit': '準備注入…',
  'injection.confirmYes': '確認注入',
  'injection.confirmNo': '取消',
  'injection.submitting': '注入請求送出中…',
  'injection.retry': '重新嘗試送出',
  'injection.resetLabel': '重新輸入事件 ID',
  'injection.again': '注入其他事件',

  // ─── Admin Session ─────────────────────────────────────────
  'admin.heading': '管理員憑證',
  'admin.loadButton': '載入憑證',
  'admin.clearButton': '清除管理員憑證',
  'admin.statusLoaded': '目前狀態：已載入憑證',
  'admin.statusEmpty': '目前狀態：尚未載入憑證',

  // ─── Not Found Page ──────────────────────────────────────
  'notFound.title': '404 - 找不到頁面',
  'notFound.description': '您所尋找的頁面不存在或已被移除。',
  'notFound.link': '返回指揮台首頁',

  // ─── Configuration Error Screen ─────────────────────────
  'configError.title': '應用程式設定錯誤',
  'configError.description': '無法啟動應用程式，因為缺少或無效的環境設定。請聯繫系統管理員。',
  'configError.subtitle': '設定問題',
} as const;

export type ZhTWKeys = keyof typeof zhTW;
