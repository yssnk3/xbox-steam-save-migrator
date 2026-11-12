import React from 'react';
import { X } from 'lucide-react';

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

const STEPS = [
  { title: '自动扫描', body: '检测本机 Steam 与 Xbox 存档路径，列出所有存在存档的游戏。' },
  { title: '选择方向', body: '双端就绪的游戏排在最前，点击推荐方向即可执行，覆盖前自动备份。' },
  { title: '进游戏确认', body: '工具会给出落盘校验报告；存档能否读取仍需进游戏读档确认一次。' },
];

const TIPS = [
  '移植前自动创建 ZIP 备份，可在「备份中心」还原到原位置',
  '移植前会检测游戏是否运行，避免文件被锁定',
  'Xbox 云同步弹窗出现时，请选择「使用本地存档」',
];

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onDismiss }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,15,15,0.55)] p-4">
      <div className="glass-panel w-full max-w-lg relative">
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1.5 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-hover transition-colors"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-6 pb-4 border-b border-ink-border">
          <h1 className="t-title">Steam ↔ Xbox 存档移植</h1>
          <p className="t-meta mt-1">在 PC Game Pass 与 Steam 之间迁移游戏存档</p>
        </div>

        <div className="px-6 py-4">
          <ol className="space-y-2.5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="t-mono shrink-0 pt-0.5">{i + 1}.</span>
                <div>
                  <div className="text-[14px] text-ink-text">{s.title}</div>
                  <div className="t-meta mt-0.5">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-6 pb-4">
          <div className="text-[12px] text-ink-muted mb-1.5">注意</div>
          <ul className="space-y-1">
            {TIPS.map(t => (
              <li key={t} className="t-meta flex gap-2">
                <span className="text-ink-faint">·</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-6 pb-6">
          <button onClick={onDismiss} className="btn-primary w-full py-2 text-[14px]">
            开始使用
          </button>
        </div>
      </div>
    </div>
  );
};
