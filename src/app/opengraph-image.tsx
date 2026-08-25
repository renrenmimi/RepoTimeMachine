import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'Repo Time Machine — watch a GitHub repository grow commit by commit';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Rendered at build time; deliberately made of the same parts as the interface. */
export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0c0f0d',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
          color: '#ddd8cb',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              letterSpacing: 6,
              textTransform: 'uppercase',
              color: '#7bcb8d',
            }}
          >
            Repo Time Machine
          </div>
          <div style={{ display: 'flex', fontSize: 66, lineHeight: 1.1, color: '#f0ece1', maxWidth: 900 }}>
            Watch a repository grow, commit by commit.
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: '#9c988c', maxWidth: 860, lineHeight: 1.4 }}>
            A playable timeline, an evolving file tree, commit diffs, and milestone heuristics that explain themselves.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, height: 120 }}>
            {[8, 14, 11, 26, 19, 33, 28, 47, 41, 58, 52, 71, 63, 84, 76, 96, 88, 108, 99, 118].map((value, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  width: 44,
                  height: value,
                  background: index === 13 ? '#e2a75c' : '#2f5c3c',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', height: 2, background: '#262c28' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, color: '#6d6a61' }}>
            <div style={{ display: 'flex' }}>github.com/renrenmimi/RepoTimeMachine</div>
            <div style={{ display: 'flex' }}>public repositories only &nbsp;·&nbsp; no login</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
