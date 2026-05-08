import { Menu } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function MobileMenuButton() {
  const { setSidebarOpen } = useApp();

  return (
    <button
      type="button"
      onClick={() => setSidebarOpen(true)}
      className="zk-btn zk-btn--ghost zk-btn--icon lg:!hidden"
      aria-label="Open menu"
      title="Open menu"
      style={{ flexShrink: 0 }}
    >
      <Menu size={16} />
    </button>
  );
}
