import { useState, type FormEvent } from 'react';
import type { CardDraft } from '@roloai/shared';

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

interface Props {
  draft: CardDraft;
  imageUrl?: string;
  saveLabel: string;
  onSave: (fields: Omit<CardDraft, 'imageUrl' | 'source' | 'rawOcrText'>) => Promise<void>;
  extraAction?: { label: string; onClick: () => void; destructive?: boolean };
}

export default function CardForm({ draft, imageUrl, saveLabel, onSave, extraAction }: Props) {
  const [firstName, setFirstName] = useState(draft.firstName);
  const [lastName, setLastName] = useState(draft.lastName);
  const [jobTitle, setJobTitle] = useState(draft.jobTitle ?? '');
  const [company, setCompany] = useState(draft.company ?? '');
  const [phonesText, setPhonesText] = useState(joinPhones(draft.phones));
  const [emailsText, setEmailsText] = useState(joinEmails(draft.emails));
  const [website, setWebsite] = useState(draft.website ?? '');
  const [address, setAddress] = useState(draft.address ?? '');
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [tagsText, setTagsText] = useState(draft.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() && !lastName.trim()) {
      setError('Enter at least a first or last name.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim() || undefined,
        company: company.trim() || undefined,
        phones: splitToList(phonesText).map((number) => ({ label: 'work', number })),
        emails: splitToList(emailsText).map((address) => ({ label: 'work', address })),
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        tags: splitToList(tagsText),
      });
    } catch (err) {
      console.error('Card save failed:', err);
      setError('Save failed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card-form" onSubmit={handleSubmit}>
      {imageUrl && <img src={imageUrl} alt="" className="card-form-preview" />}

      <Field label="First name" value={firstName} onChange={setFirstName} />
      <Field label="Last name" value={lastName} onChange={setLastName} />
      <Field label="Job title" value={jobTitle} onChange={setJobTitle} />
      <Field label="Company" value={company} onChange={setCompany} />
      <Field label="Phone(s)" value={phonesText} onChange={setPhonesText} placeholder="comma separated" />
      <Field label="Email(s)" value={emailsText} onChange={setEmailsText} placeholder="comma separated" />
      <Field label="Website" value={website} onChange={setWebsite} />
      <Field label="Address" value={address} onChange={setAddress} />
      <Field label="Tags" value={tagsText} onChange={setTagsText} placeholder="comma separated" />
      <Field label="Notes" value={notes} onChange={setNotes} multiline />

      {error && <p className="error">{error}</p>}

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
