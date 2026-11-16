import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clampLayout, getLayout, LayoutKey, persistLayout, setLayoutLive } from '../layout';

/**
 * 共用的拖拽手柄。
 *
 * 用 Pointer Events + setPointerCapture 而不是 mousedown/mousemove/mouseup：
 * 指针移出元素甚至移出窗口都能继续收到 move/up，不需要往 window 上挂监听器
 * 再在卸载时摘掉。一个 handle 就是一个元素，capture 天然把它和这次拖动绑定。
 *
 * 响应区域：手柄本体是可拖的 6px 条，但额外用 ::before 向外扩 6px 透明命中区
 * （见 index.css 的 .drag-handle），所以实际可抓宽度约 18px——比看起来好抓，
 * 又不会和相邻控件抢点击。
 * 光标：由 --drag-cursor 决定（col-resize / row-resize / 对角 resize），
 * 拖动期间给 body 加 .dragging 锁住全局光标，避免划过其它元素时闪烁。
 * 阈值：位移 < 3px 视为误触，不写存储、不报"已调整"。
 */

export type DragAxis = 'x' | 'y' | 'xy';

interface DragHandleProps {
  /** 改哪个配置项 */
  layoutKey: LayoutKey;
  /** xy 时需要分别指定两个键：[水平键, 垂直键] */
  layoutKeyY?: LayoutKey;
  /** 单轴 */
  axis?: DragAxis;
  /** 手柄贴在父元素的哪条边 —— 决定拖动的正负方向 */
  edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** 无障碍标签 */
  label: string;
  className?: string;
}

const DRAG_THRESHOLD = 3;

/** 每条边对应的光标；角用对角双箭头。 */
const CURSOR: Record<DragHandleProps['edge'], string> = {
  top: 'row-resize',
  bottom: 'row-resize',
  left: 'col-resize',
  right: 'col-resize',
  'top-left': 'nwse-resize',
  'bottom-right': 'nwse-resize',
  'top-right': 'nesw-resize',
  'bottom-left': 'nesw-resize',
};

export const DragHandle: React.FC<DragHandleProps> = ({
  layoutKey,
  layoutKeyY,
  axis = 'x',
  edge,
  label,
  className = '',
}) => {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; baseY: number; moved: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const layout = getLayout();
    start.current = {
      x: e.clientX,
      y: e.clientY,
      base: layout[layoutKey],
      baseY: layoutKeyY ? layout[layoutKeyY] : 0,
      moved: false,
    };
    // 指针捕获：后续 move/up 全部投给这个元素，即使指针已移出。
    // 捕获失败（指针已释放、或元素被卸载）不能阻断拖动——move 仍然靠 React
    // 的事件冒泡工作，只是指针移出元素后就收不到了。
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setDragging(true);
  }, [layoutKey, layoutKeyY]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    s.moved = true;

    // 左/上边的把手：往右下拖 = 尺寸变小，所以取反
    const growsNegative = edge.includes('left') || edge.startsWith('top');
    const sign = growsNegative ? -1 : 1;

    const patch: Record<string, number> = {};
    if (axis === 'x' || axis === 'xy') {
      patch[layoutKey] = s.base + sign * dx;
    }
    if (axis === 'y' || axis === 'xy') {
      const keyY = layoutKeyY || layoutKey;
      patch[keyY] = s.baseY + sign * dy;
    }
    setLayoutLive(patch as never);
  }, [axis, edge, layoutKey, layoutKeyY]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
    // 没越过阈值就当误触，不写存储
    if (!s?.moved) return;
    const layout = getLayout();
    const patch: Record<string, number> = { [layoutKey]: layout[layoutKey] };
    if (layoutKeyY) patch[layoutKeyY] = layout[layoutKeyY];
    void persistLayout(patch);
  }, [layoutKey, layoutKeyY]);

  // 拖动期间锁全局光标，避免划过其它元素时闪回默认箭头
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('dragging');
    return () => document.body.classList.remove('dragging');
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`drag-handle ${dragging ? 'is-dragging' : ''} ${className}`}
      style={{ ['--drag-cursor' as string]: CURSOR[edge] }}
      data-edge={edge}
    />
  );
};

export default DragHandle;