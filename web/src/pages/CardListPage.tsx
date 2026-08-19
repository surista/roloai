import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CARD_SORT_OPTIONS, sortCards, type Card, type CardSort } from '@roloai/shared';
import { subscribeToCards } from '../lib/cards';

export default function CardListPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sort, setSort] = useState<CardSort>('recent');

  useEffect(() => subscribeToCards(setCards), []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    cards.forEach((c) => c.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = cards.filter((c) => {
      if (activeTag && !c.tags.includes(activeTag)) return false;
      if (!q) return true;
      return [c.firstName, c.lastName, c.company, c.jobTitle, ...c.tags]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
    // Sorting after filtering, so the comparator only runs over what is on screen.
    return sortCards(matches, sort);
  }, [cards, search, activeTag, sort]);

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
            placeholder="Search name, company, tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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

      {filtered.length === 0 ? (
        <p className="empty">No cards found. Scan one from the iPhone app to see it here.</p>
      ) : (
        <div className="card-grid">
          {filtered.map((card) => (
            <Link key={card.id} to={`/cards/${card.id}`} className="card-tile">
              {/* thumbUrl is absent on cards saved before thumbnails existed, so fall back to
                  the full image rather than showing a blank tile for them. */}
              {card.thumbUrl || card.imageUrl ? (
                <img
                  src={card.thumbUrl || card.imageUrl}
                  alt=""
                  className="card-thumb"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="card-thumb card-thumb-placeholder" />
              )}
              <div className="card-tile-body">
                <div className="card-name">
                  {card.firstName} {card.lastName}
                </div>
                <div className="card-subtitle">
                  {[card.jobTitle, card.company].filter(Boolean).join(' · ')}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
