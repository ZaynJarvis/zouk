import { useEffect, useRef, useState } from 'react';

// Must mirror USERNAME_CHARSET in the server (server/index.js): a display name
// is used verbatim as the user's OV peer_id, so it can only contain these chars.
const USERNAME_CHARSET = /^[a-zA-Z0-9_.@-]+$/;

interface Props {
  open: boolean;
  // 'email' shows a plain name field; 'guest' locks a non-editable `guest-`
  // prefix and only lets the user edit the suffix.
  kind: 'email' | 'guest';
  // For 'email' this is the full default name; for 'guest' it is the suffix
  // (without the `guest-` prefix).
  defaultValue: string;
  // Confirm yields the full name for 'email' and the suffix for 'guest'.
  onConfirm: (value: string) => void;
  onSkip: () => void;
}

export default function UsernameSetupModal({ open, kind, defaultValue, onConfirm, onSkip }: Props) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the field whenever the picker (re)opens with a fresh default.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Focus + select so the user can immediately overwrite the default.
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const isGuest = kind === 'guest';
  const trimmed = value.trim();
  // Any non-empty value must fit the peer_id charset; an empty suffix is fine for
  // guests (the server falls back to a random one) but email users must keep a
  // non-empty name.
  const charsetViolation = trimmed.length > 0 && !USERNAME_CHARSET.test(trimmed);
  const canConfirm = (isGuest || trimmed.length > 0) && !charsetViolation;

  const submit = () => {
    if (!canConfirm) return;
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 bg-nc-black/70 flex items-center justify-center z-50 animate-fade-in p-4 safe-top safe-bottom"
      onClick={(e) => e.target === e.currentTarget && onSkip()}
    >
      <div className="cyber-panel w-full max-w-sm p-6 animate-bounce-in">
        <h2 className="font-display font-bold text-lg text-nc-text-bright mb-1">
          {isGuest ? 'Pick a guest name' : 'Welcome to Zouk'}
        </h2>
        <p className="text-sm text-nc-muted mb-4">
          {isGuest
            ? 'Choose a display name for this session. The guest- prefix stays.'
            : 'Choose how your name shows up. You can change it later in Settings.'}
        </p>

        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">
          Display Name
        </label>
        {isGuest ? (
          <div className="flex items-stretch">
            <span className="flex items-center px-3 text-sm font-mono text-nc-muted bg-nc-deep border border-r-0 border-nc-border select-none">
              guest-
            </span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="name"
              className="cyber-input flex-1 min-w-0 px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            className="cyber-input w-full px-3 py-2 text-sm"
          />
        )}

        {charsetViolation && (
          <p className="text-xs text-nc-red mt-1.5">
            Only letters, digits, and _ . @ - (no spaces).
          </p>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onSkip}
            className="cyber-btn px-4 py-2 border border-nc-border text-nc-muted font-bold text-sm tracking-wider hover:text-nc-text hover:border-nc-text/50"
          >
            Skip
          </button>
          <button
            onClick={submit}
            disabled={!canConfirm}
            className="cyber-btn px-4 py-2 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan font-bold text-sm tracking-wider disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
