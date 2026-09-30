import { describe, expect, it } from 'vitest';
import { allTags, companyCounts, filterCards, matchesSearch } from './search';
import { card } from './testCards';

const jose = card({
  firstName: 'José',
  lastName: 'García',
  company: 'ＡＣＭＥ Corp',
  phones: [{ label: 'work', number: '(555) 123-4567' }],
  emails: [{ label: 'work', address: 'jose@acme.com' }],
  notes: 'Met at Tokyo summit',
  rawOcrText: 'Chief Widget Officer',
  tags: ['finance'],
});

describe('matchesSearch', () => {
  it.each([
    ['jose', true],
    ['garcia acme', true],
    ['5551234567', true],
    ['acme.com', true],
    ['tokyo', true],
    ['widget officer', true],
    ['nomura', false],
    ['', true],
  ])('%s -> %s', (query, expected) => {
    expect(matchesSearch(jose, query)).toBe(expected);
  });
});

it('filters by tag and company together', () => {
  const other = card({ firstName: 'B', company: 'Nomura', tags: ['finance'] });
  expect(filterCards([jose, other], { tag: 'finance', company: 'nomura' })).toEqual([other]);
});

it('lists tags and company counts', () => {
  const a = card({ company: 'Acme', tags: ['b', 'a'] });
  const b = card({ company: 'acme', tags: ['a'] });
  expect(allTags([a, b])).toEqual(['a', 'b']);
  expect(companyCounts([a, b, card()])).toEqual([{ company: 'Acme', count: 2 }]);
});
