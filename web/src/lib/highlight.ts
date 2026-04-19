// Best-effort syntax highlighter for chat-message code blocks.
// If `lang` is empty or not registered, returns null so callers can
// fall back to plain rendering — per product spec: no guessing when
// the author didn't declare a language.
import hljs from 'highlight.js/lib/common';

export function highlightCode(code: string, lang: string): string | null {
  if (!lang) return null;
  const supported = hljs.getLanguage(lang.toLowerCase());
  if (!supported) return null;
  try {
    return hljs.highlight(code, { language: lang.toLowerCase(), ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
