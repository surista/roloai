import { describe, expect, it } from 'vitest';
import { dedupe } from './dedupe.mjs';
import { merge, suspicions } from './review.mjs';

const email = (address) => ({ label: 'work', address });
const row = (n, o) => ({ row: n, firstName: '', lastName: '', emails: [], createdAt: n, ...o });

describe('dedupe', () => {
  it('keeps the newest of a re-scan and both scripts of a bilingual person', () => {
    const { keep, drop } = dedupe([
      row(1, { firstName: 'Kaname', lastName: 'Irie', emails: [email('k@x.com')], createdAt: 1 }),
      row(2, { firstName: 'Kaname', lastName: 'Irie', emails: [email('k@x.com')], createdAt: 2 }),
      row(3, { lastName: '入江要', emails: [email('k@x.com')], createdAt: 3 }),
    ]);
    expect(keep.map((c) => c.row)).toEqual([2, 3]);
    expect(drop.map((d) => d.card.row)).toEqual([1]);
  });

  it('does not merge nameless cards at one company', () => {
    expect(dedupe([row(1, { company: 'Nomura' }), row(2, { company: 'Nomura' })]).keep).toHaveLength(2);
  });

  it('tolerates a missing createdAt', () => {
    const { keep } = dedupe([
      row(1, { firstName: 'A', emails: [email('a@x.com')], createdAt: null }),
      row(2, { firstName: 'A', emails: [email('a@x.com')], createdAt: 5 }),
    ]);
    expect(keep.map((c) => c.row)).toEqual([2]);
  });
});

describe('review', () => {
  it('flags garbled emails and phones', () => {
    const reasons = suspicions({ firstName: 'A', emails: [email('itb@fbw5il')], phones: [{ label: 'w', number: '12' }] });
    expect(reasons).toEqual(['bad email "itb@fbw5il"', 'odd phone "12"']);
  });

  it('merges phones and emails instead of replacing them', () => {
    const card = {
      phones: [{ label: 'mobile', number: '090-1111-2222' }, { label: 'fax', number: '03 1234 5678' }],
      emails: [email('itb@fbw5il')],
    };
    const changes = merge(card, {
      phones: [{ label: 'work', number: '03-1234-5678' }],
      emails: [email('a@b.com')],
    });
    expect(changes.emails).toEqual([email('a@b.com')]);
    expect(changes.phones).toBeUndefined(); // same numbers, only relabelled
  });
});
