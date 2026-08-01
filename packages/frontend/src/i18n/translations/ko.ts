/**
 * ko Translation Bundle (TASK-134)
 *
 * Fixed UI framing text only. Backend-provided decision facts, entity IDs,
 * trace IDs, EvidenceTrace content, and citations are never translated here.
 *
 * @module frontend/i18n/translations/ko
 */

import type { ZhTWKeys } from './zh-TW.js';

export const ko: Readonly<Record<ZhTWKeys, string>> = {
  // ─── Shell ───────────────────────────────────────────────
  'shell.title': 'CHT City Response Commander｜城市應變指揮中心',
  'shell.footer': 'CHT City Response Commander｜城市應變指揮中心',
  'shell.languageSwitcher.label': '표시 언어',

  // ─── Region Headings ─────────────────────────────────────
  'region.timeline.heading': '타임라인',
  'region.timeline.empty': '표시할 타임라인 데이터가 없습니다',
  'region.roads.heading': '도로 교통 상황',
  'region.roads.empty': '표시할 도로 데이터가 없습니다',
  'region.crowd.heading': '기지국 유동인구',
  'region.crowd.empty': '표시할 기지국 데이터가 없습니다',
  'region.decision.heading': '의사결정 지휘',
  'region.decision.empty': '현재 표시할 결정 결과가 없습니다',
  'region.whatif.heading': 'What-if 가상 시나리오',
  'region.whatif.empty': '아직 What-if 시나리오가 없습니다',
  'region.map.heading': '상황 지도',
  'region.map.empty': '지도 데이터가 없습니다',
  'region.injection.heading': '사건 입력',
  'region.injection.empty': '사건 입력 내용이 없습니다',

  // ─── Operational Status (§16.4) ─────────────────────────
  'status.region.label': '시스템 상태',
  'status.fresh': '데이터가 최신입니다',
  'status.stale': '데이터가 오래되었습니다',
  'status.stale.withMinutes': '데이터가 {minutes}분 전부터 갱신되지 않았습니다',
  'status.connection.websocket': '실시간 연결（WebSocket）',
  'status.connection.polling': '실시간 연결이 폴링으로 전환됨',
  'status.connection.disconnected': '연결 끊김',
  'status.polling.error': '폴링 업데이트 실패：{message}',
  'status.polling.ok': '폴링 업데이트 {count}회 완료',
  'status.provisional': '임시 정책',
  'status.manualConfirmation': '수동 확인 필요',

  // ─── Generic Async States ───────────────────────────────
  'async.loading': '불러오는 중',
  'async.error.unknown': '알 수 없는 오류가 발생했습니다',
  'async.insufficient': '데이터가 부족하여 완전히 표시할 수 없습니다',
  'async.backgroundError': '백그라운드 업데이트 실패：{message}（마지막 성공 데이터 표시）',
  'async.dataMayBeStale':
    '백그라운드 업데이트 실패：{message}（데이터가 오래되었을 수 있으며 마지막 성공 결과 표시）',
  'async.executionMayBeStale':
    '백그라운드 업데이트 실패：{message}（실행 상태가 오래되었을 수 있으며 마지막 성공 결과 표시）',

  // ─── Common display labels ────────────────────────────────
  'common.unavailable': '데이터 없음',
  'common.notProvided': '제공되지 않음',
  'common.yes': '예',
  'common.no': '아니요',
  'common.none': '없음',

  // ─── Common Actions ──────────────────────────────────────
  'action.retry': '재시도',
  'action.cancel': '취소',
  'action.confirm': '확인',
  'action.close': '닫기',

  // ─── Timeline Panel ──────────────────────────────────────
  'timeline.heading': '타임라인 재생',
  'timeline.loading': '타임라인 불러오는 중',
  'timeline.errorFallback': '타임라인을 불러오지 못했습니다',
  'timeline.empty': '현재 재생 가능한 시점이 없습니다',
  'timeline.currentLabel': '현재 재생 위치',
  'timeline.previous': '이전',
  'timeline.previousAria': '이전 시점',
  'timeline.next': '다음',
  'timeline.nextAria': '다음 시점',
  'timeline.selectLabel': '시점 선택',
  'timeline.selectedLabel': '선택한 시점：',
  'timeline.selectedPosition': '선택 위치 {position}',
  'timeline.currentPositionAria': '현재 재생 위치 {position}',
  'timeline.refreshing': '백그라운드 업데이트 중…',
  'timeline.evidenceHeading': 'HG-001 시간 근거',

  // ─── Road Panel ──────────────────────────────────────────
  'roads.heading': '도로 교통 상황',
  'roads.loading': '도로 교통 상황 불러오는 중',
  'roads.errorFallback': '도로 교통 상황을 불러오지 못했습니다',
  'roads.empty': '현재 표시할 도로 데이터가 없습니다',
  'roads.insufficient': '데이터가 부족하여 도로 교통 상황을 완전히 표시할 수 없습니다（insufficient_data）',
  'roads.levelA': 'A 등급',
  'roads.levelB': 'B 등급',
  'roads.levelNeutral': '미분류',
  'roads.refreshing': '백그라운드 업데이트 중…',

  // ─── Crowd Panel ─────────────────────────────────────────
  'crowd.heading': '기지국 유동인구 및 신호 정보',
  'crowd.loading': '기지국 유동인구 불러오는 중',
  'crowd.errorFallback': '기지국 유동인구를 불러오지 못했습니다',
  'crowd.empty': '현재 재생 위치에서 사용 가능한 기지국 관측이 없습니다',
  'crowd.refreshing': '백그라운드 업데이트 중…',

  // ─── Anomaly Popup ───────────────────────────────────────
  'anomaly.framingTitle': '이상 상황이 감지되었습니다',
  'anomaly.framingDescription': '실시간 도로 및 유동인구 경보를 확인해 주세요',
  'anomaly.close': '닫기',

  // ─── Map ─────────────────────────────────────────────────
  'map.heading': '상황 지도',
  'map.disclosure': '운영 개략도（실제 지리적 축척이 아님）',
  'map.legendHeading': '범례',
  'map.legendAria': '지도 범례',
  'map.detailEmpty': '지도의 도로 또는 기지국을 클릭하거나 방향키로 선택하면 세부 정보를 확인할 수 있습니다.',
  'map.roadsLoading': '지도 도로 불러오는 중',
  'map.crowdLoading': '지도 기지국 불러오는 중',

  // ─── Decision: Report Panel ──────────────────────────────
  'report.heading': '지휘센터 보고서',
  'report.loading': '지휘센터 보고서 불러오는 중',
  'report.errorFallback': '보고서를 불러오지 못했습니다',
  'report.idle': '보고서를 생성할 결정이 아직 없습니다（사건 입력 또는 실시간 이벤트 대기 중）',
  'report.refreshing': '백그라운드 업데이트 중…',

  // ─── Decision: Public Alert Panel ────────────────────────
  'alert.heading': '다국어 시민 경보',
  'alert.loading': '다국어 시민 경보 불러오는 중',
  'alert.errorFallback': '시민 경보를 불러오지 못했습니다',
  'alert.idle': '경보를 생성할 결정이 아직 없습니다（사건 입력 또는 실시간 이벤트 대기 중）',
  'alert.refreshing': '백그라운드 업데이트 중…',

  // ─── Decision: Route Panel ───────────────────────────────
  'route.heading': '대피 경로 및 제외 이유（SOP 제2조）',
  'route.loading': '대피 경로 결정 불러오는 중',
  'route.errorFallback': '대피 경로를 불러오지 못했습니다',
  'route.idle': '대피 경로를 표시할 결정이 아직 없습니다（사건 입력 또는 실시간 이벤트 대기 중）',
  'route.refreshing': '백그라운드 업데이트 중…',

  // ─── Decision: ETE Panel ─────────────────────────────────
  'ete.heading': '예상 복구 시간 ETE（SOP 제7조）',
  'ete.loading': 'ETE 계산 근거 불러오는 중',
  'ete.errorFallback': 'ETE를 불러오지 못했습니다',
  'ete.idle': 'ETE를 표시할 결정이 아직 없습니다（사건 입력 또는 실시간 이벤트 대기 중）',
  'ete.refreshing': '백그라운드 업데이트 중…',

  // ─── Decision: Explanation Chain ─────────────────────────
  'explanation.heading': '의사결정 추론 및 설명 체인',
  'explanation.loading': '의사결정 추론 체인 불러오는 중',
  'explanation.errorFallback': '추론 체인을 불러오지 못했습니다',
  'explanation.idle': '추론 과정을 표시할 결정이 아직 없습니다（사건 입력 또는 실시간 이벤트 대기 중）',
  'explanation.refreshing': '백그라운드 업데이트 중…',

  // ─── Decision: Execution Status ──────────────────────────
  'execution.heading': '실행 상태 및 실패 메시지',
  'execution.loading': '실행 상태 불러오는 중',
  'execution.refreshing': '백그라운드 업데이트 중…',

  // ─── What-if Dialog ───────────────────────────────────────
  'whatif.heading': 'What-if 가상 시나리오 시뮬레이션',
  'whatif.submit': '질문 준비 중…',
  'whatif.confirmQuestion': '가상 시나리오를 제출하시겠습니까? 이 작업은 시스템 상태를 변경하지 않습니다.',
  'whatif.confirmYes': '질문 확인',
  'whatif.confirmNo': '취소',
  'whatif.loading': 'What-if 계산 중',
  'whatif.reset': '다시 입력',
  'whatif.restart': '새 What-if 시나리오 시작',

  // ─── Injection Panel ──────────────────────────────────────
  'injection.heading': '사건 입력（관리자）',
  'injection.submit': '입력 준비 중…',
  'injection.confirmYes': '입력 확인',
  'injection.confirmNo': '취소',
  'injection.submitting': '입력 요청 전송 중…',
  'injection.retry': '다시 전송 시도',
  'injection.resetLabel': '이벤트 ID 다시 입력',
  'injection.again': '다른 이벤트 입력',

  // ─── Admin Session ─────────────────────────────────────────
  'admin.heading': '관리자 자격 증명',
  'admin.loadButton': '자격 증명 불러오기',
  'admin.clearButton': '관리자 자격 증명 지우기',
  'admin.statusLoaded': '상태：자격 증명 불러옴',
  'admin.statusEmpty': '상태：자격 증명 없음',

  // ─── Not Found Page ──────────────────────────────────────
  'notFound.title': '404 - 페이지를 찾을 수 없습니다',
  'notFound.description': '찾으시는 페이지가 존재하지 않거나 삭제되었습니다.',
  'notFound.link': '지휘 콘솔 홈으로 돌아가기',

  // ─── Configuration Error Screen ─────────────────────────
  'configError.title': '애플리케이션 설정 오류',
  'configError.description': '환경 설정이 누락되었거나 유효하지 않아 애플리케이션을 시작할 수 없습니다. 시스템 관리자에게 문의하세요.',
  'configError.subtitle': '설정 문제',
};
