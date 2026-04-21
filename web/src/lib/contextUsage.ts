import type { AgentContextUsageModel, AgentContextUsageSnapshot } from '../types';

export function formatTokenCount(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return value.toLocaleString();
}

export function formatContextPercent(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const pct = value * 100;
  const decimals = pct >= 10 ? 0 : 1;
  return `${pct.toFixed(decimals).replace(/\.0$/, '')}%`;
}

export function formatContextUsageLine(usage?: AgentContextUsageModel): string {
  if (!usage) return '';
  const total = usage.contextWindow ? formatTokenCount(usage.contextWindow) : '?';
  const percent = formatContextPercent(usage.percent);
  return `${formatTokenCount(usage.usedTokens)}/${total}${percent ? ` (${percent})` : ''}`;
}

export function formatContextUsageCompact(usage?: AgentContextUsageModel): string {
  if (!usage) return '';
  const used = formatTokenCount(usage.usedTokens);
  const percent = formatContextPercent(usage.percent);
  return percent ? `${used}/${percent}` : used;
}

export function contextUsageToneClass(percent?: number): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return 'border-nc-border bg-nc-elevated text-nc-muted';
  }
  if (percent >= 0.9) {
    return 'border-nc-red/40 bg-nc-red/10 text-nc-red';
  }
  if (percent >= 0.75) {
    return 'border-nc-yellow/40 bg-nc-yellow/10 text-nc-yellow';
  }
  return 'border-nc-cyan/40 bg-nc-cyan/10 text-nc-cyan';
}

export function contextUsageTextTone(percent?: number): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return 'text-nc-muted';
  }
  if (percent >= 0.8) return 'text-nc-red';
  if (percent >= 0.6) return 'text-nc-yellow';
  return 'text-nc-muted';
}

export function formatContextUsageTitle(snapshot?: AgentContextUsageSnapshot): string {
  if (!snapshot) return '';
  const summary = snapshot.summary;
  const total = summary.contextWindow?.toLocaleString() || 'unknown';
  const percent = formatContextPercent(summary.percent);
  const cost = typeof snapshot.totalCostUSD === 'number' ? ` · $${snapshot.totalCostUSD.toFixed(4)}` : '';
  return `${summary.model} · ${summary.usedTokens.toLocaleString()} / ${total} tokens${percent ? ` (${percent})` : ''}${cost}`;
}
