import type { AvatarStatus } from '../lib/avatarStatus';

const COLOR: Record<AvatarStatus, string> = {
  offline: 'bg-nc-muted',
  online: 'bg-nc-green',
  working: 'bg-nc-yellow animate-pulse',
};

const LABEL: Record<AvatarStatus, string> = {
  offline: 'offline',
  online: 'online',
  working: 'working',
};

const SIZE = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
} as const;

export default function StatusDot({
  status,
  size = 'md',
  ringClass = 'border-nc-bg',
  hideWhen,
}: {
  status: AvatarStatus;
  size?: keyof typeof SIZE;
  ringClass?: string;
  hideWhen?: AvatarStatus[];
}) {
  if (hideWhen?.includes(status)) return null;
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 ${SIZE[size]} rounded-full border ${ringClass} ${COLOR[status]}`}
      title={LABEL[status]}
    />
  );
}
