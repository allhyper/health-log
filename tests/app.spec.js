import {test,expect} from '@playwright/test';

const example={id:'sample',status:'active',body:'お腹',side:'なし',symptom:'下痢',initialSeverity:'普通',startDate:'2026-09-01',endDate:null,trigger:'食事',createdAt:'created',updatedAt:'created',
  daily:[{id:'start',date:'2026-09-01',change:'start',severity:'普通',diarrheaCount:2,abdominalPain:'yes'}, {id:'daily',date:'2026-09-03',change:'worsened',severity:'強い'}],
  responses:[{id:'drug',date:'2026-09-02',type:'市販薬',drugName:'薬A',memo:'食後'}, {id:'hospital',date:'2026-09-03',type:'病院受診',department:'内科',hospital:'病院A',doctorMemo:'説明A',memo:'再診'}],
  notes:[{id:'note1',date:'2026-09-03',text:'メモA'}, {id:'note2',date:'2026-09-03',text:'メモB'}]};

async function seed(page,episodes=[example]){
  await page.goto('./');
  await expect(page.locator('#newFab')).toBeVisible();
  await page.evaluate(async episodes=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('symptom-journal-db',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    await new Promise((resolve,reject)=>{const tx=db.transaction('episodes','readwrite'),store=tx.objectStore('episodes');store.clear();for(const ep of episodes)store.put(ep);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    db.close();
  },episodes);
  await page.reload();
  await expect(page.locator('#newFab')).toBeVisible();
}
async function records(page){
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('symptom-journal-db',1);r.onsuccess=()=>resolve(r.result)});
    const result=await new Promise(resolve=>{const r=db.transaction('episodes').objectStore('episodes').getAll();r.onsuccess=()=>resolve(r.result)});
    db.close();return result;
  });
}
const item=(page,kind,index)=>page.locator(`.timeline-item[data-kind="${kind}"][data-index="${index}"]`);
async function save(page){await page.getByRole('button',{name:'変更を保存',exact:true}).click();await expect(page.locator('.edit-episode')).toBeVisible();}
async function close(page){await page.getByRole('button',{name:'閉じる',exact:true}).click();}

test.beforeEach(async({page})=>{
  page.on('pageerror',error=>{throw error});
});

test('episode edit persists after reload, cancel is inert, and conflicting dates stay unsaved',async({page},testInfo)=>{
  await seed(page);await page.locator('.detail').click();
  await page.locator('.edit-episode').click();
  await expect(page.getByLabel('部位',{exact:true})).toHaveValue('お腹');
  await page.getByRole('button',{name:'変更を保存'}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('部位',{exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'変更を保存'})).toBeFocused();
  await page.getByLabel('症状',{exact:true}).fill('保存しない');
  await page.getByRole('button',{name:'キャンセル'}).click();
  expect((await records(page))[0].symptom).toBe('下痢');
  await page.locator('.edit-episode').click();
  await page.getByLabel('部位',{exact:true}).fill('目');await page.getByLabel('左右').selectOption('右');
  await page.getByLabel('症状',{exact:true}).fill('かゆみ');await page.getByLabel('開始時の程度').selectOption('軽い');
  await page.getByLabel('開始日',{exact:true}).fill('2026-09-04');
  await page.getByRole('button',{name:'変更を保存'}).click();
  await expect(page.getByRole('alert')).toContainText('日付を確認');
  expect((await records(page))[0].body).toBe('お腹');
  await page.getByLabel('開始日',{exact:true}).fill('2026-08-31');
  await page.getByLabel('きっかけ・心当たり（任意）').fill('変更\n<test>');await save(page);
  await expect(page.getByRole('heading',{name:'右目 かゆみ'})).toBeVisible();
  await close(page);await page.reload();await page.locator('.detail').click();
  const ep=(await records(page))[0];expect(ep.body).toBe('目');expect(ep.daily[0].date).toBe('2026-08-31');expect(ep.daily[0].severity).toBe('軽い');
  expect(ep.responses).toEqual(example.responses);expect(ep.notes).toEqual(example.notes);
  await expect(page.locator('.notice')).toContainText('<test>');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`../work/detail-${testInfo.project.name}.png`});
});

