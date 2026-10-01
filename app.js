import {editEpisode,editRecord,deleteRecord,isClosingRecord} from './records.js';

const DB_NAME = 'symptom-journal-db';
const DB_VERSION = 1;
const STORE = 'episodes';

const BODY_PRESETS = ['お腹','頭','顔','目','鼻','口','耳','喉','首','肩','腰','ひじ','手','股関節','ひざ','足','皮膚','その他'];
const SYMPTOM_PRESETS = ['下痢','腹痛','吐き気','痛み','関節痛','かゆみ','腫れ','発疹','できもの','しびれ','違和感','その他'];
const SEVERITIES = ['軽い','普通','強い'];
const SIDES = ['なし','右','左','両方'];

let state = { route:'home', episodes:[], historyFilter:{symptom:'', body:'', from:'', to:''} };
const app = document.querySelector('#app');

function pad(n){return String(n).padStart(2,'0')}
function localDateString(d=new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function displayDate(s){
  if(!s) return '';
  const [y,m,d]=s.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}
function daysInclusive(start,end=localDateString()){
  const a=new Date(start+'T00:00:00'), b=new Date(end+'T00:00:00');
  return Math.max(1, Math.floor((b-a)/86400000)+1);
}
function uid(){return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function labelBody(ep){return `${ep.side && ep.side!=='なし' ? ep.side : ''}${ep.body}`}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function dbAll(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}
async function dbPut(ep){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(ep);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error('保存が中断されました'));
  });
}
async function dbDelete(id){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error('削除が中断されました'));
  });
}
async function dbClear(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
async function reload(){ state.episodes=await dbAll(); render(); }

function latestDaily(ep){
  return [...(ep.daily||[])].sort((a,b)=>b.date.localeCompare(a.date))[0] || null;
}
function hasToday(ep){return (ep.daily||[]).some(x=>x.date===localDateString())}
function activeEpisodes(){return state.episodes.filter(e=>e.status==='active').sort((a,b)=>a.startDate.localeCompare(b.startDate))}
function todaySeverity(ep){return latestDaily(ep)?.severity || ep.initialSeverity || '普通'}

async function addDaily(ep, change, severity=null, extra={}){
  const today=localDateString();
  if((ep.daily||[]).some(x=>x.date===today)) return false;
  const sev=severity || todaySeverity(ep);
  ep.daily = ep.daily || [];
  ep.daily.push({id:uid(),date:today,change,severity:sev,createdAt:new Date().toISOString(),...extra});
  ep.updatedAt=new Date().toISOString();
  await dbPut(ep);
  return true;
}
async function markSame(ep){
  const last=latestDaily(ep);
  const extra={};
  if(ep.symptom==='下痢' && last){ if(last.diarrheaCount!=null) extra.diarrheaCount=last.diarrheaCount; if(last.abdominalPain!=null) extra.abdominalPain=last.abdominalPain; }
  return addDaily(ep,'same',todaySeverity(ep),extra);
}
async function closeEpisode(ep){
  const today=localDateString();
  if(!hasToday(ep)) await addDaily(ep,'recovered',todaySeverity(ep));
  else {
    const t=ep.daily.find(x=>x.date===today);
    t.change='recovered';
  }
  ep.status='closed'; ep.endDate=today; ep.updatedAt=new Date().toISOString();
  await dbPut(ep);
}
async function reopenEpisode(ep){
  ep.status='active'; ep.endDate=null; ep.updatedAt=new Date().toISOString();
  await dbPut(ep);
}

function setRoute(route){
  state.route=route;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===route));
  render();
}
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>setRoute(b.dataset.nav)));
document.querySelector('#todayLabel').textContent = new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());

function render(){
  if(state.route==='home') renderHome();
  if(state.route==='new') renderNew();
  if(state.route==='history') renderHistory();
  if(state.route==='data') renderData();
}

