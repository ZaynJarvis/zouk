# Zouk Theme System

Zouk currently ships one theme: **Atlas**. Atlas supports resolved light/dark
mode through `data-mode="light|dark"` and keeps the same `data-theme="atlas"`
identity in both modes.

## Runtime Flow

1. `web/index.html` runs a boot script before React hydrates.
2. The script always sets `data-theme="atlas"`.
3. It reads `localStorage.zouk_color_mode` (`light`, `dark`, or `system`) and writes the resolved `data-mode`.
4. React state in `appStore.ts` persists theme/color-mode preferences.
5. `themes/index.ts` exposes the registry used by `LoginScreen` and `SettingsModal`.

Legacy stored theme values are intentionally migrated to Atlas.

## Files

- `themes/index.ts`: theme registry, color-mode resolver, `applyTheme()`.
- `themes/atlas/index.ts`: Atlas metadata and preview colors.
- `themes/atlas/tokens.css`: Atlas light/dark CSS custom properties.
- `themes/atlas/ThemeSelectButton.tsx`: self-contained theme picker button.
- `index.css`: global base/component styles that consume `--nc-*` and `--atlas-*` tokens.
- `styles/zk-tokens.css`: additional Atlas/ZK semantic tokens used by newer surfaces.

## Token Rules

- Use RGB channel tokens, e.g. `--nc-cyan: 160 90 68`.
- Tailwind maps tokens with alpha support, e.g. `bg-nc-cyan/10`.
- Keep semantic status colors meaningful: red = error, green = success/online, yellow = warning.
- Keep Atlas-specific tokens under `--atlas-*` when they do not belong in the older `--nc-*` compatibility set.

## Adding Another Theme

Do not add another theme by copying stale legacy folders. If a second shipped
theme is needed, update all four places together:

- Add `themes/<id>/index.ts`, `tokens.css`, and `ThemeSelectButton.tsx`.
- Add the theme id to `ThemeId` in `themes/index.ts`.
- Add the same id to `Theme` in `types/index.ts`.
- Update the boot script in `web/index.html` and `getStoredTheme()` in `store/storage.ts`.

Keep `ThemeSelectButton` self-contained: it should not depend on current global
theme classes, because it is rendered while a different theme may be active.

## Current Compatibility Debt

`themeUtils.ts`, `ScanlineTear`, and `GlitchTransition` still preserve old
Night-City compatibility paths. Under Atlas they are effectively no-op wrappers
except for explicit theme-agnostic transitions. Remove them in a dedicated UI
cleanup because they are still wired through settings and agent-creation flows.
