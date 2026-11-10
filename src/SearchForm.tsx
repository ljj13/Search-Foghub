import { useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { EnginePicker } from './EnginePicker';
import { searchUrl, type Preferences } from './shared/preferences';

/**
 * The query lives here so a keystroke only re-renders the form; the shortcut
 * grid below holds images and never needs to redraw while someone types.
 */
export function SearchForm({ engine, newTab, onEngineChange }: {
  engine: Preferences['engine']; newTab: boolean; onEngineChange: (engine: Preferences['engine']) => void;
}) {
  const [query, setQuery] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    const url = searchUrl(engine, text);
    if (newTab) window.open(url, '_blank', 'noopener,noreferrer');
    else location.assign(url);
  }
  return <form className="search-form" role="search" onSubmit={submit}>
    <div className="engine-wrap"><EnginePicker label="搜索引擎" variant="search" value={engine} onChange={onEngineChange}/></div>
    <span className="search-divider" aria-hidden="true"/>
    <Search className="search-symbol" size={19} aria-hidden="true"/>
    <input type="search" aria-label="搜索内容" placeholder="想发现些什么？" autoComplete="off" spellCheck={false}
      enterKeyHint="search" value={query} onChange={event => setQuery(event.target.value)}/>
    <button type="submit" className="search-submit" aria-label="开始搜索"><ArrowRight size={21} aria-hidden="true"/></button>
  </form>;
}