function renderHome(){
  const eps=activeEpisodes();
  app.innerHTML = `
    ${eps.length>1 ? `<button id="allSame" class="btn btn-primary btn-full">今日も全部昨日と同じ</button><div class="small" style="margin:7px 2px 16px">今日の記録済みは自動で除外します。</div>`:''}
    <div id="activeList"></div>
    ${eps.length===0?`<div class="empty"><b>継続中の症状はありません</b><br><span class="small">新しい症状があれば登録してください。</span></div>`:''}
    <button id="newFab" class="btn btn-primary btn-full fab">＋ 新しい症状</button>`;
  const list=app.querySelector('#activeList');
  eps.forEach(ep=>{
    const last=latestDaily(ep);
    const todayDone=hasToday(ep);
    const div=document.createElement('article');
    div.className='card';
    div.innerHTML=`
      <div class="card-title">
        <div><div class="eyebrow">${esc(labelBody(ep))}</div><div class="symptom-name">${esc(ep.symptom)}</div></div>
        <span class="pill">${esc(todaySeverity(ep))}</span>
      </div>
      <div class="meta">${displayDate(ep.startDate)}から継続中 ・ ${daysInclusive(ep.startDate)}日目</div>
      <div class="meta">直近：${last ? changeLabel(last.change)+' / '+esc(last.severity) : '開始記録のみ'} ${todayDone?'<span class="badge-today">今日記録済み</span>':''}</div>
      <div class="action-row">
        <button class="btn btn-soft same" ${todayDone?'disabled':''}>昨日と同じ</button>
        <button class="btn btn-good improve" ${todayDone?'disabled':''}>改善</button>
        <button class="btn btn-warn worsen" ${todayDone?'disabled':''}>悪化</button>
        <button class="btn recovered">治った</button>
      </div>
      <div class="action-row">
        <button class="btn response">対応を記録</button>
        <button class="btn memo">途中メモ</button>
      </div>
      <button class="btn btn-full detail" style="margin-top:8px">詳細を見る</button>`;
    div.querySelector('.same').onclick=async()=>{await markSame(ep);await reload()};
    div.querySelector('.improve').onclick=()=>openChangeModal(ep,'improved');
    div.querySelector('.worsen').onclick=()=>openChangeModal(ep,'worsened');
    div.querySelector('.recovered').onclick=()=>openRecoverModal(ep);
    div.querySelector('.response').onclick=()=>openResponseModal(ep);
    div.querySelector('.memo').onclick=()=>openMemoModal(ep);
    div.querySelector('.detail').onclick=()=>openDetailModal(ep);
    list.appendChild(div);
  });
  app.querySelector('#newFab').onclick=()=>setRoute('new');
  const all=app.querySelector('#allSame');
  if(all) all.onclick=async()=>{
    let count=0;
    for(const ep of activeEpisodes()){
      if(!hasToday(ep) && await markSame(ep)) count++;
    }
    toast(`${count}件を今日の記録として登録しました`);
    await reload();
  };
}

function changeLabel(c){return ({same:'昨日と同じ',improved:'改善',worsened:'悪化',recovered:'治った',start:'開始'}[c]||c)}

function choiceButtons(name, values, selected){
  return `<div class="choice-row" data-choice="${name}">${values.map(v=>`<button type="button" class="choice ${selected===v?'selected':''}" data-value="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
}
function wireChoice(container, name, onChange){
  container.querySelectorAll(`[data-choice="${name}"] .choice`).forEach(btn=>btn.onclick=()=>{
    container.querySelectorAll(`[data-choice="${name}"] .choice`).forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected'); onChange(btn.dataset.value);
  });
}

function renderNew(){
  const today=localDateString();
  app.innerHTML=`
    <section class="card">
      <h2>新しい症状</h2>
      <form id="newForm">
        <div class="form-group"><label>部位</label>${choiceButtons('body',BODY_PRESETS,'お腹')}<input id="bodyCustom" type="text" placeholder="自由入力（例：右目、上唇、左耳など）" style="margin-top:8px"></div>
        <div class="form-group"><label>左右</label>${choiceButtons('side',SIDES,'なし')}</div>
        <div class="form-group"><label>症状</label>${choiceButtons('symptom',SYMPTOM_PRESETS,'下痢')}<input id="symptomCustom" type="text" placeholder="自由入力（プリセット以外）" style="margin-top:8px"></div>
        <div class="form-group"><label>程度</label>${choiceButtons('severity',SEVERITIES,'普通')}</div>
        <div class="form-group"><label>開始日</label>
          <select id="startMode"><option value="today">今日</option><option value="yesterday">昨日</option><option value="date">日付指定</option></select>
          <input id="startDate" type="date" value="${today}" style="margin-top:8px;display:none">
        </div>
        <div id="diarrheaFields">
          <div class="form-group"><label>下痢の補足（任意）</label><div class="grid-2"><input id="diarrheaCount" type="number" min="0" inputmode="numeric" placeholder="回数"><select id="abdominalPain"><option value="">腹痛：未入力</option><option value="yes">腹痛あり</option><option value="no">腹痛なし</option></select></div></div>
        </div>
        <div class="form-group"><label>きっかけ・心当たり（任意）</label><textarea id="trigger" placeholder="例：前日の夜に生ものを食べた、筋トレ中に痛くなった"></textarea><div class="hint">原因と断定せず、思い当たる出来事として保存します。</div></div>
        <button class="btn btn-primary btn-full" type="submit">この症状を登録</button>
      </form>
    </section>`;
  let vals={body:'お腹',side:'なし',symptom:'下痢',severity:'普通'};
  wireChoice(app,'body',v=>vals.body=v);
  wireChoice(app,'side',v=>vals.side=v);
  wireChoice(app,'symptom',v=>{vals.symptom=v;app.querySelector('#diarrheaFields').style.display=v==='下痢'?'block':'none'});
  wireChoice(app,'severity',v=>vals.severity=v);
  app.querySelector('#startMode').onchange=e=>{app.querySelector('#startDate').style.display=e.target.value==='date'?'block':'none'};
  app.querySelector('#newForm').onsubmit=async e=>{
    e.preventDefault();
    let startDate=today;
    const mode=app.querySelector('#startMode').value;
    if(mode==='yesterday'){const d=new Date();d.setDate(d.getDate()-1);startDate=localDateString(d)}
    if(mode==='date') startDate=app.querySelector('#startDate').value||today;
    const bodyCustom=app.querySelector('#bodyCustom').value.trim();
    const symptomCustom=app.querySelector('#symptomCustom').value.trim();
    const ep={
      id:uid(),status:'active',body:bodyCustom||vals.body,side:vals.side,
      symptom:symptomCustom||vals.symptom,initialSeverity:vals.severity,startDate,endDate:null,
      trigger:app.querySelector('#trigger').value.trim(),
      daily:[],responses:[],notes:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    };
    const first={id:uid(),date:startDate,change:'start',severity:vals.severity,createdAt:new Date().toISOString()};
    if(ep.symptom==='下痢'){
      const c=app.querySelector('#diarrheaCount').value;
      const p=app.querySelector('#abdominalPain').value;
      if(c!=='') first.diarrheaCount=Number(c);
      if(p!=='') first.abdominalPain=p;
    }
    ep.daily.push(first);
    await dbPut(ep);
    state.route='home'; document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav==='home'));
    await reload(); toast('症状を登録しました');
  };
}

