#!/usr/bin/env python3
"""
Turns a CamCard "Export Business Card Image" .xlsx into RoloAI CardDrafts.

CamCard's export is one wide row per card with a fixed set of numbered slots (Company1..3,
Tel1..3, ...) plus two hyperlink columns holding session-authenticated download URLs for the
card photos. This reads the sheet with the stdlib only (no openpyxl) and writes:

  cards.json   one entry per row: the RoloAI CardDraft plus the local image file names
  images.json  every photo to fetch: {row, side, url}

Usage:  extract.py <export.xlsx> <out-dir>
"""
import json
import re
import sys
import zipfile
from datetime import datetime, timedelta
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

# The sheet the export puts its data on, and its two photo columns.
SHEET = 'xl/worksheets/sheet2.xml'
FRONT_COL, BACK_COL = 'AL', 'AM'


def read_sheet(path):
    """Returns (rows keyed by row number, hyperlinks keyed by cell ref)."""
    z = zipfile.ZipFile(path)
    strings = [
        ''.join(t.text or '' for t in si.iter(NS + 't'))
        for si in ET.fromstring(z.read('xl/sharedStrings.xml'))
    ]
    targets = {
        r.get('Id'): r.get('Target')
        for r in ET.fromstring(z.read('xl/worksheets/_rels/sheet2.xml.rels'))
    }
    sheet = ET.fromstring(z.read(SHEET))

    links = {h.get('ref'): targets.get(h.get(RNS + 'id')) for h in sheet.iter(NS + 'hyperlink')}

    rows = {}
    for row in sheet.iter(NS + 'row'):
        cells = {}
        for c in row.iter(NS + 'c'):
            v = c.find(NS + 'v')
            if c.get('t') == 's' and v is not None:
                value = strings[int(v.text)]
            elif v is not None:
                value = v.text
            else:
                value = ''
            cells[re.match(r'[A-Z]+', c.get('r')).group(0)] = value
        rows[int(row.get('r'))] = cells
    return rows, links


JAPANESE = re.compile('[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]')


def split_name(full):
    """
    Splits a name into (firstName, lastName).

    Japanese names are family-name-first, so with or without a space between the parts the first
    token is the family name (lastName) and the rest the given name: '山田 太郎' is family 山田,
    given 太郎. A name with no whitespace at all also goes entirely to lastName — those are
    Japanese (入江要) or bare surnames from a partial OCR, and putting them in firstName would
    sort the whole set wrongly by surname.

    For any other script the first token is the given name and the rest the family name. A
    romaji name written family-first ('Irie Kaname') cannot be told apart from 'John Smith' here;
    dedupe ignores word order when comparing names, and review.mjs can re-read the card.
    """
    parts = full.split()
    if not parts:
        return '', ''
    if len(parts) == 1:
        return '', parts[0]
    if JAPANESE.search(full):
        return ' '.join(parts[1:]), parts[0]
    return parts[0], ' '.join(parts[1:])


def phones(values):
    """CamCard's three numbered slots per kind, flattened into RoloAI's labelled list."""
    out, seen = [], set()
    for label, prefix in (('mobile', 'Mobile'), ('work', 'Tel'), ('fax', 'Fax')):
        for i in (1, 2, 3):
            for number in values(f'{prefix}{i}'):
                if number not in seen:
                    seen.add(number)
                    out.append({'label': label, 'number': number})
    return out


def emails(values):
    out, seen = [], set()
    for i in (1, 2, 3):
        for address in values(f'Email{i}'):
            if address.lower() not in seen:
                seen.add(address.lower())
                out.append({'label': 'work', 'address': address})
    return out


# CamCard labels each URL with the heading it was printed under. The export uses HOMEPAGE and
# WORK; the rest are here so an unseen label never ends up inside the stored address.
LABEL_PREFIX = re.compile(
    r'^\s*(HOMEPAGE|URL|WEB(SITE)?|WORK|HOME|OTHER|PERSONAL|COMPANY)\s*[:：]\s*', re.I
)


def websites(values):
    """
    Every URL on the card, each stripped of the label CamCard read off it ("HOMEPAGE: www...").

    A card with more than one gets them all in the same cell, one per line and each separately
    labelled, so the label has to come off every entry rather than just the first.
    """
    return [LABEL_PREFIX.sub('', value) for value in values('Website')]


