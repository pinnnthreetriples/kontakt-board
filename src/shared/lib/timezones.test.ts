import { describe, expect, it } from 'vitest';
import { describeRegionTime, regionTimeHint } from './timezones';

// 26.08.2026 09:00 UTC = 12:00 по Москве.
const NOON_MSK = Date.parse('2026-08-26T09:00:00Z');

describe('describeRegionTime', () => {
  it('считает время по смещению региона', () => {
    expect(describeRegionTime('Воронежская область', NOON_MSK)).toMatchObject({ time: '12:00', offsetLabel: 'МСК' });
    expect(describeRegionTime('Калининградская область', NOON_MSK)).toMatchObject({ time: '11:00', offsetLabel: 'МСК−1' });
    expect(describeRegionTime('Саратовская область', NOON_MSK)).toMatchObject({ time: '13:00', offsetLabel: 'МСК+1' });
  });

  it('не зависит от того, как записан тип субъекта', () => {
    expect(describeRegionTime('Республика Татарстан', NOON_MSK)?.offsetLabel).toBe('МСК');
    expect(describeRegionTime('ХМАО — Югра', NOON_MSK)?.offsetLabel).toBe('МСК+2');
    expect(describeRegionTime('ЯНАО', NOON_MSK)?.offsetLabel).toBe('МСК+2');
  });

  it('отмечает время вне рабочих часов', () => {
    expect(describeRegionTime('Камчатский край', NOON_MSK)).toMatchObject({ time: '21:00', outsideWorkingHours: true });
    expect(describeRegionTime('Московская область', NOON_MSK)?.outsideWorkingHours).toBe(false);
  });

  it('молчит на незнакомом регионе', () => {
    expect(describeRegionTime('Гомельская область', NOON_MSK)).toBeNull();
    expect(describeRegionTime('', NOON_MSK)).toBeNull();
  });

  it('предупреждает про Якутию с её тремя поясами', () => {
    const yakutia = describeRegionTime('Республика Саха (Якутия)', NOON_MSK);
    expect(yakutia).toMatchObject({ offsetLabel: 'МСК+6', multiZone: true });
    expect(regionTimeHint(yakutia!)).toContain('несколько часовых поясов');
  });
});
