import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogConfig {
 title: string;
 message: string;
 confirmLabel?: string;
 cancelLabel?: string;
 variant?: 'default' | 'danger' | 'warning';
 /** Extra content rendered between message and buttons (e.g. comparison info) */
 extraContent?: React.ReactNode;
}

interface ConfirmDialogProps extends ConfirmDialogConfig {
 onConfirm: () => void;
 onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
 title,
 message,
 confirmLabel = '确认',
 cancelLabel = '取消',
 variant = 'default',
 extraContent,
 onConfirm,
 onCancel,
}) => {
 const confirmRef = useRef<HTMLButtonElement>(null);

 // Focus trap + ESC to cancel
 useEffect(() => {
 confirmRef.current?.focus();
 const handler = (e: KeyboardEvent) => {
 if (e.key === 'Escape') onCancel();
 };
 document.addEventListener('keydown', handler);
 return () => document.removeEventListener('keydown', handler);
 }, [onCancel]);

 const variantStyles = {
 default: 'bg-ink-solid hover:bg-ink-solid-hover text-ink-base',
 danger: 'bg-red-500 hover:bg-red-600 text-ink-text',
 warning: 'bg-amber-500 hover:bg-amber-400 text-ink-base',
 };

 return (
 <div
 className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-[rgba(15,15,15,0.6)]"
 onClick={onCancel}
 role="dialog"
 aria-modal="true"
 aria-label={title}
 >
 <div
 className="bg-ink-surface border border-ink-border w-full max-w-lg rounded-modal shadow-glass overflow-hidden"
 onClick={e => e.stopPropagation()}
 style={{ animation: 'modal-fade-in 0.18s ease-out' }}
 >
 {/* Header */}
 <div className="px-6 py-4 border-b border-ink-borderSoft flex items-center justify-between">
 <div className="flex items-center gap-3">
 {variant !== 'default' && (
 <AlertTriangle className={`w-5 h-5 ${variant === 'danger' ? 'text-ink-danger' : 'text-orange-500'}`} />
 )}
 <h2 className="font-semibold text-[15px] text-ink-text">{title}</h2>
 </div>
 <button onClick={onCancel} className="p-1.5 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-elevated transition-colors">
 <X className="w-4 h-4" />
 </button>
 </div>

 {/* Body */}
 <div className="p-6 space-y-4">
 <p className="text-[13px] text-ink-muted leading-relaxed whitespace-pre-line">{message}</p>
 {extraContent}
 </div>

 {/* Footer */}
 <div className="px-6 py-4 border-t border-ink-borderSoft flex items-center justify-end gap-3">
 <button
 onClick={onCancel}
 className="px-4 py-2 text-[13px] font-medium text-ink-muted hover:text-ink-text transition-colors"
 >
 {cancelLabel}
 </button>
 <button
 ref={confirmRef}
 onClick={onConfirm}
 className={`px-6 py-2.5 text-[13px] font-semibold rounded-btn transition-colors ${variantStyles[variant]}`}
 >
 {confirmLabel}
 </button>
 </div>
 </div>
 </div>
 );
};