function renderHistory(){
  const f=state.historyFilter;
  const filtered=state.episodes.filter(ep=>{
    if(f.symptom && !ep.symptom.includes(f.symptom)) return false;
    if(f.body && !labelBody(ep).includes(f.body)) return false;
    const end=ep.endDate||localDateString();
    if(f.from && end < f.from) return false;
    if(f.to && ep.startDate > f.to) return false;
    return true;
  }).sort((a,b)=>b.startDate.localeCompare(a.startDate));
  const uniqueSymptoms=[...new Set(state.episodes.map(e=>e.symptom))].sort();
  app.innerHTML=`
    <section>
      <h2>履歴</h2>
      <div class="toolbar">
        <input id="fSymptom" type="text" placeholder="症状（例：下痢）" value="${esc(f.symptom)}">
        <input id="fBody" type="text" placeholder="部位（例：右ひざ）" value="${esc(f.body)}">
      </div>
      <div class="grid-2" style="margin-bottom:12px"><input id="fFrom" type="date" value="${esc(f.from)}"><input id="fTo" type="date" value="${esc(f.to)}"></div>
      <button id="clearFilter" class="btn btn-full">絞り込みを解除</button>
      <div class="section-title">簡単な集計</div>
      <select id="statsSymptom"><option value="">症状を選択</option>${uniqueSymptoms.map(s=>`<option>${esc(s)}</option>`).join('')}</select>
      <div id="statsBox" style="margin-top:10px"></div>
      <div class="section-title">症状エピソード</div>
      <div id="historyList"></div>
    </section>`;
  const apply=()=>{state.historyFilter={symptom:app.querySelector('#fSymptom').value.trim(),body:app.querySelector('#fBody').value.trim(),from:app.querySelector('#fFrom').value,to:app.querySelector('#fTo').value};renderHistory()};
  ['#fSymptom','#fBody'].forEach(sel=>app.querySelector(sel).addEventListener('change',apply));
  ['#fFrom','#fTo'].forEach(sel=>app.querySelector(sel).addEventListener('change',apply));
  app.querySelector('#clearFilter').onclick=()=>{state.historyFilter={symptom:'',body:'',from:'',to:''};renderHistory()};
  app.querySelector('#statsSymptom').onchange=e=>renderStats(e.target.value);
  const list=app.querySelector('#historyList');
  filtered.forEach(ep=>{
    const div=document.createElement('div');div.className='list-item';
    const duration=daysInclusive(ep.startDate,ep.endDate||localDateString());
    const hadHospital=(ep.responses||[]).some(r=>r.type==='病院受診');
    div.innerHTML=`<button class="linklike"><div class="card-title"><div><b>${esc(labelBody(ep))} ${esc(ep.symptom)}</b><div class="meta">${displayDate(ep.startDate)}〜${ep.endDate?displayDate(ep.endDate):'継続中'} ・ ${duration}日間</div><div class="small">${hadHospital?'病院受診あり':''}${ep.trigger?`${hadHospital?' ／ ':''}きっかけ：${esc(ep.trigger)}`:''}</div></div><span class="pill">${ep.status==='active'?'継続中':'終了'}</span></div></button>`;
    div.querySelector('button').onclick=()=>openDetailModal(ep);
    list.appendChild(div);
  });
  if(!filtered.length) list.innerHTML='<div class="empty">該当する履歴はありません。</div>';
}
function renderStats(symptom){
  const box=app.querySelector('#statsBox'); if(!box)return;
  if(!symptom){box.innerHTML='';return}
  const eps=state.episodes.filter(e=>e.symptom===symptom);
  const year=String(new Date().getFullYear());
  const yearCount=eps.filter(e=>e.startDate.startsWith(year+'-')).length;
  const durations=eps.map(e=>daysInclusive(e.startDate,e.endDate||localDateString()));
  const avg=durations.length?(durations.reduce((a,b)=>a+b,0)/durations.length).toFixed(1):'-';
  const recent=[...eps].sort((a,b)=>b.startDate.localeCompare(a.startDate))[0];
  box.innerHTML=`<div class="stats"><div class="stat"><span class="small">今年の発生</span><b>${yearCount}</b><span class="small">回</span></div><div class="stat"><span class="small">平均継続</span><b>${avg}</b><span class="small">日</span></div><div class="stat"><span class="small">直近</span><b style="font-size:14px">${recent?displayDate(recent.startDate):'-'}</b><span class="small">${recent?.endDate?'〜'+displayDate(recent.endDate):recent?'〜継続中':''}</span></div></div>`;
}

