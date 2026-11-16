// Toasts: const toast = useToast(); toast('Moved to trash', { label: 'Undo', onClick: restore })
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Action = { label: string; onClick: () => void };
const ToastContext = createContext<(text: string, action?: Action) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ text: string; action?: Action } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, action?: Action) => {
    setT({ text, action });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 6000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {t && (
        <div className="toast no-print" role="status">
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.onClick();
                setT(null);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
