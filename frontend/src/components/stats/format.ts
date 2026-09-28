/**
 * How statistics read: durations in the largest units that matter, token counts in
 * k/M, shares as percentages. Missing values render as an em dash, never as 0.
 */
export const NONE = '—';

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NONE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = Math.round(seconds % 60);
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return NONE;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1))}M`;
  if (abs >= 10_000) return `${trim((n / 1000).toFixed(abs >= 100_000 ? 0 : 1))}k`;
  return Math.round(n).toLocaleString('en-US');
}

export function formatPercent(share: number | null | undefined, digits = 0): string {
  if (share === null || share === undefined) return NONE;
  return `${(share * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return NONE;
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return NONE;
  return trim(value.toFixed(digits));
}

function trim(fixed: string): string {
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}
