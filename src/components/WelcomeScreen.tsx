import React from 'react';
import { Gamepad2, ArrowRightLeft, ShieldCheck, X } from 'lucide-react';

interface WelcomeScreenProps {
 onDismiss: () => void;
}

const WELCOME_DISMISSED_KEY = 'xbox-steam-welcome-dismissed';

export function isWelcomeDismissed(): boolean {
 return localStorage.getItem(WELCOME_DISMISSED_KEY) === 'true';
}

export function dismissWelcome(): void {
 localStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onDismiss }) => {
 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
 <div className="glass-panel max-w-xl mx-4 p-8 rounded-card relative">
 <button
 onClick={onDismiss}
 className="absolute top-4 right-4 p-2 rounded-card text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
 >
 <X className="w-5 h-5" />
 </button>

 <div className="text-center mb-6">
 <div className="inline-flex items-center justify-center w-14 h-14 rounded-card bg-ink-surface/[0.06] text-zinc-200 mb-4 border border-white/[0.1]">
 <ArrowRightLeft className="w-8 h-8" />
 </div>
 <h1 className="font-bold text-xl text-white">
 Steam ↔ Xbox 存档移植工具
 </h1>
 <p className="text-sm text-zinc-400 mt-2">
 一键迁移你在 Xbox PC Game Pass 和 Steam 之间的游戏存档，无需任何手动操作
 </p>
 </div>

 <div className="space-y-4 mb-6">
 {/* Step 1 */}
 <div className="flex items-start gap-4 p-4 rounded-card bg-zinc-900/60 border border-zinc-800">
 <div className="flex-shrink-0 w-9 h-9 rounded-card bg-ink-surface/[0.06] text-zinc-300 flex items-center justify-center font-semibold text-base border border-white/[0.1]">1</div>
 <div>
 <h3 className="font-semibold text-white text-sm">启动程序，自动扫描</h3>
 <p className="text-xs text-zinc-400 mt-1">工具会自动检测本机 Steam 和 Xbox 存档路径，列出所有已安装且存在存档的游戏。</p>
 </div>
 </div>

 {/* Step 2 */}
 <div className="flex items-start gap-4 p-4 rounded-card bg-zinc-900/60 border border-zinc-800">
 <div className="flex-shrink-0 w-10 h-10 rounded-card bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-lg border border-indigo-500/20">2</div>
 <div>
 <h3 className="font-semibold text-white text-sm">选择方向，一键移植</h3>
 <p className="text-xs text-zinc-400 mt-1">双端就绪的游戏会自动排在最前，点击推荐方向按钮即可执行。系统自动备份原存档，全程无需手动操作。</p>
 </div>
 </div>

 {/* Step 3 */}
 <div className="flex items-start gap-4 p-4 rounded-card bg-zinc-900/60 border border-zinc-800">
 <div className="flex-shrink-0 w-10 h-10 rounded-card bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-lg border border-amber-500/20">3</div>
 <div>
 <h3 className="font-semibold text-white text-sm">启动游戏，验证存档</h3>
 <p className="text-xs text-zinc-400 mt-1">移植完成后，工具会显示落盘对账报告（含 MD5 哈希校验）。但最终存档是否能被游戏读取，需要你启动游戏读档确认一次。</p>
 </div>
 </div>
 </div>

 {/* Tips */}
 <div className="p-4 rounded-card bg-ink-surface/[0.03] border border-white/[0.08] mb-6">
 <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold mb-2">
 <ShieldCheck className="w-4 h-4" />
 <span>安全提示</span>
 </div>
 <ul className="text-xs text-zinc-400 space-y-1 ml-6 list-disc">
 <li>移植前会自动创建 ZIP 备份，可随时在「备份中心」恢复</li>
 <li>移植前会检测游戏是否正在运行，确保不会文件锁定</li>
 <li>如果 Xbox 云同步弹出选择框，请务必选择「使用本地存档」</li>
 </ul>
 </div>

 <button
 onClick={onDismiss}
 className="w-full py-3.5 rounded-card font-bold text-sm bg-ink-accent text-white hover:brightness-110 active:brightness-95 transition-all"
 >
 我已了解，开始使用
 </button>
 </div>
 </div>
 );
};