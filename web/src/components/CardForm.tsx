import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { relabelPhones, relabelEmails, type CardDraft } from '@roloai/shared';
import Lightbox from './Lightbox';

function joinPhones(phones: { number: string }[]): string {
  return phones.map((p) => p.number).join(', ');
}
function joinEmails(emails: { address: string }[]): string {
  return emails.map((e) => e.address).join(', ');
}
function splitToList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export type CardFormFields = Omit<
  CardDraft,
  'imageUrl' | 'imageBackUrl' | 'thumbUrl' | 'source' | 'rawOcrText' | 'metPlace' | 'metLocation' | 'followUpAt'
>;

interface Props {
  draft: CardDraft;
  imageUrl?: string;
  backImageUrl?: string;
  saveLabel: string;
  /**
   * Image URLs are excluded deliberately: the form never sets them, and letting them through as
   * `undefined` would make updateCard's deleteField() mapping wipe the card's photos on a plain
   * text edit.
   */
  /** Resolves `false` when nothing was saved after all (the owner backed out of a prompt). */
  onSave: (fields: CardFormFields) => Promise<boolean | void>;
  /** Told whenever the inputs start or stop differing from the saved card. */
  onDirtyChange?: (dirty: boolean) => void;
  extraAction?: { label: string; onClick: () => void; destructive?: boolean };
}

/** The form's editable text, as the inputs hold it. */
interface Values {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  phonesText: string;
  emailsText: string;
  website: string;
  address: string;
  notes: string;
  event: string;
  tagsText: string;
}

function valuesFromDraft(draft: CardDraft): Values {
  return {
    firstName: draft.firstName,
    lastName: draft.lastName,
    jobTitle: draft.jobTitle ?? '',
    company: draft.company ?? '',
    phonesText: joinPhones(draft.phones),
    emailsText: joinEmails(draft.emails),
    website: draft.website ?? '',
    address: draft.address ?? '',
    notes: draft.notes ?? '',
    event: draft.event ?? '',
    tagsText: draft.tags.join(', '),
  };
}

const sameValues = (a: Values, b: Values): boolean =>
  (Object.keys(a) as (keyof Values)[]).every((k) => a[k] === b[k]);

export default function CardForm({
  draft,
  imageUrl,
  backImageUrl,
  saveLabel,
  onSave,
  onDirtyChange,
  extraAction,
}: Props) {
  // `base` is the version of the card the inputs were filled from. The card is live (the phone,
  // another tab), so when it changes underneath an untouched form the form follows it; when the
  // owner has edits in progress it says so instead, rather than letting Save silently put the
  // older values back.
  const incoming = useMemo(() => valuesFromDraft(draft), [draft]);
  const [values, setValues] = useState(incoming);
  const [base, setBase] = useState(incoming);
  const dirty = !sameValues(values, base);
  const changedElsewhere = !sameValues(incoming, base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Without this a successful save looked exactly like nothing happening.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const loadLatest = () => {
    setValues(incoming);
    setBase(incoming);
  };
  useEffect(() => {
    if (changedElsewhere && !dirty && !saving) loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedElsewhere, dirty, saving]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const set = (key: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSavedAt(null);
  };
  const { firstName, lastName, jobTitle, company, phonesText, emailsText, website, address, notes, event, tagsText } =
    values;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() && !lastName.trim()) {
      setError('Enter at least a first or last name.');
      return;
    }
    setError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      const saved = await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim() || undefined,
        company: company.trim() || undefined,
        phones: relabelPhones(splitToList(phonesText), draft.phones),
        emails: relabelEmails(splitToList(emailsText), draft.emails),
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        event: event.trim() || undefined,
        tags: splitToList(tagsText),
      });
      if (saved === false) return;
      // What was just written is now the version the form reflects; the listener's copy of it
      // (trimmed, normalised) replaces the inputs once it arrives.
      setBase(values);
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Card save failed:', err);
      setError('Save failed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card-form" onSubmit={handleSubmit}>
      {imageUrl && (
        <div className="card-form-image">
          <span className="field-label">Front</span>
          <img
            src={imageUrl}
            alt=""
            className="card-form-preview card-form-preview-clickable"
            onClick={() => setLightbox({ src: imageUrl, alt: 'Front of card' })}
          />
        </div>
      )}
      {backImageUrl && (
        <div className="card-form-image">
          <span className="field-label">Back</span>
          <img
            src={backImageUrl}
            alt=""
            className="card-form-preview card-form-preview-clickable"
            onClick={() => setLightbox({ src: backImageUrl, alt: 'Back of card' })}
          />
        </div>
      )}

      {lightbox && (
        <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}

      <Field label="First name" value={firstName} onChange={set('firstName')} />
      <Field label="Last name" value={lastName} onChange={set('lastName')} />
      <Field label="Job title" value={jobTitle} onChange={set('jobTitle')} />
      <Field label="Company" value={company} onChange={set('company')} />
      <Field label="Phone(s)" value={phonesText} onChange={set('phonesText')} placeholder="comma separated" />
      <Field label="Email(s)" value={emailsText} onChange={set('emailsText')} placeholder="comma separated" />
      <Field label="Website" value={website} onChange={set('website')} />
      <Field label="Address" value={address} onChange={set('address')} />
      <Field label="Met at" value={event} onChange={set('event')} placeholder="Event or occasion" />
      <Field label="Tags" value={tagsText} onChange={set('tagsText')} placeholder="comma separated" />
      <Field label="Notes" value={notes} onChange={set('notes')} multiline />

      {changedElsewhere && dirty && !saving && (
        <p className="notice" role="status">
          This card was changed somewhere else while you were editing.{' '}
          <button type="button" className="link-button" onClick={loadLatest}>
            Discard my edits and load the latest
          </button>
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {savedAt && !error && <p className="notice" role="status">Saved.</p>}

      <button type="submit" className="primary-button" disabled={saving}>
        {saving ? 'Saving…' : saveLabel}
      </button>

      {extraAction && (
        <button
          type="button"
          className={`link-button ${extraAction.destructive ? 'destructive' : ''}`}
          onClick={extraAction.onClick}
        >
          {extraAction.label}
        </button>
      )}
    </form>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.multiline ? (
        <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} rows={4} />
      ) : (
        <input
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
        />
      )}
    </label>
  );
}
