import type { NewsHeadline } from '../hooks/use-news.js';

const PLACEHOLDER = '/placeholder-news.png';

function formatDateTime(utc: string): string {
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(utc));
  } catch {
    return utc;
  }
}

export function NewsCard({ item, compact = false }: { item: NewsHeadline; compact?: boolean }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--sp-border-4)',
        border: '1px solid var(--sp-border-8)',
        borderRadius: compact ? 8 : 10,
        overflow: 'hidden',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = 'translateY(-3px)';
        el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
        el.style.background = 'var(--sp-border-8)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = 'none';
        el.style.background = 'var(--sp-border-4)';
      }}
    >
      {/* Imagen 16:9 */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', flexShrink: 0 }}>
        <img
          src={item.imageUrl ?? PLACEHOLDER}
          alt=""
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = PLACEHOLDER;
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            backgroundColor: 'var(--sp-border)',
          }}
        />
      </div>

      {/* Contenido */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: compact ? '8px 10px 10px' : '12px 14px 14px',
        gap: compact ? 5 : 8,
      }}>
        <div
          style={{
            fontSize: compact ? 12 : 14,
            fontWeight: 600,
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: compact ? 2 : 3,
            WebkitBoxOrient: 'vertical',
            color: 'var(--sp-text-88)',
            flex: 1,
          }}
        >
          {item.title}
        </div>
        <div style={{
          fontSize: compact ? 10 : 11,
          color: 'var(--sp-text-40)',
          display: 'flex',
          gap: 5,
          alignItems: 'center',
          marginTop: 'auto',
        }}>
          <span style={{ fontWeight: 500, color: 'var(--sp-text-55)' }}>{item.sourceName}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{formatDateTime(item.publishedAtUtc)}</span>
        </div>
      </div>
    </a>
  );
}
