import { CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../store/AppContext';

const icons = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const colors = {
  success: 'bg-nb-green-light border-nb-green',
  warning: 'bg-nb-yellow-light border-nb-yellow',
  error: 'bg-nb-red-light border-nb-red',
  info: 'bg-nb-blue-light border-nb-blue',
};

const iconColors = {
  success: 'text-nb-green',
  warning: 'text-nb-yellow',
  error: 'text-nb-red',
  info: 'text-nb-blue',
};

export default function ToastContainer() {
  const { toasts } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2 w-80">
      {toasts.map(toast => {
        const Icon = icons[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-3 py-2.5 border-3 border-nb-black dark:border-dark-border shadow-nb text-sm font-medium text-nb-black animate-toast-in ${colors[toast.type]}`}
          >
            <Icon size={16} className={iconColors[toast.type]} />
            <span className="flex-1">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
