/**
 * haversineMeters tests (spec: boundary-snapping-containment, R3 AC2/AC5).
 */
import { describe, it, expect } from 'vitest';
import { haversineMeters } from '../../src/boundary/boundary_snapper.js';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters({ lat: 25.033, lon: 121.5654 }, { lat: 25.033, lon: 121.5654 })).toBe(0);
  });

  it('returns ~111,195m for 1 degree of latitude apart (constant on a sphere, any location)', () => {
    const distance = haversineMeters({ lat: 25, lon: 121 }, { lat: 26, lon: 121 });
    expect(distance).toBeGreaterThan(111000);
    expect(distance).toBeLessThan(111400);
  });

  it('returns ~111,195m for 1 degree of longitude apart at the equator', () => {
    const distance = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(distance).toBeGreaterThan(111000);
    expect(distance).toBeLessThan(111400);
  });

  it('returns ~half the Earth circumference for antipodal-longitude equator points', () => {
    const distance = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    // pi * R, R=6371000 -> ~20015086m
    expect(distance).toBeGreaterThan(19900000);
    expect(distance).toBeLessThan(20100000);
  });

  it('is symmetric: distance(a,b) === distance(b,a)', () => {
    const a = { lat: 25.0478, lon: 121.5319 };
    const b = { lat: 25.0339, lon: 121.5645 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });

  it('returns an integer number of meters', () => {
    const distance = haversineMeters({ lat: 25.0478, lon: 121.5319 }, { lat: 25.0339, lon: 121.5645 });
    expect(Number.isInteger(distance)).toBe(true);
  });

  it('never throws for out-of-range coordinate values (pure trig, no crash) — validity is snap()\'s concern, not this function\'s', () => {
    expect(() => haversineMeters({ lat: 999, lon: -999 }, { lat: 0, lon: 0 })).not.toThrow();
    expect(Number.isFinite(haversineMeters({ lat: 999, lon: -999 }, { lat: 0, lon: 0 }))).toBe(true);
  });
});