function renderData(){
  app.innerHTML=`
    <section>
      <h2>データ管理</h2>
      <div class="notice">データはこの端末のブラウザ内（IndexedDB）に保存されます。外部送信は行いません。端末変更・ブラウザデータ削除に備え、定期的にJSONバックアップを保存してください。</div>
      <div class="card">
        <h3>バックアップ</h3>
        <button id="exportJson" class="btn btn-primary btn-full">JSONを書き出す</button>
        <label class="btn btn-full" style="text-align:center;margin-top:8px">JSONを読み込む<input id="importJson" type="file" accept=".json,application/json" hidden></label>
        <button id="exportCsv" class="btn btn-full" style="margin-top:8px">CSVを書き出す</button>
      </div>
      <div class="card">
        <h3>データ削除</h3>
        <p class="small">全症状記録をこの端末から削除します。元に戻せません。</p>
        <button id="deleteAll" class="btn btn-danger btn-full">全データを削除</button>
      </div>
    </section>`;
  app.querySelector('#exportJson').onclick=exportJSON;
  app.querySelector('#importJson').onchange=importJSON;
  app.querySelector('#exportCsv').onclick=exportCSV;
  app.querySelector('#deleteAll').onclick=()=>openDeleteAllModal();
}

function download(name,type,text){
  const blob=new Blob([text],{type});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function exportJSON(){
  const payload={app:'symptom-journal',version:1,exportedAt:new Date().toISOString(),episodes:state.episodes};
  download(`symptom-backup-${localDateString()}.json`,'application/json',JSON.stringify(payload,null,2));
}
async function importJSON(e){
  const file=e.target.files?.[0]; if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.episodes)) throw new Error('episodes missing');
    if(!confirm(`${data.episodes.length}件のバックアップを読み込みます。現在のデータは置き換えられます。よろしいですか？`)) return;
    await dbClear();
    for(const ep of data.episodes) await dbPut(ep);
    await reload(); toast('バックアップを復元しました');
  }catch(err){alert('このJSONは読み込めませんでした。バックアップ形式を確認してください。')}
  e.target.value='';
}
function csvCell(v=''){const s=String(v??'');return `"${s.replace(/"/g,'""')}"`}
function exportCSV(){
  const rows=[['ID','状態','部位','左右','症状','開始日','終了日','継続日数','初期程度','きっかけ・心当たり','病院受診']];
  state.episodes.forEach(ep=>rows.push([ep.id,ep.status,ep.body,ep.side,ep.symptom,ep.startDate,ep.endDate||'',daysInclusive(ep.startDate,ep.endDate||localDateString()),ep.initialSeverity,ep.trigger||'',(ep.responses||[]).some(r=>r.type==='病院受診')?'あり':'なし']));
  download(`symptom-history-${localDateString()}.csv`,'text/csv;charset=utf-8','\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\n'));
}

