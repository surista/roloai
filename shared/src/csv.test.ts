import { expect, it } from 'vitest';
import { cardsToCsv } from './csv';
import { card } from './testCards';

it('quotes, escapes and neutralises formulas', () => {
  const csv = cardsToCsv([
    card({
      firstName: 'Ann',
      lastName: 'O"Neil',
      company: 'Acme, Inc.',
      notes: '=HYPERLINK("x")\nsecond line',
      phones: [{ label: 'a', number: '1' }, { label: 'b', number: '2' }],
      createdAt: Date.UTC(2026, 0, 2),
    }),
  ]);
  expect(csv.startsWith('﻿First name,')).toBe(true);
  expect(csv).toContain('"O""Neil"');
  expect(csv).toContain('"Acme, Inc."');
  expect(csv).toContain(`"'=HYPERLINK(""x"")\nsecond line"`);
  expect(csv).toContain('1; 2');
  expect(csv).toContain('2026-01-02');
});
