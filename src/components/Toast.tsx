import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
 id: string;
 type: ToastType;
 message: string;
}

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const TOAST_STYLES: Record<ToastType, { icon: React.ReactNode; bar: string; text: string; bg: string }> = {
 success: { icon: <CheckCircle2 className="w-4 h-4 text-green-600" />, bar: 'border-l-green-500', text: 'text-ink-text', bg: 'bg-ink-elevated/95 ' },
 error: { icon: <XCircle className="w-4 h-4 text-red-400" />, bar: 'border-l-red-500', text: 'text-ink-text', bg: 'bg-ink-elevated/95 ' },
 warning: { icon: <AlertTriangle className="w-4 h-4 text-orange-400" />, bar: 'border-l-orange-500', text: 'text-ink-text', bg: 'bg-ink-elevated/95 ' },
 info: { icon: <Info className="w-4 h-4 text-blue-400" />, bar: 'border-l-blue-500', text: 'text-ink-text', bg: 'bg-ink-elevated/95 ' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
 const [toasts, setToasts] = useState<ToastItem[]>([]);
 const counterRef = useRef(0);

 const toast = useCallback((message: string, type: ToastType = 'info') => {
 const id = `toast-${++counterRef.current}`;
 setToasts(prev => [...prev, { id, type, message }]);
 // Auto-dismiss after 5s (errors stay 8s)
 const timeout = type === 'error' ? 8000 : 5000;
 setTimeout(() => {
 setToasts(prev => prev.filter(t => t.id !== id));
 }, timeout);
 }, []);

 const dismiss = useCallback((id: string) => {
 setToasts(prev => prev.filter(t => t.id !== id));
 }, []);

 return (
 <ToastContext.Provider value={toast}>
 {children}
 {/* Toast container — top-center, non-blocking */}
 <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-full max-w-md px-4 pointer-events-none">
 {toasts.map(t => {
 const s = TOAST_STYLES[t.type];
 return (
 <div
 key={t.id}
 className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-btn border border-l-[3px] ${s.bar} border-ink-border ${s.bg} shadow-glass`}
 style={{ animation: 'toast-slide-in 0.25s ease-out' }}
 >
 <div className="shrink-0 mt-0.5">{s.icon}</div>
 <span className={`text-sm ${s.text} flex-1 break-words leading-relaxed font-medium`}>{t.message}</span>
 <button
 onClick={() => dismiss(t.id)}
 className="shrink-0 text-ink-faint hover:text-ink-text transition-colors"
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 );
 })}
 </div>
 </ToastContext.Provider>
 );
};
