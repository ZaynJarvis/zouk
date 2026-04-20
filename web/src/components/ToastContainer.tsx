import { CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../store/AppContext';

const icons = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const styles = {
  success: 'border-nc-green bg-nc-green/90 text-nc-black',
  warning: 'border-nc-yellow bg-nc-yellow/90 text-nc-black',
  error: 'border-nc-red bg-nc-red/90 text-white',
  info: 'border-nc-cyan bg-nc-cyan/90 text-nc-black',
};

export default function ToastContainer() {
  const { toasts } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-[min(22rem,calc(100%-2rem))] pointer-events-none">
      {toasts.map(toast => {
        const Icon = icons[toast.type];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto w-full flex items-center gap-2 px-3 py-2.5 border text-sm font-bold shadow-lg backdrop-blur-md animate-toast-in ${styles[toast.type]}`}
          >
            <Icon size={16} />
            <span className="flex-1 font-mono text-xs">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
