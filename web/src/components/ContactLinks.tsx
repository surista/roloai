import { mailtoUrl, mapsUrl, smsUrl, telUrl, websiteUrl, type Card } from '@roloai/shared';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The card's details as links — call, text, mail, browse, map — matching the phone's detail
 * screen. tel: and sms: hand off to FaceTime/Messages on a Mac or to the phone via Continuity.
 */
export default function ContactLinks({
  card,
  onFollowUp,
}: {
  card: Card;
  onFollowUp: (when: number | undefined) => void;
}) {
  // The local calendar day, not toISOString's UTC one: 9 AM in Sydney is the previous day in UTC.
  const followUpValue = card.followUpAt ? localDay(new Date(card.followUpAt)) : '';
  return (
    <dl className="contact-links">
      {card.phones.map((p, i) => (
        <div key={`p${i}`} className="contact-link-row">
          <dt>{p.label}</dt>
          <dd>
            {telUrl(p.number) ? <a href={telUrl(p.number)}>{p.number}</a> : p.number}
            {smsUrl(p.number) && (
              <a className="contact-link-secondary" href={smsUrl(p.number)}>
                Message
              </a>
            )}
          </dd>
        </div>
      ))}
      {card.emails.map((e, i) => (
        <div key={`e${i}`} className="contact-link-row">
          <dt>{e.label}</dt>
          <dd>{mailtoUrl(e.address) ? <a href={mailtoUrl(e.address)}>{e.address}</a> : e.address}</dd>
        </div>
      ))}
      {card.website && (
        <div className="contact-link-row">
          <dt>website</dt>
          <dd>
            {websiteUrl(card.website) ? (
              <a href={websiteUrl(card.website)} target="_blank" rel="noreferrer">
                {card.website}
              </a>
            ) : (
              card.website
            )}
          </dd>
        </div>
      )}
      {card.address && (
        <div className="contact-link-row">
          <dt>address</dt>
          <dd>
            <a href={mapsUrl(card.address)} target="_blank" rel="noreferrer">
              {card.address}
            </a>
          </dd>
        </div>
      )}
      <div className="contact-link-row">
        <dt>added</dt>
        <dd>{dateFormat.format(card.createdAt)}</dd>
      </div>
      {card.event && (
        <div className="contact-link-row">
          <dt>met at</dt>
          <dd>{card.event}</dd>
        </div>
      )}
      {card.metPlace && (
        <div className="contact-link-row">
          <dt>where</dt>
          <dd>
            <a href={mapsUrl(card.metPlace)} target="_blank" rel="noreferrer">
              {card.metPlace}
            </a>
          </dd>
        </div>
      )}
      <div className="contact-link-row">
        <dt>
          <label htmlFor="follow-up">follow up</label>
        </dt>
        <dd>
          <input
            id="follow-up"
            type="date"
            value={followUpValue}
            onChange={(e) =>
              onFollowUp(e.target.value ? new Date(`${e.target.value}T09:00:00`).getTime() : undefined)
            }
          />
          <span className="contact-link-hint">The iPhone app reminds you at 9 AM that day.</span>
        </dd>
      </div>
    </dl>
  );
}

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
