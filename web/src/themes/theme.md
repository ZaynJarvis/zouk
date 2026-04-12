# Zouk Theme System

Zouk uses a pluggable CSS custom-property theme system. Each theme lives in its own folder under `web/src/themes/` and provides a complete set of design tokens. Switching themes changes every color, font, and glow in the UI without touching any component code.

## Architecture

```
web/src/themes/
  index.ts              # Registry: ThemeDefinition[], applyTheme(), getTheme()
  night-city/
    index.ts            # Theme metadata + preview colors
    tokens.css          # CSS custom properties
  daylight/
    index.ts
    tokens.css
  brutalist/
    index.ts
    tokens.css
```

### How it works

1. **CSS custom properties** — Each theme defines ~22 tokens as RGB channel triplets (e.g., `--nc-cyan: 94 246 255`).
2. **Tailwind integration** — `tailwind.config.js` maps each token to Tailwind colors using the `<alpha-value>` pattern: `'rgb(var(--nc-cyan) / <alpha-value>)'`. This lets components use `bg-nc-cyan/10`, `text-nc-red`, etc.
3. **Specificity** — `:root` in `index.css` holds fallback values (night-city defaults). Theme tokens use `html[data-theme="..."]` selector (specificity 0,1,1) to reliably override `:root` (0,1,0) regardless of CSS source order.
4. **No flash** — `index.html` includes an inline `<script>` that reads `localStorage.zouk_theme` and sets `data-theme` on `<html>` before React hydrates.
5. **State** — `appStore.ts` manages theme state, persists to `localStorage`, and syncs `data-theme` attribute via `useEffect`.

## Creating a New Theme

### Step 1: Create theme folder

```
web/src/themes/my-theme/
  index.ts
  tokens.css
```

### Step 2: Define tokens (`tokens.css`)

All values are **space-separated RGB channels** (not hex, not `rgb()`). This is required for Tailwind's `<alpha-value>` pattern.

```css
html[data-theme="my-theme"] {
  /* Surfaces */
  --nc-black: 10 10 15;        /* Deepest background */
  --nc-deep: 13 13 20;         /* Secondary background */
  --nc-surface: 18 18 26;      /* Card/panel background */
  --nc-elevated: 26 26 38;     /* Hover/elevated surface */
  --nc-border: 42 42 58;       /* Default border */
  --nc-border-bright: 58 58 82;/* Emphasized border */
  --nc-panel: 15 15 23;        /* Panel background */

  /* Accent colors */
  --nc-red: 247 80 73;         /* Error, danger, destructive */
  --nc-green: 115 248 85;      /* Success, online, positive */
  --nc-cyan: 94 246 255;       /* Primary accent, links, focus */
  --nc-yellow: 255 216 74;     /* Warning, highlight */
  --nc-magenta: 224 64 251;    /* Secondary accent */
  --nc-indigo: 14 14 231;      /* Tertiary accent */

  /* Text */
  --nc-text: 200 214 229;      /* Body text */
  --nc-text-bright: 232 240 248;/* Headings, emphasis */
  --nc-muted: 90 100 120;      /* Secondary text, labels */

  /* Selection */
  --nc-selection-bg: 94 246 255;
  --nc-selection-text: 232 240 248;

  /* Font stacks */
  --nc-font-display: 'Orbitron', system-ui, sans-serif;
  --nc-font-body: 'Rajdhani', system-ui, sans-serif;
  --nc-font-mono: 'Space Mono', 'JetBrains Mono', monospace;
}
```

**Important:** The selector MUST be `html[data-theme="my-theme"]` (not just `[data-theme="..."]`) to ensure specificity beats the `:root` fallback.

### Step 3: Export metadata (`index.ts`)

```typescript
import './tokens.css';

export const myTheme = {
  id: 'my-theme' as const,
  name: 'My Theme',
  description: 'Short tagline for the theme picker',
  preview: {
    bg: '#0a0a0f',      // hex of --nc-black
    surface: '#12121a',  // hex of --nc-surface
    accent: '#5EF6FF',   // hex of --nc-cyan
    text: '#c8d6e5',     // hex of --nc-text
  },
};
```

Preview colors are used in the theme picker cards (Settings > Display and Login screen). Use hex values matching your RGB tokens.