test('daily edit validates duplicate dates, clears optional values, and deletion restores today actions',async({page})=>{
  await seed(page);await page.locator('.detail').click();
  await item(page,'daily',1).locator('.edit-record').click();
  await page.getByLabel('日付',{exact:true}).fill('2026-09-01');await page.getByRole('button',{name:'変更を保存'}).click();
  await expect(page.getByRole('alert')).toContainText('登録済み');
  await page.getByLabel('日付',{exact:true}).fill('2026-09-04');await page.getByLabel('変化',{exact:true}).selectOption('improved');await page.getByLabel('程度',{exact:true}).selectOption('軽い');await save(page);
  await item(page,'daily',0).locator('.edit-record').click();
  await page.getByLabel('下痢の回数（任意）').fill('');await page.getByLabel('腹痛（任意）').selectOption('');await save(page);
  expect((await records(page))[0].daily[0].diarrheaCount).toBeUndefined();
  await close(page);await page.locator('.same').click();await expect(page.locator('.same')).toBeDisabled();
  await page.locator('.detail').click();await item(page,'daily',2).locator('.delete-record').click();
  await page.getByRole('button',{name:'キャンセル'}).click();expect((await records(page))[0].daily).toHaveLength(3);
  await item(page,'daily',2).locator('.delete-record').click();await page.getByRole('button',{name:'削除する',exact:true}).click();await expect(page.locator('.edit-episode')).toBeVisible();
  await close(page);await expect(page.locator('.same')).toBeEnabled();await page.reload();await expect(page.locator('.same')).toBeEnabled();
});

test('response and memo edits/deletions target only the selected entry, including same-date entries',async({page})=>{
  await seed(page);await page.locator('.detail').click();await item(page,'responses',0).locator('.edit-record').click();
  await page.getByLabel('種類',{exact:true}).selectOption('処方薬');await page.getByLabel('日付',{exact:true}).fill('2026-09-04');await page.getByLabel('薬名（任意）').fill('薬B');await page.getByLabel('メモ（任意）',{exact:true}).fill('修正');await save(page);
  await item(page,'responses',1).locator('.edit-record').click();
  await expect(page.getByLabel('病院名（任意）')).toHaveValue('病院A');
  await page.getByLabel('病院名（任意）').fill('病院B');await page.getByLabel('診療科（任意）').fill('皮膚科');await page.getByLabel('医師から言われたこと（任意）').fill('説明B');await save(page);
  await item(page,'notes',1).locator('.edit-record').click();await page.getByLabel('メモ',{exact:true}).fill('修正B\n<安全な文字>');await save(page);
  let ep=(await records(page))[0];expect(ep.responses[0].drugName).toBe('薬B');expect(ep.responses[1].hospital).toBe('病院B');expect(ep.notes[0].text).toBe('メモA');expect(ep.notes[1].text).toContain('<安全な文字>');
  for(const kind of ['responses','notes']){
    await item(page,kind,0).locator('.delete-record').click();await page.keyboard.press('Escape');await expect(page.locator('.edit-episode')).toBeVisible();
    await item(page,kind,0).locator('.delete-record').click();
    await expect(page.getByRole('dialog')).toContainText(kind==='notes'?'メモA':'薬B');
    await page.getByRole('button',{name:'削除する',exact:true}).click();await expect(page.locator('.edit-episode')).toBeVisible();
  }
  await page.reload();ep=(await records(page))[0];expect(ep.responses.map(r=>r.id)).toEqual(['hospital']);expect(ep.notes.map(n=>n.id)).toEqual(['note2']);expect(ep.daily).toEqual(example.daily);
});

test('closed episodes can be edited from history and recovery deletion reopens them',async({page})=>{
  const ep=structuredClone(example);ep.status='closed';ep.endDate='2026-09-05';ep.daily.push({id:'recovery',date:'2026-09-05',change:'recovered',severity:'軽い'});
  await seed(page,[ep]);await page.getByRole('button',{name:'履歴',exact:true}).click();await page.locator('.linklike').click();await page.locator('.edit-episode').click();await page.getByLabel('終了日',{exact:true}).fill('2026-09-06');await save(page);
  expect((await records(page))[0].daily[2].date).toBe('2026-09-06');
  await item(page,'daily',2).locator('.delete-record').click();await expect(page.locator('.notice')).toContainText('継続中に戻ります');await page.getByRole('button',{name:'削除する',exact:true}).click();await expect(page.locator('.edit-episode')).toBeVisible();
  expect((await records(page))[0].status).toBe('active');await close(page);await page.getByRole('button',{name:'現在',exact:true}).click();await expect(page.locator('.detail')).toBeVisible();
});

