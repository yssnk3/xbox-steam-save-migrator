import React, { useState } from 'react';
import { addCustomGameApi } from '../services/api';
import { useToast } from './Toast';
import { X, Plus } from 'lucide-react';

interface CustomGameModalProps {
 visible: boolean;
 onClose: () => void;
 onSaved: () => void;
 onAddLog: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const CustomGameModal: React.FC<CustomGameModalProps> = ({ visible, onClose, onSaved, onAddLog }) => {
 const toast = useToast();
 const [name, setName] = useState('');
 const [steamSaveRelPath, setSteamSaveRelPath] = useState('');
 const [xboxPackageName, setXboxPackageName] = useState('');
 const [steamAppId, setSteamAppId] = useState('');
 const [saveFilePattern, setSaveFilePattern] = useState('*');
 const [processNames, setProcessNames] = useState('');
 const [notes, setNotes] = useState('');
 const [saving, setSaving] = useState(false);

 if (!visible) return null;

 const handleSubmit = async () => {
 if (!name.trim()) {
 toast('请填写游戏名称', 'warning');
 return;
 }
 if (!steamSaveRelPath.trim() && !xboxPackageName.trim()) {
 toast('请至少填写 Steam 存档路径或 Xbox 包名之一', 'warning');
 return;
 }

 setSaving(true);
 try {
 const procArray = processNames.split(/[,\s]+/).filter(Boolean);
 await addCustomGameApi({
 name: name.trim(),
 steamSaveRelPath: steamSaveRelPath.trim(),
 xboxPackageName: xboxPackageName.trim(),
 steamAppId: steamAppId.trim(),
 saveFilePattern: saveFilePattern.trim() || '*',
 processNames: procArray,
 notes: notes.trim() || '用户自定义游戏',
 });
 onAddLog(`已添加自定义游戏：${name.trim()}`, 'success');
 toast(`游戏《${name.trim()}》添加成功！`, 'success');
 // Reset form
 setName(''); setSteamSaveRelPath(''); setXboxPackageName('');
 setSteamAppId(''); setSaveFilePattern('*'); setProcessNames(''); setNotes('');
 onSaved();
 } catch (err: any) {
 onAddLog(`添加自定义游戏失败: ${err.message}`, 'error');
 toast(`添加失败: ${err.message}`, 'error');
 } finally {
 setSaving(false);
 }
 };

 return (
 <div
 className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
 onClick={e => { if (e.target === e.currentTarget) onClose(); }}
 role="dialog"
 aria-modal="true"
 aria-label="添加自定义游戏"
 >
 <div className="bg-ink-surface border border-ink-border w-full max-w-lg rounded-card overflow-hidden  modal-animate">
 
 {/* Header */}
 <div className="px-6 py-4 border-b border-ink-border flex items-center justify-between bg-ink-surface">
 <div className="flex items-center gap-3">
 <div className="p-2 rounded-card bg-ink-elevated border border-ink-border">
 <Plus className="w-5 h-5 text-ink-text" />
 </div>
 <h2 className="font-bold text-[15px] text-ink-text">添加自定义游戏</h2>
 </div>
 <button onClick={onClose} className="p-1.5 rounded-card text-ink-muted hover:text-ink-text hover:bg-ink-raised transition-colors">
 <X className="w-4 h-4" />
 </button>
 </div>

 {/* Body */}
 <div className="p-6 space-y-4">
 <div>
 <label className="text-ink-muted text-[12px] block mb-1 font-medium">游戏名称 *</label>
 <input
 type="text"
 value={name}
 onChange={e => setName(e.target.value)}
 placeholder="例如：Hades II"
 className="w-full bg-ink-elevated border border-ink-border rounded-card px-3 py-2 text-[13px] text-ink-text focus:outline-none focus:border-white/25"
 />
 </div>

 <div>
 <label className="text-ink-muted text-[12px] block mb-1 font-medium">Steam 存档路径（支持环境变量）</label>
 <input
 type="text"
 value={steamSaveRelPath}
 onChange={e => setSteamSaveRelPath(e.target.value)}
 placeholder="例如：%APPDATA%\\Hades II\\Saves\\"
 className="w-full bg-ink-elevated border border-ink-border rounded-card px-3 py-2 font-mono text-[11px] text-ink-text focus:outline-none focus:border-white/25"
 />
 <p className="text-[11px] text-ink-faint mt-1">支持 %APPDATA%, %LOCALAPPDATA%, %USERPROFILE%, %STEAM_USERDATA% 等</p>
 </div>

 <div>
 <label className="text-ink-muted text-[12px] block mb-1 font-medium">Xbox 包名通配模式</label>
 <input
 type="text"
 value={xboxPackageName}
 onChange={e => setXboxPackageName(e.target.value)}
 placeholder="例如：SupergiantGames.HadesII_*"
 className="w-full bg-ink-elevated border border-ink-border rounded-card px-3 py-2 font-mono text-[11px] text-ink-text focus:outline-none focus:border-white/25"
 />
 <p className="text-[11px] text-ink-faint mt-1">可在 %LOCALAPPDATA%\\Packages\\ 下查看实际包名，* 作为通配符</p>
 </div>

 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="text-ink-muted text-[12px] block mb-1 font-medium">Steam App ID</label>
 <input
 type="text"
 value={steamAppId}
 onChange={e => setSteamAppId(e.target.value)}
 placeholder="可选"
 className="w-full bg-ink-elevated border border-ink-border rounded-card px-3 py-2 text-[13px] text-ink-text focus:outline-none focus:border-white/25"
 />
 </div>
 <div>
 <label className="text-ink-muted text-[12px] block mb-1 font-medium">文件模式</label>
 <input
 type="text"
 value={saveFilePattern}
 onChange={e => setSaveFilePattern(e.target.value)}
 placeholder="*.sav"
 className="w-full bg-ink-elevated border border-ink-border rounded-card px-3 py-2 text-[13px] text-ink-text focus:outline-none focus:border-white/25"
 />
 </div>
 </div>

 <div>
 <label className="text-ink-muted text-[12px] block mb-1 font-medium">游戏进程名（逗号分隔，用于迁移前检测）</label>
 <input
 type="text"
 value={processNames}
 onChange={e => setProcessNames(e.target.value)}
 placeholder="例如：Hades2"
 className="w-full bg-ink-elevated border border-ink-border rounded-card px-3 py-2 text-[13px] text-ink-text focus:outline-none focus:border-white/25"
 />
 </div>

 <div>
 <label className="text-ink-muted text-[12px] block mb-1 font-medium">备注</label>
 <textarea
 value={notes}
 onChange={e => setNotes(e.target.value)}
 placeholder="兼容性说明或安全提示..."
 rows={2}
 className="w-full bg-ink-elevated border border-ink-border rounded-card px-3 py-2 text-[13px] text-ink-text focus:outline-none focus:border-white/25 resize-none"
 />
 </div>
 </div>

 {/* Footer */}
 <div className="px-6 py-4 border-t border-ink-border bg-ink-surface flex items-center justify-end gap-3">
 <button onClick={onClose} className="px-4 py-2 text-[13px] font-semibold text-ink-muted hover:text-ink-text transition-colors">
 取消
 </button>
 <button
 onClick={handleSubmit}
 disabled={saving}
 className="px-6 py-2.5 text-[13px] font-bold rounded-card bg-ink-solid hover:bg-ink-solid-hover text-ink-base transition-colors disabled:opacity-50 flex items-center gap-2"
 >
 {saving && <span className="w-3.5 h-3.5 border-2 border-ink-base border-t-transparent rounded-full animate-spin"></span>}
 {saving ? '保存中...' : '添加游戏'}
 </button>
 </div>
 </div>
 </div>
 );
};
