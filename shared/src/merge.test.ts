import { expect, it } from 'vitest';
import type { CardDraft } from './index';
import { mergeFrontBack } from './merge';

const draft = (o: Partial<CardDraft>): CardDraft => ({
  firstName: '', lastName: '', phones: [], emails: [], tags: [], imageUrl: '', source: 'scan', ...o,
});

it('front wins, back fills gaps, differences go to notes, lists are unions', () => {
  const merged = mergeFrontBack(
    draft({ firstName: 'Kaname', lastName: 'Irie', company: 'Acme', phones: [{ label: 'w', number: '03-1111-2222' }], tags: ['a'], rawOcrText: 'F' }),
    draft({ firstName: '', lastName: '入江要', company: 'アクメ', jobTitle: '部長', phones: [{ label: 'w', number: '0311112222' }, { label: 'm', number: '090-1' }], tags: ['a', 'b'], notes: 'n', rawOcrText: 'B' })
  );
  expect(merged.firstName).toBe('Kaname');
  expect(merged.jobTitle).toBe('部長');
  expect(merged.phones.map((p) => p.number)).toEqual(['03-1111-2222', '090-1']);
  expect(merged.tags).toEqual(['a', 'b']);
  expect(merged.notes).toContain('Back — lastName: 入江要');
  expect(merged.notes).toContain('Back — company: アクメ');
  expect(merged.rawOcrText).toBe('F\n\nB');
});
