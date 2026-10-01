import test from 'node:test';
import assert from 'node:assert/strict';
import {editEpisode,editRecord,deleteRecord} from '../records.js';

function fixture(){
  return {
    id:'episode-1',status:'closed',body:'お腹',side:'なし',symptom:'下痢',
    initialSeverity:'普通',startDate:'2026-09-01',endDate:'2026-09-05',trigger:'きっかけ',
    createdAt:'created',updatedAt:'original',extra:{preserve:true},
    daily:[
      {id:'start',date:'2026-09-01',change:'start',severity:'普通',diarrheaCount:2,abdominalPain:'yes'},
      {id:'middle',date:'2026-09-03',change:'same',severity:'強い',createdAt:'created'},
      {id:'end',date:'2026-09-05',change:'recovered',severity:'軽い'}
    ],
    responses:[{id:'response',type:'市販薬',date:'2026-09-02',drugName:'薬A',memo:'メモ',createdAt:'created'}],
    notes:[{id:'note',date:'2026-09-03',text:'メモ',createdAt:'created'}]
  };
}

test('episode edit synchronizes boundaries, preserves nested data/IDs, and does not mutate its input',()=>{
  const ep=fixture(),before=structuredClone(ep);
  const next=editEpisode(ep,{body:'目',side:'右',symptom:'かゆみ',trigger:'変更',initialSeverity:'軽い',startDate:'2026-08-31',endDate:'2026-09-06'});
  assert.deepEqual(ep,before);
  assert.equal(next.daily[0].date,next.startDate);
  assert.equal(next.daily[0].severity,next.initialSeverity);
  assert.equal(next.daily[2].date,next.endDate);
  assert.equal(next.daily[0].diarrheaCount,2);
  assert.deepEqual(next.responses,ep.responses);
  assert.deepEqual(next.notes,ep.notes);
  assert.deepEqual(next.extra,ep.extra);
  assert.equal(next.id,ep.id);
  assert.equal(next.createdAt,ep.createdAt);
  assert.notEqual(next.updatedAt,ep.updatedAt);
});

test('invalid or conflicting episode dates are rejected without changing data',()=>{
  const ep=fixture(),before=structuredClone(ep);
  for(const fields of [{startDate:''},{startDate:'2026-02-30'},{startDate:'2026-09-04'},{startDate:'2026-09-03'},{endDate:'2026-08-31'},{endDate:'2026-09-02'}]){
    assert.throws(()=>editEpisode(ep,fields));
    assert.deepEqual(ep,before);
  }
  assert.throws(()=>editEpisode(ep,{body:' '}));
});

test('daily editing preserves identity and can clear optional details or retain zero',()=>{
  const ep=fixture();
  const next=editRecord(ep,'daily',0,{date:'2026-08-31',severity:'軽い',diarrheaCount:0,abdominalPain:'no'});
  assert.equal(next.startDate,'2026-08-31');
  assert.equal(next.initialSeverity,'軽い');
  assert.equal(next.daily[0].diarrheaCount,0);
  const cleared=editRecord(next,'daily',0,{diarrheaCount:null,abdominalPain:''});
  assert.equal('diarrheaCount' in cleared.daily[0],false);
  assert.equal('abdominalPain' in cleared.daily[0],false);
  assert.equal(cleared.daily[0].id,'start');
  assert.equal(ep.daily[0].diarrheaCount,2);
});

test('daily dates cannot duplicate another day or escape episode bounds',()=>{
  const ep=fixture();
  for(const date of ['','2026-09-01','2026-09-05','2026-08-31','2026-09-06']) assert.throws(()=>editRecord(ep,'daily',1,{date}));
  assert.throws(()=>editRecord(ep,'daily',0,{diarrheaCount:-1}));
  assert.throws(()=>editRecord(ep,'daily',0,{diarrheaCount:1.5}));
  assert.throws(()=>editRecord(ep,'daily',1,{change:'recovered'}));
});

test('editing/deleting the closing recovery reopens, while moving it updates the end date',()=>{
  const ep=fixture();
  const moved=editRecord(ep,'daily',2,{date:'2026-09-06'});
  assert.equal(moved.endDate,'2026-09-06');
  for(const next of [editRecord(ep,'daily',2,{change:'improved'}),deleteRecord(ep,'daily',2)]){
    assert.equal(next.status,'active');assert.equal(next.endDate,null);
  }
  assert.equal(ep.status,'closed');
});

test('a newly chosen recovery closes an active episode; historical recovery remains historical after reopening',()=>{
  const ep=fixture();ep.status='active';ep.endDate=null;
  assert.equal(editRecord(ep,'daily',2,{severity:'普通'}).status,'active');
  assert.equal(deleteRecord(ep,'daily',2).status,'active');
  ep.daily.pop();
  const closed=editRecord(ep,'daily',1,{change:'recovered'});
  assert.equal(closed.status,'closed');assert.equal(closed.endDate,'2026-09-03');
});

test('individual responses and notes edit/delete without touching other records',()=>{
  const ep=fixture();
  ep.responses.push({...ep.responses[0],id:'another'});
  ep.notes.push({...ep.notes[0],id:'another'});
  const response=editRecord(ep,'responses',0,{type:'病院受診',date:'2026-09-04',hospital:'病院',department:'内科',doctorMemo:'説明',memo:'修正'});
  assert.equal(response.responses[0].id,'response');assert.equal(response.responses[0].createdAt,'created');
  assert.equal(response.responses[0].hospital,'病院');
  assert.deepEqual(response.responses[1],ep.responses[1]);
  const note=editRecord(ep,'notes',0,{text:'修正',date:'2026-09-04'});
  assert.equal(note.notes[0].text,'修正');assert.equal(note.notes[0].createdAt,'created');
  assert.throws(()=>editRecord(ep,'notes',0,{text:' '}));
  for(const kind of ['responses','notes']){
    const next=deleteRecord(ep,kind,0);
    assert.equal(next[kind].length,1);assert.equal(next[kind][0].id,'another');
    assert.deepEqual(next.daily,ep.daily);assert.equal(next.status,'closed');
  }
});

test('deleting a start record retains episode metadata; old backups with absent arrays or IDs work',()=>{
  const ep=fixture(),next=deleteRecord(ep,'daily',0);
  assert.equal(next.startDate,ep.startDate);assert.equal(next.initialSeverity,ep.initialSeverity);
  delete next.responses;delete next.notes;delete next.daily[0].id;
  assert.equal(editRecord(next,'daily',0,{severity:'軽い'}).daily[0].severity,'軽い');
  assert.equal(editEpisode(next,{body:'顔'}).body,'顔');
  assert.throws(()=>deleteRecord(next,'notes',0));
});
