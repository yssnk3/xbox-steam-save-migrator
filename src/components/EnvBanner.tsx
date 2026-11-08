import React from 'react';
import { AlertTriangle, FolderSearch, X, CheckCircle2 } from 'lucide-react';
import { EnvInfo } from '../types';

interface EnvBannerProps {
  env: EnvInfo;
  onFixSteam: () => void;
  onFixXbox: () => void;
  onDismiss: () => void;
}

/**
 * 启动自检提示条。
 * 只有真的探测失败时才出现——成功时完全不占空间，避免"通知疲劳"。
 */
export const EnvBanner: React.FC<EnvBannerProps> = ({ env, onFixSteam, onFixXbox, onDismiss }) => {
  const steamBad = !env.steam.detected;
  const xboxBad = !env.xbox.detected;
  if (!steamBad && !xboxBad) return null;

  const problems: { label: string; detail: string; onFix: () => void }[] = [];
  if (steamBad) {
    problems.push({
      label: '未检测到 Steam 安装目录',
      detail: 'Steam 存档无法被自动扫描，已装游戏的 Steam 侧会显示为空',
      onFix: onFixSteam,
    });
  }
  if (xboxBad) {
    problems.push({
      label: '未检测到 Xbox 游戏目录',
      detail: `未找到 ${env.xbox.packagesRoot || 'Packages'}，Game Pass 存档无法扫描`,
      onFix: onFixXbox,
    });
  }

  return (
    <div className="panel px-4 py-3 mb-4 border-l-2 border-l-ink-warning">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-ink-warning mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          {problems.map(p => (
            <div key={p.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13px] text-ink-text">{p.label}</span>
              <span className="t-meta">{p.detail}</span>
              <button
                onClick={p.onFix}
                className="btn-ghost px-2 py-0.5 text-[11px] flex items-center gap-1"
              >
                <FolderSearch className="w-3 h-3" />
                手动指定
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 t-meta">
            <CheckCircle2 className="w-3 h-3" />
            指定后会保存到设置，下次启动自动沿用
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded-btn text-ink-faint hover:text-ink-text hover:bg-ink-elevated transition-colors shrink-0"
          title="忽略本次提示"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default EnvBanner;
