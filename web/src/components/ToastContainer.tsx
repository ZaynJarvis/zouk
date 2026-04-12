import { CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../store/AppContext';

const icons = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const styles = {
  success: 'border-nc-green bg-nc-green/10 text-nc-green',
  warning: 'border-nc-yellow bg-nc-yellow/10 text-nc-yellow',
  error: 'border-nc-red bg-nc-red/10 text-nc-red',
  info: 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan',
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
            className={`flex items-center gap-2 px-3 py-2.5 border text-sm font-medium animate-toast-in ${styles[toast.type]}`}
          >
            <Icon size={16} />
            <span className="flex-1 font-mono text-xs">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
