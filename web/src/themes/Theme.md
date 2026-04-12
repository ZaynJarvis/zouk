# Theme System

## Adding a New Theme

Every theme **must** provide a `ThemeSelectButton` component. This is the button users see when choosing a theme on the Login screen and in Settings.

### Required structure

```
src/themes/<theme-name>/
  ThemeSelectButton.tsx   ← REQUIRED
```

### ThemeSelectButton contract

```tsx
interface Props {
  selected: boolean;
  onClick: () => void;
}
export default function ThemeSelectButton({ selected, onClick }: Props) { ... }
```

### Key rules

1. **Use inline styles only** — the button must use `all: 'unset'` (or equivalent full CSS reset) and define every visual property via inline `style`. This guarantees the button renders the theme's look regardless of the currently active theme's global CSS.
2. **Fully represent the theme** — colors, fonts, border styles, shadows, and any characteristic visual effects (scanlines, rounded corners, neon glow, etc.) should all be present in the button so users can preview the theme at a glance.
3. **No Tailwind / global class dependencies** — because the button may render while a different theme is active, it cannot rely on `nc-*` or any other theme-scoped utility classes.

### Registering the theme

Add an entry in `src/themes/index.ts`:

```ts
import MyThemeSelectButton from './<theme-name>/ThemeSelectButton';

// inside themeRegistry
'<theme-id>': {
  ThemeSelectButton: MyThemeSelectButton,
},
```

Also add the new theme ID to the `Theme` union in `src/types/index.ts`.
