import { useLayoutEffect, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { ShortcutIcon } from './ShortcutIcon';
import type { Shortcut } from './shared/preferences';

const VISIBLE_ROWS = 3;
const FADE_GAP = 16;
const FOOTER_ROOM = 24;

/**
 * Flat shortcut grid. It shows everything that fits in three rows; beyond that
 * the grid is clipped with a fade and can be expanded, instead of hiding the
 * rest behind an inner scrollbar that swallowed the wheel.
 */
export function ShortcutGrid({ shortcuts, canEdit, onEdit, onAdd, onMove }: {
  shortcuts: Shortcut[]; canEdit: boolean; onEdit: (id: string) => void; onAdd: () => void; onMove: (from: number, to: number) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState<number>();
  // Rows are measured from the unclipped grid and only re-read when the content or
  // the viewport changes. A ResizeObserver here would feed its own maxHeight back
  // into the grid and keep the fade flickering.
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const measure = () => {
      const items = Array.from(node.children).filter(child => child.classList.contains('shortcut-item')) as HTMLElement[];
      if (!items.length) { setOverflow(false); setLimit(undefined); return; }
      const tops = [...new Set(items.map(item => item.offsetTop))].sort((a, b) => a - b);
      const rowHeight = tops.length > 1 ? tops[1] - tops[0] : items[0].offsetHeight;
      // Short screens keep the footer on screen: never more rows than fit between
      // the grid and the fold, and never fewer than one.
      const room = window.innerHeight - node.getBoundingClientRect().top - FOOTER_ROOM;
      const fit = Math.max(1, Math.min(VISIBLE_ROWS, Math.floor(room / rowHeight) || 1));
      if (tops.length <= fit) { setOverflow(false); setLimit(undefined); return; }
      const padTop = Number.parseFloat(getComputedStyle(node).paddingTop) || 0;
      const gridTop = node.getBoundingClientRect().top;
      const rowBottom = Math.max(...items.filter(item => item.offsetTop === tops[fit - 1]).map(item => item.getBoundingClientRect().bottom));
      setOverflow(true);
      setLimit(Math.ceil(rowBottom - gridTop + padTop + FADE_GAP));
    };
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    void document.fonts?.ready.then(onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [shortcuts.length]);
  const clipped = overflow && !expanded;
  return <>
    <div ref={grid} className={`shortcut-grid${clipped ? ' is-collapsed' : ''}`} style={clipped && limit ? { maxHeight: limit } : undefined}>
      {shortcuts.map((shortcut, index) => <div key={shortcut.id}
        className={`shortcut-item${drag === index ? ' is-dragging' : ''}${drop === index && drag !== null && drag !== index ? ' is-drop-target' : ''}`} draggable
        onDragStart={() => setDrag(index)} onDragEnd={() => { setDrag(null); setDrop(null); }}
        onDragOver={event => { event.preventDefault(); setDrop(index); }}
        onDragLeave={() => setDrop(value => (value === index ? null : value))}
        onDrop={event => { event.preventDefault(); setDrop(null); if (drag !== null) onMove(drag, index); setDrag(null); }}>
        <a className="shortcut-link" href={shortcut.url} target="_blank" rel="noreferrer" title={shortcut.title}
          onKeyDown={event => {
            if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
            event.preventDefault();
            const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
            if (next >= 0 && next < shortcuts.length) onMove(index, next);
          }}>
          <span className="shortcut-icon"><ShortcutIcon url={shortcut.url} title={shortcut.title}/></span>
          <span>{shortcut.title}</span>
        </a>
        {canEdit && <button className="shortcut-edit" aria-label={`编辑捷径 ${shortcut.title}`} onClick={() => onEdit(shortcut.id)}><Pencil size={12}/></button>}
      </div>)}
      <button className="add-shortcut" aria-label="添加捷径" disabled={shortcuts.length >= 100}
        title={shortcuts.length >= 100 ? '捷径已满（最多 100 个）' : undefined} onClick={onAdd}>
        <span className="shortcut-icon"><Plus size={24} strokeWidth={1.5}/></span><span>添加捷径</span>
      </button>
    </div>
    {overflow && <button className="shortcut-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? '收起捷径' : `展开全部（共 ${shortcuts.length} 个网站）`}
    </button>}
  </>;
}




