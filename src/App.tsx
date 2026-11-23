import { useCallback,useEffect,useRef,useState } from 'react';
import { Settings2,CloudFog as Fog,UserRound,RefreshCw } from 'lucide-react';
import { usePreferences } from './usePreferences';
import { Settings } from './Settings';
import { AuthDialog } from './AuthDialog';
import { wallpapers,moveShortcut } from './shared/preferences';
import { FolderShortcuts } from './FolderShortcuts';
import { SearchForm } from './SearchForm';
import { ShortcutGrid } from './ShortcutGrid';

function greeting(hour:number) {return hour<6?'夜色安静，发现继续。':hour<12?'早上好，新的发现从这里开始。':hour<18?'下午好，留一点时间给好奇。':'晚上好，让思绪慢下来。';}
// The clock ticks every second, so it owns its state: the rest of the page never re-renders for it.
function Clock() {
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);
  const time=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const date=now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
  return <section className="clock" aria-label="当地时间"><p className="greeting">{greeting(now.getHours())}</p><time dateTime={now.toISOString()}>{time}</time><p className="date">{date}</p></section>;
}
export default function App() {
  const model=usePreferences(),{data,user,edit,ready}=model;
  const [panel,setPanel]=useState(false),[shortcut,setShortcut]=useState<string>(),[auth,setAuth]=useState(false),[change,setChange]=useState(false),[wallpaperError,setWallpaperError]=useState(false),[imageAttempt,setImageAttempt]=useState(0);
  const [initialFolder,setInitialFolder]=useState<string|null>(null);
  const [token,setToken]=useState(()=>new URLSearchParams(location.search).get('token')??undefined);
  const consumeToken=useCallback(()=>{setToken(undefined);history.replaceState(null,'','/');},[]);
  const previousUser=useRef<string|null>(null);
  useEffect(()=>{if(previousUser.current&&!user){setPanel(false);setShortcut(undefined);setInitialFolder(null);if(change){setAuth(false);setChange(false);}}previousUser.current=user?.id??null;},[user,change]);
  useEffect(()=>{if(token)setAuth(true);if(new URLSearchParams(location.search).has('error'))model.notify('重置链接已失效，请重新申请');},[]);
  // Reset the failure notice only when the chosen image actually changes, not on every preference reload.
  const wallpaperKey=data.wallpaper.kind==='webdav'?`webdav:${data.wallpaper.file}`:`builtin:${data.wallpaper.id}`;
  useEffect(()=>{setWallpaperError(false);},[wallpaperKey,imageAttempt]);
  const [loadAttempt,setLoadAttempt]=useState(0);
  // A cold Durable Object or a dropped request usually recovers on its own; retry twice before asking.
  useEffect(()=>{
    if(model.status!=='连接失败') {if(loadAttempt)setLoadAttempt(0);return;}
    if(loadAttempt>=2)return;
    const t=setTimeout(()=>{setLoadAttempt(v=>v+1);model.reload();},1200*(loadAttempt+1));
    return()=>clearTimeout(t);
  },[model.status,model.reload,loadAttempt]);
  const closePanel=useCallback(()=>{setPanel(false);setShortcut(undefined);setInitialFolder(null);},[]);
  const closeAuth=useCallback(()=>{setAuth(false);setChange(false);if(token)consumeToken();},[token,consumeToken]);
  function openAuth(changePassword=false) {setPanel(false);setChange(changePassword);setAuth(true);}
  function openShortcut(id?:string,folderId?:string|null) {setInitialFolder(folderId??null);setShortcut(id);setPanel(true);}
  const wallpaper=data.wallpaper;
  const selected=wallpaper.kind==='builtin'?wallpapers.find(w=>w.id===wallpaper.id)??wallpapers[0]:null;
  const src=!wallpaperError&&data.wallpaper.kind==='webdav'&&user?`/api/webdav/image?file=${encodeURIComponent(data.wallpaper.file)}&attempt=${imageAttempt}`:`/wallpapers/${selected?.id??'alpine-mist'}.webp`;
  return <div className="home">
    <img key={src} className="backdrop" src={src} alt="" draggable={false} decoding="async" fetchPriority="high" onError={()=>{if(!wallpaperError&&data.wallpaper.kind==='webdav')setWallpaperError(true);}}/>
    <div className="backdrop-shade" style={{'--dim':data.dim} as React.CSSProperties}/>
    <header className="home-header">
      <a className="brand" href="https://foghub.org/" aria-label="FogHub 首页"><Fog size={27} strokeWidth={1.5}/><span>FogHub</span></a>
      <div className="header-actions">
        <button className="login-button" aria-busy={!ready} onClick={()=>{if(!ready)return;user?setPanel(true):openAuth();}}><UserRound size={15}/><span>{ready?(user?'我的空间':'登录'):'正在连接'}</span></button>
        <button className="icon-button glass" aria-label="打开设置" title="设置" onClick={()=>setPanel(true)}><Settings2 size={19}/></button>
      </div>
    </header>
    <main className="home-content">
      <Clock/>
      <SearchForm engine={data.engine} newTab={data.newTab} onEngineChange={engine=>edit(d=>({...d,engine}))}/>
      {/* Until the first answer arrives the area stays a skeleton: showing the default grid first made the page look like it had lost its folders. */}
      <section className="shortcuts" aria-label="常用网站" aria-busy={!ready}>{ready?<>
        {data.shortcutLayout==='folders'
          ? <FolderShortcuts key={user?.id??'visitor'} data={data} edit={edit} enabled={!panel&&!auth} onAdd={(id,folderOnly)=>openShortcut(folderOnly?'new-folder':'new',id)}/>
          : <ShortcutGrid shortcuts={data.shortcuts} canEdit={Boolean(user)} onEdit={id=>openShortcut(id)} onAdd={()=>openShortcut('new')} onMove={(from,to)=>edit(d=>({...d,shortcuts:moveShortcut(d.shortcuts,from,to)}))}/>}
        <button className="manage-shortcuts" onClick={()=>openShortcut('manage')}>整理捷径</button>
      </>:<div className="shortcut-grid shortcut-skeleton" aria-label="正在加载常用网站">{Array.from({length:6},(_,i)=><div key={i} className="shortcut-item"><span className="shortcut-icon"/><span className="skeleton-label"/></div>)}</div>}</section>
      {wallpaperError&&<div className="wallpaper-notice" role="status">网盘壁纸暂不可用，已显示默认风景。<button onClick={()=>setImageAttempt(v=>v+1)}><RefreshCw size={13}/>重试</button></div>}
      {model.status==='连接失败'&&<div className="wallpaper-notice" role="status">{user?'暂时无法加载云端设置，正在显示默认内容。':'暂时无法连接账号服务，正在重试。'}<button onClick={()=>model.reload()}><RefreshCw size={13}/>重试</button></div>}
      {model.conflict&&<button className="wallpaper-notice" onClick={()=>setPanel(true)}>设置同步冲突 · 本地编辑已保留，打开设置处理</button>}
    </main>
    <footer className="home-footer">
      <span className="home-motto">FOGHUB — EXPLORE BEYOND THE ORDINARY.</span>
      <a className="photo-credit" href={selected?.source??wallpapers[0].source} target="_blank" rel="noreferrer">{data.wallpaper.kind==='webdav'&&!wallpaperError&&user?'你的私人壁纸':`摄影 / ${selected?.author??wallpapers[0].author}`}<span aria-hidden="true">↗</span></a>
    </footer>
    {panel&&<Settings model={model} onClose={closePanel} onAuth={()=>openAuth()} onChangePassword={()=>openAuth(true)} initialShortcut={shortcut} initialFolder={initialFolder}/>}
    {auth&&<AuthDialog onClose={closeAuth} onLogin={model.login} token={token} onTokenUsed={consumeToken} change={change}/>}
  </div>;
}

