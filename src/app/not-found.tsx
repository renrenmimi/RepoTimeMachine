import Link from 'next/link';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '40ch' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6875rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-faint)',
          }}
        >
          404
        </p>
        <h1 style={{ marginTop: '0.5rem', fontSize: '1.375rem', fontWeight: 500, color: 'var(--text-bright)' }}>
          There is no page here
        </h1>
        <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-dim)' }}>
          Repo Time Machine lives on a single screen. Repositories are selected with the{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>?repo=owner/name</code> parameter.
        </p>
        <p style={{ marginTop: '1.5rem' }}>
          <Link href="/">Back to the timeline</Link>
        </p>
      </div>
    </main>
  );
}
