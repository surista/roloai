import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { cardToVCard, type Card } from '@roloai/shared';
import { downloadFile } from '../lib/backup';

const STORAGE_KEY = 'roloai.myCard';

interface MyCard {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
}

const EMPTY: MyCard = {
  firstName: '',
  lastName: '',
  jobTitle: '',
  company: '',
  phone: '',
  email: '',
  website: '',
  address: '',
};

/**
 * Storage access can throw (private windows, blocked site data), and the page must still work
 * as a plain form, so every read and write is guarded.
 */
function load(): MyCard {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(value: MyCard): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Nothing useful to do; the details just won't survive a reload.
  }
}

/** Reuses the shared vCard writer by dressing the owner's details up as a Card. */
function toVCard(me: MyCard): string {
  const trimmed = (v: string) => v.trim() || undefined;
  const card: Card = {
    id: 'my-card',
    firstName: me.firstName.trim(),
    lastName: me.lastName.trim(),
    jobTitle: trimmed(me.jobTitle),
    company: trimmed(me.company),
    phones: trimmed(me.phone) ? [{ label: 'work', number: me.phone.trim() }] : [],
    emails: trimmed(me.email) ? [{ label: 'work', address: me.email.trim() }] : [],
    website: trimmed(me.website),
    address: trimmed(me.address),
    tags: [],
    imageUrl: '',
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
  };
  return cardToVCard(card);
}

const FIELDS: { key: keyof MyCard; label: string }[] = [
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
  const [me, setMe] = useState<MyCard>(load);
  const [qr, setQr] = useState<string | null>(null);
  const hasName = Boolean(me.firstName.trim() || me.lastName.trim());

  useEffect(() => {
    save(me);
    if (!hasName) {
      setQr(null);
      return;
    }
    let stale = false;
    QRCode.toDataURL(toVCard(me), { width: 480, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!stale) setQr(url);
      })
      .catch(() => {
        if (!stale) setQr(null);
      });
    return () => {
      stale = true;
    };
  }, [me, hasName]);

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1>My card</h1>
        <Link className="link-button" to="/settings">
          Back to settings
        </Link>
      </header>

      <p className="settings-hint">
        Saved in this browser only — nothing here is sent to the server.
      </p>

      <form className="card-form" onSubmit={(e) => e.preventDefault()}>
        {FIELDS.map(({ key, label }) => (
          <label className="field" key={key}>
            <span className="field-label">{label}</span>
            <input
              type="text"
              value={me[key]}
              onChange={(e) => setMe({ ...me, [key]: e.target.value })}
            />
          </label>
        ))}
      </form>

      {qr ? (
        <img className="qr-code" src={qr} alt="QR code of my contact card" />
      ) : (
        <p className="settings-hint">Enter a name to see your QR code.</p>
      )}
      <div className="settings-actions">
        <button
          className="primary-button"
          disabled={!hasName}
          onClick={() => downloadFile('my-card.vcf', toVCard(me), 'text/vcard')}
        >
          Download my card (.vcf)
        </button>
      </div>
    </div>
  );
}
