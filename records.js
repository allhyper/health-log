// Editing keeps the version 1 backup/IndexedDB format and never mutates the displayed record.
function copyEpisode(ep){
  return {...structuredClone(ep),updatedAt:new Date().toISOString()};
}

function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10)===value;
}

function validateTimeline(ep){
  if(!validDate(ep.startDate)) throw new Error('開始日を入力してください。');
  if(ep.status==='closed' && (!validDate(ep.endDate) || ep.endDate<ep.startDate)){
    throw new Error('終了日は開始日以降にしてください。');
  }
  const dates=new Set();
  for(const daily of ep.daily || []){
    if(!validDate(daily.date)) throw new Error('日付を入力してください。');
    if(daily.date<ep.startDate) throw new Error('日々の変化より後を開始日にはできません。日付を確認してください。');
    if(ep.status==='closed' && daily.date>ep.endDate) throw new Error('終了日より後に日々の変化があります。日付を確認してください。');
    if(dates.has(daily.date)) throw new Error('その日の日々の変化は登録済みです。別の日を選んでください。');
    dates.add(daily.date);
  }
  return ep;
}

export function isClosingRecord(ep,record){
  return ep.status==='closed' && record?.change==='recovered' && record.date===ep.endDate;
}

export function editEpisode(ep,fields){
  const next=copyEpisode(ep);
  Object.assign(next,fields);
  if(!next.body?.trim() || !next.symptom?.trim()) throw new Error('部位と症状を入力してください。');
  const start=(next.daily || []).find(d=>d.change==='start');
  if(start){start.date=next.startDate;start.severity=next.initialSeverity;start.updatedAt=next.updatedAt;}
  const closingIndex=(ep.daily || []).findIndex(d=>isClosingRecord(ep,d));
  if(closingIndex>=0){next.daily[closingIndex].date=next.endDate;next.daily[closingIndex].updatedAt=next.updatedAt;}
  return validateTimeline(next);
}

export function editRecord(ep,kind,index,fields){
  if(!['daily','responses','notes'].includes(kind) || !ep[kind]?.[index]) throw new Error('記録が見つかりません。');
  const next=copyEpisode(ep), original=ep[kind][index];
  const record={...next[kind][index],...fields,updatedAt:next.updatedAt};
  if(!validDate(record.date)) throw new Error('日付を入力してください。');
  next[kind][index]=record;
  if(kind==='notes' && !record.text?.trim()) throw new Error('メモを入力してください。');
  if(kind==='daily'){
    if(original.change==='start'){
      record.change='start';next.startDate=record.date;next.initialSeverity=record.severity;
    }else{
      if(!['same','improved','worsened','recovered'].includes(record.change)) throw new Error('変化を選んでください。');
      if(record.change==='recovered' && (isClosingRecord(ep,original) || original.change!=='recovered')){
        next.status='closed';next.endDate=record.date;
      }else if(isClosingRecord(ep,original)){
        next.status='active';next.endDate=null;
      }
    }
    if(record.diarrheaCount==null || record.diarrheaCount==='') delete record.diarrheaCount;
    else if(!Number.isInteger(record.diarrheaCount) || record.diarrheaCount<0) throw new Error('下痢の回数は0以上の整数にしてください。');
    if(!record.abdominalPain) delete record.abdominalPain;
    return validateTimeline(next);
  }
  return next;
}

export function deleteRecord(ep,kind,index){
  if(!['daily','responses','notes'].includes(kind) || !ep[kind]?.[index]) throw new Error('記録が見つかりません。');
  const next=copyEpisode(ep);
  next[kind].splice(index,1);
  if(kind==='daily' && isClosingRecord(ep,ep.daily[index])){next.status='active';next.endDate=null;}
  return next;
}
