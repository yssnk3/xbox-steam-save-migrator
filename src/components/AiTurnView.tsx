import React from 'react';
import { ChevronRight } from 'lucide-react';
import { AiTurn } from '../types';

/**
 * AI 回答的三段式渲染（原因 / 可能方案 / 下一步操作）。
 *
 * 从 FailureAssistantModal 抽出，供失败弹窗与 AI 面板共用——
 * 两处展示的是同一批数据，不该有两套解析逻辑。
 */

/** 把模型返回的纯文本拆成带标题的段落。 */
export function parseSections(text: string): { label: string; body: string[] }[] {
  const lines = (text || '').split(/\r?\n/);
  const sections: { label: string; body: string[] }[] = [];
  let current: { label: string; body: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const m = /^(原因|可能方案|下一步操作)[：:]\s*(.*)$/.exec(line);
    if (m) {
      current = { label: m[1], body: m[2] ? [m[2]] : [] };
      sections.push(current);
      continue;
    }
    if (!line) continue;
    if (current) current.body.push(line.replace(/^[-•*]\s*/, ''));
  }

  // 模型没按格式输出 — 整段显示而不是丢掉
  if (sections.length === 0) return [{ label: '分析结果', body: lines.filter(l => l.trim()) }];
  return sections;
}

const SECTION_ACCENT: Record<string, string> = {
  原因: 'text-ink-warning',
  可能方案: 'text-ink-text',
  下一步操作: 'text-ink-text',
};

interface AiTurnViewProps {
  /** 一轮回答的纯文本 */
  text: string;
  /** 紧凑模式：面板内使用，字号略小 */
  compact?: boolean;
}

/** 渲染单轮回答的三段式内容。 */
export const AiTurnView: React.FC<AiTurnViewProps> = ({ text, compact }) => {
  const bodySize = compact ? 'text-[11px]' : 'text-[12px]';
  return (
    <div className="space-y-3">
      {parseSections(text).map((sec, i) => (
        <div key={i}>
          <h4 className={`${bodySize} font-medium mb-1.5 ${SECTION_ACCENT[sec.label] || 'text-ink-text'}`}>
            {sec.label}
          </h4>
          {sec.body.length === 1 ? (
            <p className={`${bodySize} text-ink-text leading-relaxed`}>{sec.body[0]}</p>
          ) : (
            <ul className="space-y-1">
              {sec.body.map((b, j) => (
                <li key={j} className={`${bodySize} text-ink-text leading-relaxed flex gap-2`}>
                  <ChevronRight className="w-3 h-3 text-ink-faint mt-1 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};

interface AiConversationProps {
  turns: AiTurn[];
  compact?: boolean;
}

/** 渲染整段对话（用户提问在右，模型回答在左）。 */
export const AiConversation: React.FC<AiConversationProps> = ({ turns, compact }) => {
  const bubble = compact ? 'text-[11px]' : 'text-[12px]';
  return (
    <div className="space-y-4">
      {turns.map((turn, ti) => (
        <div key={ti} className="space-y-2">
          {turn.question && (
            <div className="flex justify-end">
              <div className={`max-w-[85%] px-3 py-2 rounded-card bg-ink-elevated ${bubble} text-ink-text`}>
                {turn.question}
              </div>
            </div>
          )}
          <AiTurnView text={turn.answer} compact={compact} />
        </div>
      ))}
    </div>
  );
};

export default AiTurnView;