def leftover_notes(values, used_job_title, extra_websites):
    """
    Everything CamCard recorded that RoloAI's Card has no field for.

    A card carries one company/title/address; CamCard keeps three of each plus departments,
    and 260 of these rows have a department. Dropping them would lose real data, and folding
    them into jobTitle/address would misrepresent what was on the card, so they go to notes
    under their original labels.
    """
    lines = [f'Website: {url}' for url in extra_websites]
    for label, keys in (
        ('Department', ('Department1', 'Department2', 'Department3')),
        ('Also', ('Job Title2', 'Job Title3')),
        ('Company', ('Company2', 'Company3')),
        ('Address', ('Address2', 'Address3')),
        ('Nickname', ('Nickname',)),
        ('IM', ('Instant Message',)),
        ('Social', ('SNS-Accounts',)),
        ('Birthday', ('Birthday',)),
        ('Anniversary', ('Anniversary',)),
        ('Industry', ('Industry',)),
        ('Location', ('Location',)),
        ('Note', ('Note1', 'Note2', 'Note3')),
    ):
        for key in keys:
            for value in values(key):
                # Department1 is promoted to jobTitle on cards that have no Job Title1; repeating
                # it in notes would show the same string twice on the card.
                if value != used_job_title:
                    lines.append(f'{label}: {value}')
    return '\n'.join(lines)


EXCEL_EPOCH = datetime(1899, 12, 30)


def created_at(get):
    """
    The card's creation time in epoch millis, from CamCard's local-time 'YYYY-MM-DD HH:MM:SS'
    (or an Excel serial number, when the cell was stored as a date), kept as the card's
    createdAt so the imported library stays in the order it was actually collected in rather
    than all landing on today. None when the cell is blank or unreadable; the caller reports it.
    """
    raw = get('Creation Date')
    if not raw:
        return None
    try:
        return int(datetime.strptime(raw, '%Y-%m-%d %H:%M:%S').timestamp() * 1000)
    except ValueError:
        pass
    try:
        return int((EXCEL_EPOCH + timedelta(days=float(raw))).timestamp() * 1000)
    except (ValueError, OverflowError):
        return None


def main():
    xlsx, out_dir = sys.argv[1], sys.argv[2].rstrip('/')
    rows, links = read_sheet(xlsx)
    header = rows[1]
    column = {name: col for col, name in header.items()}

    cards, images = [], []
    for r in sorted(n for n in rows if n > 1):
        def values(name, _row=r):
            """
            Every value in a cell.

            CamCard packs whatever will not fit its three numbered slots into the last one,
            newline-separated — `Tel3` holding two numbers, `Website` holding three URLs. Reading
            a cell as one string welded them together into a single unusable phone number.
            """
            raw = rows[_row].get(column[name]) or ''
            return [re.sub(r'\s+', ' ', part).strip() for part in raw.splitlines() if part.strip()]

        def get(name):
            return next(iter(values(name)), '')

        first, last = split_name(get('Name'))
        job_title = get('Job Title1') or get('Department1')
        site, *extra_sites = websites(values) or ['']
        card = {
            'row': r,
            'firstName': first,
            'lastName': last,
            'jobTitle': job_title,
            'company': get('Company1'),
            'phones': phones(values),
            'emails': emails(values),
            'website': site,
            'address': get('Address1'),
            'notes': leftover_notes(values, job_title, extra_sites),
            'tags': ['camcard'],
            'source': 'scan',
            'createdAt': created_at(get),
        }
        for side, col in (('front', FRONT_COL), ('back', BACK_COL)):
            url = links.get(f'{col}{r}')
            if url:
                card[side] = f'{r}-{side}.jpg'
                images.append({'row': r, 'side': side, 'url': url})
        cards.append(card)

    with open(f'{out_dir}/cards.json', 'w') as f:
        json.dump(cards, f, ensure_ascii=False, indent=1)
    with open(f'{out_dir}/images.json', 'w') as f:
        json.dump(images, f, indent=1)
    print(f'{len(cards)} cards, {len(images)} images -> {out_dir}')
    undated = [c['row'] for c in cards if c['createdAt'] is None]
    if undated:
        print(f'WARNING: no readable Creation Date on rows {undated}; import stamps them with the import time')


if __name__ == '__main__':
    main()
