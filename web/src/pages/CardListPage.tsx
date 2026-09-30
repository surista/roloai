import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CARD_SORT_OPTIONS,
  allTags as collectTags,
  cardThumbUrl,
  companyCounts,
  filterCards,
  groupPairs,
  sortCards,
  type Card,
  type CardSort,
} from '@roloai/shared';
import { subscribeToCards } from '../lib/cards';

export default function CardListPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [company, setCompany] = useState('');
  const [sort, setSort] = useState<CardSort>('recent');

  useEffect(() => subscribeToCards(setCards), []);

  const allTags = useMemo(() => collectTags(cards), [cards]);
  const companies = useMemo(() => companyCounts(cards), [cards]);

  const { entries, matchCount } = useMemo(() => {
    const matches = filterCards(cards, { search, tag: activeTag ?? undefined, company: company || undefined });
    const matchIds = new Set(matches.map((c) => c.id));
    // Pair up the *whole* sorted library and filter the tiles afterwards: filtering first would
    // drop one half of a pair whenever only it matched (searching the English name, say) and
    // show the other half as if it had no partner.
    const grouped = groupPairs(sortCards(cards, sort)).filter(
      ({ card, partner }) => matchIds.has(card.id) || (partner && matchIds.has(partner.id))
    );
    return { entries: grouped, matchCount: matches.length };
  }, [cards, search, activeTag, company, sort]);

  const isFiltering = Boolean(search.trim() || activeTag || company);

  return (
    <div className="card-list-page">
      <header className="page-header">
        <h1>RoloAI</h1>
        <div className="header-actions">
          <span className="version">v{__APP_VERSION__}</span>
          <Link className="link-button" to="/settings">
            Settings
          </Link>
        </div>
      </header>

      <div className="filters">
        <div className="filter-row">
          <input
            className="search-input"
            placeholder="Search name, company, email, phone, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {companies.length > 0 && (
            <label className="sort-control">
              Company
              <select value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.company} value={c.company}>
                    {c.company} ({c.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="sort-control">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as CardSort)}>
              {CARD_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {allTags.length > 0 && (
          <div className="tag-filters">
            <button
              className={`tag-chip ${activeTag === null ? 'active' : ''}`}
              onClick={() => setActiveTag(null)}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`tag-chip ${activeTag === tag ? 'active' : ''}`}
                onClick={() => setActiveTag(tag === activeTag ? null : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {isFiltering && (
        <p className="result-count">
          {matchCount} of {cards.length} cards
        </p>
      )}

      {entries.length === 0 ? (
        <p className="empty">No cards found. Scan one from the iPhone app to see it here.</p>
      ) : (
        <div className="card-grid">
          {entries.map(({ card, partner }) => {
            const thumb = cardThumbUrl(card);
            return (
              <Link key={card.id} to={`/cards/${card.id}`} className="card-tile">
                {thumb ? (
                  <img src={thumb} alt="" className="card-thumb" loading="lazy" decoding="async" />
                ) : (
                  <div className="card-thumb card-thumb-placeholder" />
                )}
                <div className="card-tile-body">
                  <div className="card-name">
                    {card.firstName} {card.lastName}
                  </div>
                  {partner && (
                    <div className="card-partner-name">
                      {partner.firstName} {partner.lastName}
                    </div>
                  )}
                  <div className="card-subtitle">
                    {[card.jobTitle, card.company].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
