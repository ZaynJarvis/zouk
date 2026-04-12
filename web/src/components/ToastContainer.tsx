import { CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, CircleAlert as AlertCircle, Info } from 'lucide-react';
import { useApp } from '../store/AppContext';

const icons = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const colors = {
  success: 'border-cyber-green/40 bg-cyber-green/10 text-cyber-green',
  warning: 'border-cyber-yellow/40 bg-cyber-yellow/10 text-cyber-yellow',
  error: 'border-cyber-red/40 bg-cyber-red/10 text-cyber-red',
  info: 'border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan',
};

const glows = {
  success: 'shadow-neon-green',
  warning: 'shadow-neon-yellow',
  error: 'shadow-neon-red',
  info: 'shadow-neon-cyan',
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
            className={`flex items-center gap-2 px-3 py-2.5 border text-sm font-mono tracking-wider animate-toast-in ${colors[toast.type]} ${glows[toast.type]}`}
          >
            <Icon size={16} />
            <span className="flex-1">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