function modal(html,onDismiss){
  const node=document.querySelector('#modalTemplate').content.firstElementChild.cloneNode(true);
  node.returnFocus=document.activeElement;
  node.querySelector('.modal-body').innerHTML=html;
  const dismiss=()=>{if(node.dataset.busy)return;closeModal(node);onDismiss?.()};
  node.addEventListener('click',e=>{if(e.target===node)dismiss()});
  const dialog=node.querySelector('.modal');
  node.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();dismiss();return;}
    if(e.key!=='Tab') return;
    const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href]')].filter(el=>!el.disabled && el.getClientRects().length);
    const first=controls[0],last=controls[controls.length-1];
    if(!first){e.preventDefault();dialog.focus();}
    else if(e.shiftKey && (document.activeElement===first || document.activeElement===dialog)){e.preventDefault();last.focus();}
    else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
  });
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.tabIndex=-1;
  dialog.setAttribute('aria-label',node.querySelector('h2')?.textContent || '症状記録');
  document.body.appendChild(node);dialog.focus();return node;
}
function closeModal(m){m?.remove();if(m?.returnFocus?.isConnected)m.returnFocus.focus()}
function openChangeModal(ep,change){
  const m=modal(`<h2>${change==='improved'?'改善':'悪化'}を記録</h2><p class="small">現在の程度：${esc(todaySeverity(ep))}</p><div class="form-group"><label>今日の程度</label>${choiceButtons('modalSeverity',SEVERITIES,todaySeverity(ep))}</div>${ep.symptom==='下痢'?`<div class="form-group"><label>下痢の補足（任意）</label><div class="grid-2"><input id="mCount" type="number" min="0" placeholder="回数"><select id="mPain"><option value="">腹痛：未入力</option><option value="yes">腹痛あり</option><option value="no">腹痛なし</option></select></div></div>`:''}<div class="modal-actions"><button class="btn cancel">キャンセル</button><button class="btn btn-primary save">記録</button></div>`);
  let severity=todaySeverity(ep);wireChoice(m,'modalSeverity',v=>severity=v);
  m.querySelector('.cancel').onclick=()=>closeModal(m);
  m.querySelector('.save').onclick=async()=>{
    const extra={};
    if(ep.symptom==='下痢'){const c=m.querySelector('#mCount').value,p=m.querySelector('#mPain').value;if(c!=='')extra.diarrheaCount=Number(c);if(p)extra.abdominalPain=p;}
    await addDaily(ep,change,severity,extra);closeModal(m);await reload();
  };
}
function openRecoverModal(ep){
  const m=modal(`<h2>「治った」にしますか？</h2><p>${displayDate(localDateString())}を終了日にして、この症状を履歴へ移します。</p><div class="modal-actions"><button class="btn cancel">キャンセル</button><button class="btn btn-primary save">治った</button></div>`);
  m.querySelector('.cancel').onclick=()=>closeModal(m);m.querySelector('.save').onclick=async()=>{await closeEpisode(ep);closeModal(m);await reload()};
}
function openMemoModal(ep){
  const m=modal(`<h2>途中メモ</h2><div class="form-group"><label>日付</label><input id="memoDate" type="date" value="${localDateString()}"></div><div class="form-group"><label>メモ</label><textarea id="memoText" placeholder="新しく気付いたこと"></textarea></div><div class="form-group"><label>きっかけ・心当たりへ追記（任意）</label><textarea id="triggerAdd" placeholder="後から気付いた心当たり"></textarea></div><div class="modal-actions"><button class="btn cancel">キャンセル</button><button class="btn btn-primary save">保存</button></div>`);
  m.querySelector('.cancel').onclick=()=>closeModal(m);
  m.querySelector('.save').onclick=async()=>{
    const text=m.querySelector('#memoText').value.trim(), trig=m.querySelector('#triggerAdd').value.trim();
    if(text){ep.notes=ep.notes||[];ep.notes.push({id:uid(),date:m.querySelector('#memoDate').value||localDateString(),text,createdAt:new Date().toISOString()})}
    if(trig) ep.trigger = ep.trigger ? `${ep.trigger}\n追記：${trig}` : trig;
    ep.updatedAt=new Date().toISOString();await dbPut(ep);closeModal(m);await reload();
  };
}
function openResponseModal(ep){
  const m=modal(`<h2>対応を記録</h2><div class="form-group"><label>種類</label><select id="rType"><option>市販薬</option><option>処方薬</option><option>病院受診</option><option>その他</option></select></div><div class="form-group"><label>日付</label><input id="rDate" type="date" value="${localDateString()}"></div><div id="medFields"><div class="form-group"><label>薬名（任意）</label><input id="drugName" type="text"></div></div><div id="hospitalFields" style="display:none"><div class="form-group"><label>診療科（任意）</label><input id="dept" type="text"></div><div class="form-group"><label>病院名（任意）</label><input id="hospital" type="text"></div><div class="form-group"><label>医師から言われたこと（任意）</label><textarea id="doctorMemo"></textarea></div></div><div class="form-group"><label>メモ（任意）</label><textarea id="rMemo"></textarea></div><div class="modal-actions"><button class="btn cancel">キャンセル</button><button class="btn btn-primary save">保存</button></div>`);
  const type=m.querySelector('#rType');
  type.onchange=()=>{m.querySelector('#medFields').style.display=['市販薬','処方薬'].includes(type.value)?'block':'none';m.querySelector('#hospitalFields').style.display=type.value==='病院受診'?'block':'none'};
  m.querySelector('.cancel').onclick=()=>closeModal(m);
  m.querySelector('.save').onclick=async()=>{
    ep.responses=ep.responses||[];
    ep.responses.push({id:uid(),type:type.value,date:m.querySelector('#rDate').value||localDateString(),drugName:m.querySelector('#drugName')?.value.trim()||'',department:m.querySelector('#dept')?.value.trim()||'',hospital:m.querySelector('#hospital')?.value.trim()||'',doctorMemo:m.querySelector('#doctorMemo')?.value.trim()||'',memo:m.querySelector('#rMemo').value.trim(),createdAt:new Date().toISOString()});
    ep.updatedAt=new Date().toISOString();await dbPut(ep);closeModal(m);await reload();
  };
}
function selectOptions(values,selected){
  return values.map(value=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(value)}</option>`).join('');
}
function editModal(ep,title,fields){
  const m=modal(`<h2>${title}</h2><form>${fields}<p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn cancel">キャンセル</button><button type="submit" class="btn btn-primary save">変更を保存</button></div></form>`,()=>openDetailModal(ep));
  m.querySelector('.cancel').onclick=()=>{closeModal(m);openDetailModal(ep)};
  return m;
}
async function saveRecordChange(m,ep,makeNext,message){
  if(m.dataset.busy) return;
  m.dataset.busy='true';
  m.querySelectorAll('button').forEach(b=>b.disabled=true);
  m.querySelector('.form-error').textContent='';
  try{
    const next=makeNext();
    if(next) await dbPut(next); else await dbDelete(ep.id);
    state.episodes=await dbAll();
    render();closeModal(m);
    const saved=state.episodes.find(e=>e.id===ep.id);
    if(saved) openDetailModal(saved);
    toast(message);
  }catch(error){
    m.querySelector('.form-error').textContent=error instanceof DOMException ? '保存できませんでした。空き容量などを確認して、もう一度お試しください。' : error.message || '保存できませんでした。もう一度お試しください。';
  }finally{
    delete m.dataset.busy;m.querySelectorAll('button').forEach(b=>b.disabled=false);
  }
}
function openEpisodeEditModal(ep){
  const m=editModal(ep,'症状を編集',`
    <div class="form-group"><label for="editBody">部位</label><input id="editBody" type="text" list="bodyOptions" value="${esc(ep.body)}" required><datalist id="bodyOptions">${selectOptions(BODY_PRESETS,ep.body)}</datalist></div>
    <div class="form-group"><label for="editSide">左右</label><select id="editSide">${selectOptions(SIDES,ep.side || 'なし')}</select></div>
    <div class="form-group"><label for="editSymptom">症状</label><input id="editSymptom" type="text" list="symptomOptions" value="${esc(ep.symptom)}" required><datalist id="symptomOptions">${selectOptions(SYMPTOM_PRESETS,ep.symptom)}</datalist></div>
    <div class="form-group"><label for="editSeverity">開始時の程度</label><select id="editSeverity">${selectOptions(SEVERITIES,ep.initialSeverity)}</select></div>
    <div class="form-group"><label for="editStart">開始日</label><input id="editStart" type="date" value="${esc(ep.startDate)}" required></div>
    ${ep.status==='closed'?`<div class="form-group"><label for="editEnd">終了日</label><input id="editEnd" type="date" value="${esc(ep.endDate)}" required></div>`:''}
    <div class="form-group"><label for="editTrigger">きっかけ・心当たり（任意）</label><textarea id="editTrigger">${esc(ep.trigger || '')}</textarea></div>
    <p class="hint">開始・治癒の記録がある場合は、その日付も合わせて更新します。日々の変化は1日1件です。</p>`);
  m.querySelector('form').onsubmit=e=>{
    e.preventDefault();
    saveRecordChange(m,ep,()=>editEpisode(ep,{
      body:m.querySelector('#editBody').value.trim(),side:m.querySelector('#editSide').value,
      symptom:m.querySelector('#editSymptom').value.trim(),initialSeverity:m.querySelector('#editSeverity').value,
      startDate:m.querySelector('#editStart').value,endDate:m.querySelector('#editEnd')?.value || ep.endDate,
      trigger:m.querySelector('#editTrigger').value.trim()
    }),'症状を更新しました');
  };
}
function openDailyEditModal(ep,index){
  const record=ep.daily[index];
  const isStart=record.change==='start';
  const changes=['same','improved','worsened','recovered'];
  const hasExtras=ep.symptom==='下痢' || record.diarrheaCount!=null || record.abdominalPain;
  const m=editModal(ep,'日々の変化を編集',`
    <div class="form-group"><label for="editDate">日付</label><input id="editDate" type="date" value="${esc(record.date)}" required></div>
    ${isStart?'<p class="notice">開始の記録です。症状の開始日・開始時の程度も合わせて更新します。</p>':`<div class="form-group"><label for="editChange">変化</label><select id="editChange">${changes.map(c=>`<option value="${c}" ${record.change===c?'selected':''}>${changeLabel(c)}</option>`).join('')}</select><div class="hint">新たに「治った」を選ぶと、この日を終了日にします。終了日の「治った」を別の変化にすると、継続中に戻ります。</div></div>`}
    <div class="form-group"><label for="editSeverity">程度</label><select id="editSeverity">${selectOptions(SEVERITIES,record.severity)}</select></div>
    ${hasExtras?`<div class="form-group"><label for="editCount">下痢の回数（任意）</label><input id="editCount" type="number" min="0" step="1" inputmode="numeric" value="${esc(record.diarrheaCount ?? '')}"></div><div class="form-group"><label for="editPain">腹痛（任意）</label><select id="editPain"><option value="">未入力</option><option value="yes">あり</option><option value="no">なし</option></select></div>`:''}`);
  if(hasExtras) m.querySelector('#editPain').value=record.abdominalPain || '';
  m.querySelector('form').onsubmit=e=>{
    e.preventDefault();
    saveRecordChange(m,ep,()=>{
      const fields={date:m.querySelector('#editDate').value,change:isStart?'start':m.querySelector('#editChange').value,severity:m.querySelector('#editSeverity').value};
      if(hasExtras){
        const count=m.querySelector('#editCount').value;
        fields.diarrheaCount=count===''?null:Number(count);fields.abdominalPain=m.querySelector('#editPain').value;
      }
      return editRecord(ep,'daily',index,fields);
    },'日々の変化を更新しました');
  };
}
function openResponseEditModal(ep,index){
  const record=ep.responses[index];
  const types=[...new Set(['市販薬','処方薬','病院受診','その他',record.type])];
  const m=editModal(ep,'対応を編集',`
    <div class="form-group"><label for="editType">種類</label><select id="editType">${selectOptions(types,record.type)}</select></div>
    <div class="form-group"><label for="editDate">日付</label><input id="editDate" type="date" value="${esc(record.date)}" required></div>
    <div class="form-group"><label for="editDrug">薬名（任意）</label><input id="editDrug" type="text" value="${esc(record.drugName || '')}"></div>
    <div class="form-group"><label for="editDepartment">診療科（任意）</label><input id="editDepartment" type="text" value="${esc(record.department || '')}"></div>
    <div class="form-group"><label for="editHospital">病院名（任意）</label><input id="editHospital" type="text" value="${esc(record.hospital || '')}"></div>
    <div class="form-group"><label for="editDoctor">医師から言われたこと（任意）</label><textarea id="editDoctor">${esc(record.doctorMemo || '')}</textarea></div>
    <div class="form-group"><label for="editMemo">メモ（任意）</label><textarea id="editMemo">${esc(record.memo || '')}</textarea></div>`);
  m.querySelector('form').onsubmit=e=>{
    e.preventDefault();
    saveRecordChange(m,ep,()=>editRecord(ep,'responses',index,{
      type:m.querySelector('#editType').value,date:m.querySelector('#editDate').value,
      drugName:m.querySelector('#editDrug').value.trim(),department:m.querySelector('#editDepartment').value.trim(),
      hospital:m.querySelector('#editHospital').value.trim(),doctorMemo:m.querySelector('#editDoctor').value.trim(),memo:m.querySelector('#editMemo').value.trim()
    }),'対応を更新しました');
  };
}
function openNoteEditModal(ep,index){
  const record=ep.notes[index];
  const m=editModal(ep,'途中メモを編集',`
    <div class="form-group"><label for="editDate">日付</label><input id="editDate" type="date" value="${esc(record.date)}" required></div>
    <div class="form-group"><label for="editText">メモ</label><textarea id="editText" required>${esc(record.text)}</textarea></div>`);
  m.querySelector('form').onsubmit=e=>{
    e.preventDefault();
    saveRecordChange(m,ep,()=>editRecord(ep,'notes',index,{date:m.querySelector('#editDate').value,text:m.querySelector('#editText').value.trim()}),'途中メモを更新しました');
  };
}
function openRecordDeleteModal(ep,kind,index){
  const record=kind?ep[kind][index]:null;
  const title=record?'この記録を削除しますか？':'この症状を削除しますか？';
  const label=record?`${displayDate(record.date)} ${kind==='daily'?changeLabel(record.change):kind==='responses'?record.type:'途中メモ'}`:`${labelBody(ep)} ${ep.symptom}`;
  const preview=kind==='notes'?record.text:kind==='responses'?[record.drugName,record.department,record.hospital,record.doctorMemo,record.memo].filter(Boolean).join(' ／ '):'';
  const detail=record?'選択した1件の記録を削除します。':'この症状と、関連する日々の変化・薬や病院の対応・途中メモをすべて削除します。';
  const consequence=kind==='daily' && isClosingRecord(ep,record)?'終了日の「治った」を削除するため、この症状は継続中に戻ります。':kind==='daily' && record.change==='start'?'症状本体の開始日・開始時の程度は残ります。':'';
  const m=modal(`<h2>${title}</h2><p><b>${esc(label)}</b></p>${preview?`<p class="notice">${esc(preview)}</p>`:''}<p>${detail}元に戻せません。</p>${consequence?`<p class="notice">${consequence}</p>`:''}<p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn cancel">キャンセル</button><button class="btn btn-danger delete">削除する</button></div>`,()=>openDetailModal(ep));
  m.querySelector('.cancel').onclick=()=>{closeModal(m);openDetailModal(ep)};
  m.querySelector('.delete').onclick=()=>saveRecordChange(m,ep,()=>record?deleteRecord(ep,kind,index):null,record?'記録を削除しました':'症状を削除しました');
}
function openDetailModal(ep){
  const events=[];
  (ep.daily||[]).forEach((d,index)=>events.push({kind:'daily',index,date:d.date,sort:1,html:`<strong>${esc(changeLabel(d.change))} ・ ${esc(d.severity)}</strong>${d.diarrheaCount!=null?`下痢 ${esc(d.diarrheaCount)}回`:''}${d.abdominalPain?`${d.diarrheaCount!=null?' ／ ':''}腹痛${d.abdominalPain==='yes'?'あり':'なし'}`:''}`}));
  (ep.responses||[]).forEach((r,index)=>events.push({kind:'responses',index,date:r.date,sort:2,html:`<strong>${esc(r.type)}</strong>${r.drugName?`薬名：${esc(r.drugName)}<br>`:''}${r.department?`診療科：${esc(r.department)}<br>`:''}${r.hospital?`病院：${esc(r.hospital)}<br>`:''}${r.doctorMemo?`医師メモ：${esc(r.doctorMemo)}<br>`:''}${r.memo?esc(r.memo):''}`}));
  (ep.notes||[]).forEach((n,index)=>events.push({kind:'notes',index,date:n.date,sort:3,html:`<strong>途中メモ</strong>${esc(n.text)}`}));
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.sort-b.sort);
  const m=modal(`<h2>${esc(labelBody(ep))} ${esc(ep.symptom)}</h2><div class="meta">${displayDate(ep.startDate)}〜${ep.endDate?displayDate(ep.endDate):'継続中'} ・ ${daysInclusive(ep.startDate,ep.endDate||localDateString())}日間</div><button class="btn btn-full edit-episode">症状を編集</button>${ep.trigger?`<div class="notice"><b>きっかけ・心当たり</b><br>${esc(ep.trigger).replace(/\n/g,'<br>')}</div>`:''}<div class="timeline">${events.map(e=>`<div class="timeline-item" data-kind="${e.kind}" data-index="${e.index}"><span class="small">${displayDate(e.date)}</span>${e.html}<div class="record-actions"><button class="btn edit-record" aria-label="${esc(displayDate(e.date))}の${e.kind==='daily'?'日々の変化':e.kind==='responses'?'対応':'途中メモ'}を編集">編集</button><button class="btn btn-danger delete-record" aria-label="${esc(displayDate(e.date))}の${e.kind==='daily'?'日々の変化':e.kind==='responses'?'対応':'途中メモ'}を削除">削除</button></div></div>`).join('') || '<p class="small">途中記録はありません。</p>'}</div><button class="btn btn-danger btn-full delete-episode">この症状をすべて削除</button><div class="modal-actions">${ep.status==='closed'?'<button class="btn reopen">再開する</button>':''}<button class="btn btn-primary close">閉じる</button></div>`);
  m.querySelector('.edit-episode').onclick=()=>{closeModal(m);openEpisodeEditModal(ep)};
  m.querySelector('.delete-episode').onclick=()=>{closeModal(m);openRecordDeleteModal(ep)};
  m.querySelectorAll('.timeline-item').forEach(item=>{
    const {kind,index}=item.dataset;
    item.querySelector('.edit-record').onclick=()=>{closeModal(m);({daily:openDailyEditModal,responses:openResponseEditModal,notes:openNoteEditModal})[kind](ep,Number(index))};
    item.querySelector('.delete-record').onclick=()=>{closeModal(m);openRecordDeleteModal(ep,kind,Number(index))};
  });
  m.querySelector('.close').onclick=()=>closeModal(m);
  const rb=m.querySelector('.reopen');if(rb)rb.onclick=async()=>{await reopenEpisode(ep);closeModal(m);await reload()};
}
function openDeleteAllModal(){
  const m=modal(`<h2>全データを削除しますか？</h2><p>すべての症状エピソードがこの端末から削除されます。先にJSONバックアップを保存することを推奨します。</p><div class="modal-actions"><button class="btn cancel">キャンセル</button><button class="btn btn-danger delete">削除する</button></div>`);
  m.querySelector('.cancel').onclick=()=>closeModal(m);m.querySelector('.delete').onclick=async()=>{await dbClear();closeModal(m);await reload();toast('全データを削除しました')};
}
function toast(msg){
  const d=document.createElement('div');d.textContent=msg;d.style.cssText='position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1f2937;color:white;padding:10px 14px;border-radius:10px;z-index:100;font-weight:700;white-space:nowrap';document.body.appendChild(d);setTimeout(()=>d.remove(),2200);
}

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
reload();