### Step 4: Register the theme

**`web/src/themes/index.ts`** — Add to the registry:

```typescript
import { myTheme } from './my-theme';

export type ThemeId = 'night-city' | 'daylight' | 'brutalist' | 'my-theme';

export const themes: ThemeDefinition[] = [nightCity, daylight, brutalist, myTheme];
```

**`web/src/main.tsx`** — Import so Vite bundles the CSS:

```typescript
import './themes/my-theme';
```

**`web/src/store/appStore.ts`** — Add to the validation check:

```typescript
if (stored === 'night-city' || stored === 'daylight' || stored === 'brutalist' || stored === 'my-theme') return stored;
```

**`web/src/types/index.ts`** — Update the Theme type:

```typescript
export type Theme = 'night-city' | 'daylight' | 'brutalist' | 'my-theme';
```

### Step 5: Add custom fonts (if needed)

If your theme uses non-system fonts, add them to the Google Fonts link in `web/index.html`:

```html
<link href="https://fonts.googleapis.com/css2?family=YourFont:wght@400;700&display=swap" rel="stylesheet">
```

## Token Reference

| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--nc-black` | `bg-nc-black` | Deepest background |
| `--nc-surface` | `bg-nc-surface` | Card/panel backgrounds |
| `--nc-elevated` | `bg-nc-elevated` | Hover states, elevated cards |
| `--nc-border` | `border-nc-border` | Default borders |
| `--nc-cyan` | `text-nc-cyan`, `bg-nc-cyan/10` | Primary accent |
| `--nc-red` | `text-nc-red` | Errors, destructive actions |
| `--nc-green` | `text-nc-green` | Success, online status |
| `--nc-yellow` | `text-nc-yellow` | Warnings, highlights |
| `--nc-text` | `text-nc-text` | Body text |
| `--nc-text-bright` | `text-nc-text-bright` | Headings |
| `--nc-muted` | `text-nc-muted` | Secondary text |
| `--nc-font-display` | `font-display` | Headings, titles |
| `--nc-font-body` | `font-body` | Body text |
| `--nc-font-mono` | `font-mono` | Code, labels |

Tailwind opacity modifiers work on all color tokens: `bg-nc-cyan/20`, `border-nc-red/50`, etc.

## Cyberpunk Effects & Glitch Components

All cyberpunk visual effects are **scoped to the Night City theme only**. On other themes, the UI renders clean — no clip-path bevels, no neon glows, no scanlines, no glitch artifacts.

### CSS scoping (`index.css`)

- **Base styles** (all themes): structural properties — `position`, `border`, `background`, `transition`, `display`. Buttons are flat rectangles, panels are plain bordered boxes, no gradients or shadows.
- **Night City overrides** (`html[data-theme="night-city"] .class`): adds clip-path bevels, gradient backgrounds, neon box-shadows, scanline pseudo-elements, hue-strobe hover animations. These only apply when `data-theme="night-city"`.

### React components (`components/glitch/`)

- **ScanlineTear** — On Night City: renders overlay div with glitch effect via `useGlitch` hook. On other themes: renders `<div>{children}</div>` directly — no overlay, no hook attachment, no RAF cycles.
- **GlitchText** — On Night City: renders with `glitch-text` class and `data-text` attribute for pseudo-element effects. On other themes: renders plain `<Tag>{children}</Tag>`.
- **GlitchTransition** — On Night City: full-screen glitch transition with bars and scramble text. On other themes: calls `onComplete` immediately with no visual effect.

### Inline styles (`ncStyle` helper)

For inline `textShadow` neon glows, use the `ncStyle()` helper from `lib/themeUtils.ts`:

```tsx
import { ncStyle } from '../lib/themeUtils';

<div style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}>
```

`ncStyle()` returns the style object on Night City, empty object `{}` on other themes.

## Existing Themes

| Theme | Character | Fonts |
|-------|-----------|-------|
| **Night City** | Dark cyberpunk — neon glows, scanlines | Orbitron / Rajdhani / Space Mono |
| **Daylight** | Clean light — soft grays, muted accents | Orbitron / Rajdhani / Space Mono |
| **Brutalist** | Bold neobrutalist — thick borders, punchy primaries | Space Grotesk / Space Mono |
