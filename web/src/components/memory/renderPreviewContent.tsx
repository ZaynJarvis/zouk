import { Component, type ErrorInfo, type ReactNode } from 'react';
import { renderMarkdown, renderJson, renderJsonl, renderPlainCode } from './AtlasRenderers';
import { highlightCode } from './atlas-helpers';

const HIGHLIGHTABLE_LANGS = new Set(['javascript', 'typescript', 'tsx', 'jsx', 'python', 'bash', 'rust', 'go', 'css', 'scss']);

export function isMarkdownFile(name: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(name);
}

export function isJsonFile(name: string): boolean {
  return /\.json$/i.test(name);
}

export function isJsonlFile(name: string): boolean {
  return /\.(jsonl|ndjson)$/i.test(name);
}

export function detectLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'bash',
    bash: 'bash',
    css: 'css',
    scss: 'scss',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return map[ext] || '';
}

export function fileKindLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'FILE';
  return name.slice(dot + 1).toUpperCase().slice(0, 8);
}

export function isHighlightableLang(lang: string): boolean {
  return HIGHLIGHTABLE_LANGS.has(lang);
}

export function renderPreviewContent(text: string, fileName: string, className = ''): ReactNode {
  if (isMarkdownFile(fileName)) {
    return (
      <div className={`atlas-preview-md ${className}`} style={{ fontSize: 13, lineHeight: 1.65 }}>
        {renderMarkdown(text)}
      </div>
    );
  }

  if (isJsonlFile(fileName)) {
    return (
      <div className={`atlas-preview-jsonl ${className}`}>
        {renderJsonl(text)}
      </div>
    );
  }

  if (isJsonFile(fileName)) {
    return (
      <div className={`atlas-preview-json ${className}`}>
        {renderJson(text)}
      </div>
    );
  }

  const lang = detectLang(fileName);
  if (lang && isHighlightableLang(lang)) {
    return (
      <pre className={className} style={{ margin: 0, fontFamily: 'var(--zk-font-mono, monospace)', fontSize: 12, lineHeight: 1.6 }}>
        {highlightCode(text, lang)}
      </pre>
    );
  }

  return (
    <div className={`atlas-preview-code ${className}`}>
      {renderPlainCode(text, lang || undefined)}
    </div>
  );
}

interface PreviewContentProps {
  text: string;
  fileName: string;
  className?: string;
}

function PreviewContentRenderer({ text, fileName, className = '' }: PreviewContentProps) {
  return <>{renderPreviewContent(text, fileName, className)}</>;
}

export function RawPreviewContent({ text, fileName, className = '' }: PreviewContentProps) {
  const lang = detectLang(fileName);
  return (
    <div className={`atlas-preview-code ${className}`}>
      {renderPlainCode(text, lang || undefined)}
    </div>
  );
}

class PreviewRenderBoundary extends Component<PreviewContentProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Falling back to raw preview content after render failure', error, info.componentStack);
  }

  componentDidUpdate(prevProps: PreviewContentProps) {
    if (
      this.state.failed
      && (prevProps.text !== this.props.text
        || prevProps.fileName !== this.props.fileName
        || prevProps.className !== this.props.className)
    ) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <RawPreviewContent {...this.props} />;
    }
    return <PreviewContentRenderer {...this.props} />;
  }
}

export function SafePreviewContent(props: PreviewContentProps) {
  return <PreviewRenderBoundary {...props} />;
}
