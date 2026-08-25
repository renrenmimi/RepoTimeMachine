'use client';

import { useMemo } from 'react';
import { formatBytes, formatDate, formatNumber, formatPercent } from '@/lib/format';
import type { ActivityMap, GrowthSeries, LanguageEstimate } from '@/lib/stats/growth';
import styles from './charts.module.css';

/**
 * Categorical palette for file-type composition.
 *
 * Muted, warm-to-cool, and deliberately not a rainbow: each hue has to sit on
 * graphite next to the green and amber the rest of the interface already uses.
 */
export const CATEGORY_COLOURS = [
  '#7bcb8d',
  '#5fa8a8',
  '#e2a75c',
  '#c9805f',
  '#8fa9c4',
  '#b0b46a',
  '#d2776a',
  '#6f7f76',
] as const;

const VIEW_W = 1000;
const FILES_H = 120;
const CHURN_H = 74;
const GAP = 10;
const VIEW_H = FILES_H + GAP + CHURN_H;

type GrowthChartProps = {
  series: GrowthSeries;
  currentIndex: number;
  totalCommits: number;
  onSeek: (index: number) => void;
};

/**
 * Cumulative file count above, per-commit churn below, one playhead across both.
 *
 * Drawn as plain SVG: the data is a few hundred points and a charting library
 * would cost more than the whole client bundle it sits in.
 */
