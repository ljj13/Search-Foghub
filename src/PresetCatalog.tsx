import { useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { FolderIcon } from './FolderIcon';
import { ShortcutIcon } from './ShortcutIcon';
import { buildPresetImport, matchingShortcuts, presetCategories } from './shared/presets';
import type { Preferences } from './shared/preferences';

export function PresetCatalog({data,edit,onClose}:{data:Preferences;edit:(fn:(d:Preferences)=>Preferences)=>void;onClose:()=>void}){
  const [category,setCategory]=useState('email');
  const [selected,setSelected]=useState<string[]>(presetCategories[0].sites.map(s=>s.id));
  const [message,setMessage]=useState('');
  const current=presetCategories.find(c=>c.id===category)!;
  const preview=useMemo(()=>{try{return {result:buildPresetImport(data,selected),error:''};}catch(e){return {result:null,error:(e as Error).message};}},[data,selected]);
  const countIn=(ids:string[])=>ids.filter(id=>selected.includes(id)).length;
  const available=current.sites.filter(s=>matchingShortcuts(data,s).every(site=>site.folderId===null)||!matchingShortcuts(data,s).length).map(s=>s.id);
  function toggle(id:string,on:boolean){setMessage('');setSelected(list=>on?[...new Set([...list,id])]:list.filter(x=>x!==id));}
  function add(){
    try{
      let added=0,moved=0;
      edit(d=>{const result=buildPresetImport(d,selected);added=result.added;moved=result.moved;return result.data;});
      setMessage(added||moved?`已添加 ${added} 个网站，已归类 ${moved} 个已有捷径。`:'所选网站已添加，无需重复操作。');
    }catch(e){setMessage((e as Error).message);}
  }
  return <section className="preset-catalog" aria-label="常用网站预设">
    <header><div><h3>添加常用网站</h3><p>选择常用站点，为它们准备一个位置。</p></div><button className="icon-button" type="button" aria-label="关闭网站预设" onClick={onClose}><X size={18}/></button></header>
    <div className="preset-categories">{presetCategories.map(c=>{const picked=countIn(c.sites.map(s=>s.id));return <button key={c.id} type="button" aria-label={`预设分类 ${c.name}`} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}><FolderIcon name={c.name} icon={c.icon} size={23}/><span>{c.name}<small>{picked?`已选 ${picked} 个`:`${c.sites.length} 个网站`}</small></span></button>;})}</div>
    <div className="preset-sites">{current.sites.map(s=>{
      const matches=matchingShortcuts(data,s),done=matches.length>0&&matches.every(site=>site.folderId!==null);
      return <label className={`preset-site${done?' is-added':''}`} key={s.id}>
        <input type="checkbox" aria-label={`选择 ${s.title}`} checked={!done&&selected.includes(s.id)} disabled={done} onChange={e=>toggle(s.id,e.target.checked)}/>
        <span className="mini-icon"><ShortcutIcon title={s.title} url={s.url}/></span><span className="preset-site-info"><strong>{s.title}</strong><small>{new URL(s.url).hostname}</small></span>
        {done?<span className="preset-badge"><Check size={13}/>已添加</span>:matches.length?<span className="preset-badge">待归类</span>:null}
      </label>;
    })}</div>
    <div className="preset-actions"><button type="button" className="text-button" onClick={()=>setSelected(list=>[...new Set([...list,...available])])}>全选本类</button><button type="button" className="text-button" onClick={()=>{setMessage('');setSelected([]);}} disabled={!selected.length}>清空所选</button><span className="subtle">共选 {selected.length} 个网站</span></div>
    <p className="hint">已分组网站保持原归属；未分类的同站捷径保留原网址并归入对应分类。</p>
    {preview.error&&<p className="error" role="alert">{preview.error}</p>}
    {message&&<p className="preset-result" role="status">{message}</p>}
    <footer><span>{preview.result?`新增 ${preview.result.added} · 归类 ${preview.result.moved} · 新文件夹 ${preview.result.created}`:'请减少勾选后再添加'}</span><button type="button" className="primary" disabled={Boolean(preview.error)||!selected.length} onClick={add}><Plus size={16}/>添加所选</button></footer>
  </section>;
}
