import { describe, expect, it } from 'vitest';
import { activityKind, dayLabel } from '../src/core';

describe('dayLabel', () => {
  const now = new Date(2026, 10, 19, 14, 30).getTime();
  it('says today, yesterday, the date, and the date with the year', () => {
    expect(dayLabel(new Date(2026, 10, 19, 0, 5).getTime(), now)).toBe('Сьогодні');
    expect(dayLabel(new Date(2026, 10, 18, 23, 59).getTime(), now)).toBe('Вчора');
    expect(dayLabel(new Date(2026, 10, 14, 22, 13).getTime(), now)).toBe('14 листопада');
    expect(dayLabel(new Date(2025, 2, 1, 9, 0).getTime(), now)).toBe('1 березня 2025');
  });
  it('a record without a time is a version from another device', () => {
    expect(dayLabel(0, now)).toBe('З іншого пристрою');
  });
});

describe('activityKind', () => {
  it('tells the kind of a record by what it says', () => {
    expect(activityKind('надіслано')).toBe('send');
    expect(activityKind('вичитано')).toBe('approve');
    expect(activityKind('затверджено внесок: Оля')).toBe('approve');
    expect(activityKind('відновлено версію від 14.11, 22:13 (надіслано)')).toBe('restore');
    expect(activityKind('правка')).toBe('edit');
  });
});
