// Shared friendly labels for runtime ids reported by daemons.
// Anything not in this map renders as the raw id, so daemons can introduce new
// runtimes without a frontend release — they just won't get a pretty label.
export const RUNTIME_LABELS: Record<string, string> = {
  hermes: 'Hermes Agent',
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  kimi: 'Kimi',
  vikingbot: 'VikingBot',
  gemini: 'Gemini CLI',
  coco: 'Coco',
  copilot: 'GitHub Copilot',
  cursor: 'Cursor',
};

export function formatRuntime(id: string | null | undefined): string {
  if (!id) return '';
  return RUNTIME_LABELS[id] || id;
}

export function formatRuntimes(ids: string[] | null | undefined): string {
  if (!ids || ids.length === 0) return '';
  return ids.map(formatRuntime).join(', ');
}