test('whole-episode deletion requires confirmation and leaves another episode intact',async({page})=>{
  await seed(page,[example,{...example,id:'other',symptom:'腹痛'}]);await page.locator('article').filter({has:page.locator('.symptom-name',{hasText:'下痢'})}).locator('.detail').click();await page.locator('.delete-episode').click();
  await expect(page.getByRole('dialog')).toContainText('日々の変化・薬や病院の対応・途中メモをすべて削除');await page.getByRole('button',{name:'キャンセル'}).click();expect(await records(page)).toHaveLength(2);
  await page.locator('.delete-episode').click();await page.getByRole('button',{name:'削除する',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();
  expect((await records(page)).map(ep=>ep.id)).toEqual(['other']);await expect(page.locator('.symptom-name')).toHaveText('腹痛');
});

test('new registration, changes, responses, memo, recovery/reopen, history filters, JSON/CSV continue working',async({page})=>{
  await page.goto('./');await page.getByRole('button',{name:'＋ 新しい症状'}).click();await page.locator('#diarrheaCount').fill('3');await page.locator('#trigger').fill('食事');await page.getByRole('button',{name:'この症状を登録'}).click();await expect(page.locator('.same')).toBeDisabled();
  await page.locator('.response').click();await page.locator('#drugName').fill('薬C');await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('.memo').click();await page.locator('#memoText').fill('メモC');await page.locator('#triggerAdd').fill('追記C');await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('.recovered').click();await page.getByRole('dialog').getByRole('button',{name:'治った',exact:true}).click();await expect(page.locator('.detail')).toHaveCount(0);
  await page.getByRole('button',{name:'履歴',exact:true}).click();await page.locator('#fSymptom').fill('該当なし');await page.locator('#fSymptom').dispatchEvent('change');await expect(page.locator('.linklike')).toHaveCount(0);await page.locator('#clearFilter').click();await page.locator('#statsSymptom').selectOption('下痢');await expect(page.locator('#statsBox')).toContainText('1');
  await page.locator('.linklike').click();await page.locator('.reopen').click();await page.getByRole('button',{name:'データ',exact:true}).click();
  const jsonDownload=page.waitForEvent('download');await page.locator('#exportJson').click();const json=await jsonDownload;const stream=await json.createReadStream();let content='';for await(const chunk of stream)content+=chunk.toString();const backup=JSON.parse(content);expect(backup.episodes).toHaveLength(1);expect(backup.episodes[0].responses[0].drugName).toBe('薬C');expect(backup.episodes[0].notes[0].text).toBe('メモC');
  const csvDownload=page.waitForEvent('download');await page.locator('#exportCsv').click();expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/);
  page.once('dialog',d=>d.accept());await page.locator('#importJson').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(content)});await expect(page.locator('#importJson')).toHaveValue('');expect(await records(page)).toEqual(backup.episodes);
});

test('installed cache includes editing module and saved records remain editable offline',async({page,context})=>{
  await seed(page);await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}))});
  expect(await page.evaluate(async()=>Boolean(await caches.match('./records.js')))).toBe(true);
  await context.setOffline(true);await page.reload();await page.locator('.detail').click();await page.locator('.edit-episode').click();await page.getByLabel('きっかけ・心当たり（任意）').fill('オフラインで修正');await save(page);await page.reload();expect((await records(page))[0].trigger).toBe('オフラインで修正');
});

test('failed writes/deletes preserve records and allow retry or cancellation',async({page})=>{
  await seed(page);await page.locator('.detail').click();await page.locator('.edit-episode').click();await page.getByLabel('症状',{exact:true}).fill('更新後');
  await page.evaluate(()=>{
    window.savedPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(){throw new DOMException('test failure','QuotaExceededError')};
  });
  await page.getByRole('button',{name:'変更を保存'}).click();await expect(page.getByRole('alert')).toContainText('保存できません');
  expect((await records(page))[0]).toEqual(example);await expect(page.getByRole('button',{name:'変更を保存'})).toBeEnabled();
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.savedPut});await save(page);
  expect((await records(page))[0].symptom).toBe('更新後');
  await page.locator('.delete-episode').click();await page.evaluate(()=>{
    window.savedDelete=IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete=function(){throw new DOMException('test failure','UnknownError')};
  });
  await page.getByRole('button',{name:'削除する',exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存できません');expect(await records(page)).toHaveLength(1);
  await page.evaluate(()=>{IDBObjectStore.prototype.delete=window.savedDelete});await page.getByRole('button',{name:'キャンセル'}).click();await expect(page.locator('.edit-episode')).toBeVisible();
});

test('improve/worsen and bulk same-day recording still work after deleting a daily record',async({page})=>{
  await seed(page,[example,{...example,id:'other',symptom:'腹痛'}]);
  const card=()=>page.locator('article').filter({has:page.locator('.symptom-name',{hasText:'下痢'})});
  await card().locator('.improve').click();await page.getByRole('button',{name:'記録',exact:true}).click();await expect(card().locator('.same')).toBeDisabled();
  await page.locator('#allSame').click();await expect(page.locator('.same:enabled')).toHaveCount(0);expect((await records(page)).map(ep=>ep.daily.length)).toEqual([3,3]);
  await card().locator('.detail').click();await item(page,'daily',2).locator('.delete-record').click();await page.getByRole('button',{name:'削除する',exact:true}).click();await expect(page.locator('.edit-episode')).toBeVisible();await close(page);
  await card().locator('.worsen').click();await page.getByRole('button',{name:'記録',exact:true}).click();await expect(card().locator('.same')).toBeDisabled();expect((await records(page)).find(ep=>ep.id==='sample').daily[2].change).toBe('worsened');
});
