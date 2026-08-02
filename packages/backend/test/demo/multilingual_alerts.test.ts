import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDemoApiHandler,
  setDemoData,
  type DemoDataSet,
} from '../../src/demo/demo_api_handler.js';

const demoHandler = createDemoApiHandler();

function minimalDataSet(): DemoDataSet {
  return {
    traffic: [],
    trafficTimestamps: [],
    crowd: [
      {
        timestamp_raw: '2026/5/20 22:10',
        BS_ID: 'BS_XY_ATT',
        Location_Name: 'ATT 4F',
        User_Count: 5000,
        Stay_Time_Avg: 30,
        Growth_Rate: 0.1,
        Roaming_User_Pct: '30%',
        roaming_pct_value: 0.3,
      },
    ],
    crowdTimestamps: [],
    roadNetwork: {
      getAllSegments: () => [],
      getSegment: () => undefined,
      alternativesOf: () => [],
      nearbyStations: () => ['BS_XY_ATT'],
      positionRelativeToAnchor: () => null,
      isDirectIntersection: () => false,
      get size() {
        return 0;
      },
    } as unknown as DemoDataSet['roadNetwork'],
    sopArticles: {
      articles: [],
      getByArticleNo: () => undefined,
    } as unknown as DemoDataSet['sopArticles'],
    incidents: [],
  };
}

function alertEventWithoutLanguageList() {
  return {
    rawPath: '/demo/alerts',
    requestContext: { http: { method: 'POST', path: '/demo/alerts' } },
    headers: { 'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    body: JSON.stringify({ station_id: 'BS_XY_ATT', roaming_user_pct: 0.3 }),
  } as Parameters<typeof demoHandler>[0];
}

describe('POST /demo/alerts — multilingual response serialization', () => {
  beforeEach(() => {
    setDemoData(minimalDataSet());
  });

  it('returns non-empty zh, en, ja, and ko messages when languages are omitted', async () => {
    const result = await demoHandler(alertEventWithoutLanguageList());
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body) as { messages: Record<string, string> };
    expect(Object.keys(body.messages).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
    expect(body.messages.zh.length).toBeGreaterThan(0);
    expect(body.messages.en.length).toBeGreaterThan(0);
    expect(body.messages.ja.length).toBeGreaterThan(0);
    expect(body.messages.ko.length).toBeGreaterThan(0);
  });
});
