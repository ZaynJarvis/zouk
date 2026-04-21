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

// Claude drivers report usage for every model that ran during the turn,
// including Haiku (used for sub-agent/compaction work). For the sidebar pill
// we only want the agent's configured primary model — Haiku's context window
// is independent and its cumulative token counts don't represent "how full is
// the main conversation." Prefer the configured `agent.model`; fall back to
// the highest-percent entry that isn't Haiku.
export function pickDisplayContextUsage(
  snapshot?: AgentContextUsageSnapshot,
  preferredModel?: string,
): AgentContextUsageModel | undefined {
  if (!snapshot) return undefined;
  const { models, summary } = snapshot;
  if (preferredModel) {
    const exact = models.find(m => m.model === preferredModel);
    if (exact) return exact;
    const preferredLower = preferredModel.toLowerCase();
    const fuzzy = models.find(m => {
      const modelLower = m.model.toLowerCase();
      return modelLower.includes(preferredLower) || preferredLower.includes(modelLower);
    });
    if (fuzzy) return fuzzy;
  }
  const nonHaiku = models.filter(m => !m.model.toLowerCase().includes('haiku'));
  if (nonHaiku.length > 0) return nonHaiku[0];
  return summary;
}

export function formatContextUsageTitle(
  snapshot?: AgentContextUsageSnapshot,
  preferredModel?: string,
): string {
  if (!snapshot) return '';
  const display = pickDisplayContextUsage(snapshot, preferredModel) ?? snapshot.summary;
  const total = display.contextWindow?.toLocaleString() || 'unknown';
  const percent = formatContextPercent(display.percent);
  const cost = typeof snapshot.totalCostUSD === 'number' ? ` · $${snapshot.totalCostUSD.toFixed(4)}` : '';
  return `${display.model} · ${display.usedTokens.toLocaleString()} / ${total} tokens${percent ? ` (${percent})` : ''}${cost}`;
}