export function GrowthChart({ series, currentIndex, totalCommits, onSeek }: GrowthChartProps) {
  const { points, maxFiles, maxChurn } = series;
  const count = points.length;

  const geometry = useMemo(() => {
    if (count === 0) return null;
    const x = (index: number) => (count === 1 ? VIEW_W / 2 : (index / (count - 1)) * VIEW_W);
    const yFiles = (value: number) => FILES_H - (maxFiles === 0 ? 0 : (value / maxFiles) * (FILES_H - 6));

    const line = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${yFiles(point.fileCount).toFixed(2)}`)
      .join(' ');
    const area = `${line} L${x(count - 1).toFixed(2)},${FILES_H} L${x(0).toFixed(2)},${FILES_H} Z`;

    /*
     * The file-count line is split into measured and carried-forward runs. A
     * stretch where the intervening diffs have not loaded is drawn dashed
     * rather than presented as if it had been observed.
     */
    type Run = { measured: boolean; parts: string[] };
    const open: Run[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      const at = `${x(index).toFixed(2)},${yFiles(point.fileCount).toFixed(2)}`;
      const last = open.at(-1);
      if (!last || last.measured !== point.measured) {
        // Repeat the boundary point so the runs meet without a visual gap.
        if (last) last.parts.push(`L${at}`);
        open.push({ measured: point.measured, parts: [`M${at}`] });
      } else {
        last.parts.push(`L${at}`);
      }
    }
    const runs = open.map((run) => ({ measured: run.measured, d: run.parts.join(' ') }));

    const barWidth = Math.max(0.9, VIEW_W / Math.max(count, 1) - 0.6);
    const churnAxis = FILES_H + GAP + CHURN_H / 2;
    const bars = points.map((point, index) => {
      const scale = maxChurn === 0 ? 0 : CHURN_H / 2 / maxChurn;
      return {
        index,
        x: x(index) - barWidth / 2,
        addH: Math.max(point.additions > 0 ? 0.8 : 0, point.additions * scale),
        delH: Math.max(point.deletions > 0 ? 0.8 : 0, point.deletions * scale),
        known: point.known,
      };
    });

    return { x, yFiles, area, runs, bars, barWidth, churnAxis };
  }, [points, count, maxFiles, maxChurn]);

  if (!geometry || count === 0) {
    return <p className={styles.empty}>No commits loaded yet.</p>;
  }

  const playheadX = geometry.x(Math.min(currentIndex, count - 1));

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    onSeek(Math.round(ratio * (count - 1)));
  };

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          `Repository growth across ${count} loaded commits. ` +
          `Files rise from ${formatNumber(points[0]!.fileCount)} to ${formatNumber(points[count - 1]!.fileCount)}. ` +
          `Per-commit change counts are known for ${formatNumber(series.knownCommits)} of them.`
        }
        onPointerDown={handlePointer}
      >
        <defs>
          <linearGradient id="rtm-files" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(123, 203, 141, 0.30)" />
            <stop offset="100%" stopColor="rgba(123, 203, 141, 0.02)" />
          </linearGradient>
        </defs>

        <path d={geometry.area} fill="url(#rtm-files)" />
        {geometry.runs.map((run, index) => (
          <path
            key={index}
            d={run.d}
            className={run.measured ? styles.filesLine : styles.filesLineEstimated}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <line
          x1="0"
          x2={VIEW_W}
          y1={geometry.churnAxis}
          y2={geometry.churnAxis}
          className={styles.axis}
          vectorEffect="non-scaling-stroke"
        />

        {geometry.bars.map((bar) =>
          bar.known ? (
            <g key={bar.index}>
              {bar.addH > 0 ? (
                <rect
                  x={bar.x}
                  y={geometry.churnAxis - bar.addH}
                  width={geometry.barWidth}
                  height={bar.addH}
                  className={styles.barAdd}
                />
              ) : null}
              {bar.delH > 0 ? (
                <rect
                  x={bar.x}
                  y={geometry.churnAxis}
                  width={geometry.barWidth}
                  height={bar.delH}
                  className={styles.barDel}
                />
              ) : null}
            </g>
          ) : (
            <rect
              key={bar.index}
              x={bar.x}
              y={geometry.churnAxis - 1}
              width={geometry.barWidth}
              height={2}
              className={styles.barUnknown}
            />
          ),
        )}

        <line
          x1={playheadX}
          x2={playheadX}
          y1="0"
          y2={VIEW_H}
          className={styles.playhead}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <figcaption className={styles.caption}>
        <span>
          <span className={styles.swatchLine} aria-hidden="true" /> files in tree
        </span>
        <span>
          <span className={styles.swatchAdd} aria-hidden="true" /> additions
        </span>
        <span>
          <span className={styles.swatchDel} aria-hidden="true" /> deletions
        </span>
        {series.knownCommits < count ? (
          <span>
            <span className={styles.swatchDashed} aria-hidden="true" /> carried forward
          </span>
        ) : null}
        <span className={styles.coverage}>
          diffs loaded for {formatNumber(series.knownCommits)} of {formatNumber(count)} commits
          {totalCommits > count ? ` (range holds ${formatNumber(count)} of ${formatNumber(totalCommits)})` : ''}
        </span>
      </figcaption>

      <details className={styles.dataTable}>
        <summary>Read this chart as a table</summary>
        <div className={styles.tableScroll}>
          <table>
            <caption>
              Sampled from the {formatNumber(count)} loaded commits. Churn is blank where the diff has not been loaded.
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Date</th>
                <th scope="col">Files</th>
                <th scope="col">Added</th>
                <th scope="col">Deleted</th>
              </tr>
            </thead>
            <tbody>
              {sample(points, 24).map((point) => (
                <tr key={point.index}>
                  <td>{point.index + 1}</td>
                  <td>{formatDate(point.date)}</td>
                  <td className="tabular">{formatNumber(point.fileCount)}</td>
                  <td className="tabular">{point.known ? formatNumber(point.additions) : '—'}</td>
                  <td className="tabular">{point.known ? formatNumber(point.deletions) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function sample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]!);
}

export function LanguageBar({ estimate }: { estimate: LanguageEstimate }) {
  if (estimate.countedFiles === 0) {
    return <p className={styles.empty}>No recognised source files at this point.</p>;
  }

  return (
    <div className={styles.languages}>
      <div className={styles.langBar} role="img" aria-label={describeLanguages(estimate)}>
        {estimate.slices.map((slice, index) => (
          <span
            key={slice.language}
            className={styles.langSegment}
            style={{
              width: `${Math.max(slice.share * 100, 1.2)}%`,
              background: CATEGORY_COLOURS[index % CATEGORY_COLOURS.length],
            }}
            title={`${slice.language}: ${formatNumber(slice.files)} files (${formatPercent(slice.share)})`}
          />
        ))}
      </div>

      <ul className={styles.langLegend}>
        {estimate.slices.map((slice, index) => (
          <li key={slice.language}>
            <span
              className={styles.langDot}
              style={{ background: CATEGORY_COLOURS[index % CATEGORY_COLOURS.length] }}
              aria-hidden="true"
            />
            <span className={styles.langName}>{slice.language}</span>
            <span className={`${styles.langValue} tabular`}>
              {formatNumber(slice.files)}
              {slice.bytes !== null ? <span className={styles.langBytes}> · {formatBytes(slice.bytes)}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      <p className={styles.langNote}>
        Estimated from file extensions, not from file contents. {formatNumber(estimate.excluded)} binary or generated
        file{estimate.excluded === 1 ? '' : 's'} excluded; {formatNumber(estimate.unclassified)} unrecognised.
        {estimate.bytesPartial ? ' Byte totals cover only files that came from a tree snapshot.' : ''}
      </p>
    </div>
  );
}

function describeLanguages(estimate: LanguageEstimate): string {
  const parts = estimate.slices.map((slice) => `${slice.language} ${formatPercent(slice.share)}`);
  return `Estimated file-type composition: ${parts.join(', ')}.`;
}

export function ActivityGrid({ map, onSeek }: { map: ActivityMap; onSeek: (index: number) => void }) {
  if (map.areas.length === 0 || map.knownCommits === 0) {
    return (
      <p className={styles.empty}>
        Activity needs commit diffs. None have loaded for this range yet.
      </p>
    );
  }

  const cellByKey = new Map(map.cells.map((cell) => [`${cell.area} ${cell.bucket}`, cell.changes]));

  return (
    <div className={styles.activity}>
      <div className={styles.activityGrid} style={{ gridTemplateColumns: `auto repeat(${map.bucketCount}, 1fr)` }}>
        {map.areas.map((area) => (
          <div key={area} className={styles.activityRow} style={{ display: 'contents' }}>
            <span className={styles.activityLabel} title={area}>
              {area}
            </span>
            {Array.from({ length: map.bucketCount }, (_, bucket) => {
              const value = cellByKey.get(`${area} ${bucket}`) ?? 0;
              const intensity = map.max === 0 ? 0 : value / map.max;
              const range = map.buckets[bucket];
              return (
                <button
                  key={bucket}
                  type="button"
                  className={styles.activityCell}
                  style={{ background: `rgba(123, 203, 141, ${(0.06 + intensity * 0.72).toFixed(3)})` }}
                  onClick={() => range && onSeek(range.fromIndex)}
                  title={
                    range
                      ? `${area} — ${value} file change${value === 1 ? '' : 's'} in commits ${range.fromIndex + 1}–${range.toIndex + 1} (${formatDate(range.fromDate)})`
                      : undefined
                  }
                  aria-label={
                    range
                      ? `${area}, ${value} file changes in commits ${range.fromIndex + 1} to ${range.toIndex + 1}. Jump there.`
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className={styles.langNote}>
        Each column is a slice of the loaded range; darker means more changed files in that folder. Built from the{' '}
        {formatNumber(map.knownCommits)} commit diff{map.knownCommits === 1 ? '' : 's'} loaded so far.
      </p>
    </div>
  );
}
