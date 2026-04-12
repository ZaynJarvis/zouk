/** Returns true when the active theme is Night City (cyberpunk effects enabled). */
export function isNightCity(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'night-city';
}

/** Returns the style object only when Night City is active; otherwise empty. */
export function ncStyle(styles: React.CSSProperties): React.CSSProperties {
  return isNightCity() ? styles : {};
}
