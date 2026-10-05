import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  cardToVCard,
  myCardOf,
  relabelEmails,
  relabelPhones,
  type Card,
} from '@roloai/shared';
import { downloadFile } from '../lib/backup';
import { saveMyCard, subscribeToCards } from '../lib/cards';
import ShareMenu from '../components/ShareMenu';

/** Where My Card lived before it became a synced card; read once as a prefill, never deleted. */
const LEGACY_KEY = 'roloai.myCard';

interface Form {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
}

const EMPTY: Form = {
  firstName: '',
  lastName: '',
  jobTitle: '',
  company: '',
  phone: '',
  email: '',
  website: '',
  address: '',
};

/** Storage access can throw (private windows, blocked site data), so the read is guarded. */
function loadLegacy(): Form | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

const joinList = (values: string[]): string => values.join(', ');
const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

function formFromCard(card: Card): Form {
  return {
    firstName: card.firstName,
    lastName: card.lastName,
    jobTitle: card.jobTitle ?? '',
    company: card.company ?? '',
    phone: joinList(card.phones.map((p) => p.number)),
    email: joinList(card.emails.map((e) => e.address)),
    website: card.website ?? '',
    address: card.address ?? '',
  };
}

/** The contact fields as they would be saved, keeping the labels already on the card. */
function fieldsFromForm(form: Form, existing?: Card) {
  const trimmed = (v: string) => v.trim() || undefined;
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    jobTitle: trimmed(form.jobTitle),
    company: trimmed(form.company),
    phones: relabelPhones(splitList(form.phone), existing?.phones ?? []),
    emails: relabelEmails(splitList(form.email), existing?.emails ?? []),
    website: trimmed(form.website),
    address: trimmed(form.address),
  };
}

const FIELDS: { key: keyof Form; label: string }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
  { key: 'address', label: 'Address' },
];

export default function MyCardPage() {
  // null until the first snapshot, so the form isn't prefilled from "no card" a moment too early.
  const [cards, setCards] = useState<Card[] | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => subscribeToCards(setCards), []);

  const mine = useMemo(() => (cards ? myCardOf(cards) : undefined), [cards]);

  // Prefill from the synced card, or (once, when there is none yet) from the old local data.
  // Stops following the server once the user starts typing, so a sync from the phone can't
  // overwrite an edit in progress.
  useEffect(() => {
    if (!cards || dirty) return;
    if (mine) setForm(formFromCard(mine));
    else setForm(loadLegacy() ?? EMPTY);
  }, [cards, mine, dirty]);

  const hasName = Boolean(form.firstName.trim() || form.lastName.trim());

  // What the QR code and download show: the form as it stands, with the saved card's other details.
  const vcard = useMemo(() => {
    const base: Card = mine ?? {
      id: 'my-card',
      tags: [],
      imageUrl: '',
      source: 'manual',
      createdAt: 0,
      updatedAt: 0,
      firstName: '',
      lastName: '',
      phones: [],
      emails: [],
    };
    return cardToVCard({ ...base, ...fieldsFromForm(form, mine) });
  }, [form, mine]);

  useEffect(() => {
    if (!hasName) {
      setQr(null);
      return;
    }
    let stale = false;
    QRCode.toDataURL(vcard, { width: 480, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!stale) setQr(url);
      })
      .catch(() => {
        if (!stale) setQr(null);
      });
    return () => {
      stale = true;
    };
  }, [vcard, hasName]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hasName) {
      setError('Enter at least a first or last name.');
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await saveMyCard(fieldsFromForm(form, mine));
      setDirty(false);
      setSaved(true);
    } catch (err) {
      console.error('Saving my card failed:', err);
      setError('Save failed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (cards === null) return <p className="empty">Loading…</p>;

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1>My card</h1>
        <Link className="link-button" to="/">
          Back to cards
        </Link>
      </header>

      <p className="settings-hint">
        Synced with the phone app. It is kept out of your card list.
      </p>

      <div className="settings-actions">
        {mine ? (
          <ShareMenu card={mine} label="Share my card" variant="button" />
        ) : (
          <p className="settings-hint">Save your details to share your card.</p>
        )}
      </div>

      <form className="card-form" onSubmit={handleSubmit}>
        {FIELDS.map(({ key, label }) => (
          <label className="field" key={key}>
            <span className="field-label">{label}</span>
            <input
              type="text"
              value={form[key]}
              onChange={(e) => {
                setForm({ ...form, [key]: e.target.value });
                setDirty(true);
                setSaved(false);
              }}
            />
          </label>
        ))}
        {error && <p className="error">{error}</p>}
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </form>

      {mine && (mine.imageUrl || mine.imageBackUrl) && (
        <>
          <div className="my-card-photos">
            {mine.imageUrl && <img src={mine.imageUrl} alt="Front of my card" />}
            {mine.imageBackUrl && <img src={mine.imageBackUrl} alt="Back of my card" />}
          </div>
          <p className="settings-hint">Add or change photos from the phone app.</p>
        </>
      )}

      {qr ? (
        <img className="qr-code" src={qr} alt="QR code of my contact card" />
      ) : (
        <p className="settings-hint">Enter a name to see your QR code.</p>
      )}
      <div className="settings-actions">
        <button
          className="link-button"
          disabled={!hasName}
          onClick={() => downloadFile('my-card.vcf', vcard, 'text/vcard')}
        >
          Download my card (.vcf)
        </button>
      </div>
    </div>
  );
}
