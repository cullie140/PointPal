/* ============ POINTPAL — app logic ============ */

const FISH_EMOJIS = ['🐠','🐟','🐡'];

const ICON_SET = [
  '⭐','✅','💪','❤️','🔥','✨','🎯','🏆',
  '🍽️','🧹','🧺','🛏️','🚿','🪥','🧻','👕',
  '🧴','🛁','🧼','🧽','🗑️','🪟','🚪','📦',
  '🐶','🐾','🌱','🪴','🌳','🚗','🧦','⏰',
  '📚','📝','🎒','🖍️','🧩','🎨','📖','✏️',
  '🎁','🍪','🍦','🧸','🎡','🎮','🕹️','📱',
  '🎬','🍿','🍕','🍔','🥤','🍬','🎈','🎉',
  '⚽','🚲','🏊','🎢','🛍️','💰','🌟','🐠'
];

const DEFAULT_CHORES = [
  { id:'dishes',   label:'Dishes',             emoji:'🍽️', points:5,  repeatable:false },
  { id:'brush',    label:'Brush Teeth',        emoji:'🪥', points:5,  repeatable:false },
  { id:'wipe',     label:'Wipe Butt',          emoji:'🧻', points:5,  repeatable:true  },
  { id:'shower',   label:'Shower',             emoji:'🚿', points:10, repeatable:false },
  { id:'dressed',  label:'Get Up & Dressed',   emoji:'👕', points:10, repeatable:false },
  { id:'worksheet',label:'Worksheet',          emoji:'📝', points:1,  repeatable:true  },
];
const DEFAULT_PRIZES = [
  { id:'p5min',    label:'5 Minutes Electronics',   emoji:'⏱️', cost:20,   grantsMinutes:5 },
  { id:'treat',    label:'Extra Treat or Dessert',  emoji:'🍪', cost:100 },
  { id:'icecream', label:'Go Out for Ice Cream',    emoji:'🍦', cost:250 },
  { id:'toy',      label:'$5–$10 Toy',              emoji:'🧸', cost:250 },
  { id:'outing',   label:'Fun Outing',              emoji:'🎡', cost:500 },
  { id:'fish',     label:'Fish',                    emoji:'🐠', cost:1000 },
];

function makeChild(id, name){
  return {
    id, name,
    points: 0,
    minutes: 0,
    weekStart: null,          // ISO date (Monday) this week's streak is counted against
    chores: structuredClone(DEFAULT_CHORES),
    prizes: structuredClone(DEFAULT_PRIZES),
    entries: []                // {id, ts, kind:'chore'|'school'|'bonus'|'redeem', refId, label, emoji, currency:'points'|'minutes', amount, status:'pending'|'approved'|'denied', grantsMinutes?}
  };
}

/* ---------- Supabase ---------- */
const SUPABASE_URL = 'https://anslyegjtjjfatlwpeqr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_W_2KORxrYuoHgAf1VT_X-Q_rtVNz1kj';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ACTIVE_CHILD_KEY = 'pointpal_active_child';
let state = null;
let child = null;
let authUserId = null;
let connectionOk = true;

function switchChild(id){
  const c = state.children.find(x=>x.id===id);
  if(!c) return;
  state.activeChildId = id;
  child = c;
  localStorage.setItem(ACTIVE_CHILD_KEY, id);
  render();
}

/* ---------- row <-> app shape converters ---------- */
function toEntryRow(entry, childId){
  return {
    id: entry.id, child_id: childId, ts: entry.ts, kind: entry.kind, ref_id: entry.refId || null,
    label: entry.label, emoji: entry.emoji, currency: entry.currency, amount: entry.amount,
    status: entry.status, grants_minutes: entry.grantsMinutes || null
  };
}
function rowsToChild(childRow, chores, prizes, entries){
  return {
    id: childRow.id,
    name: childRow.name,
    points: childRow.points,
    minutes: childRow.minutes,
    weekStart: childRow.week_start,
    chores: chores.filter(c=>c.child_id===childRow.id).map(c=>({id:c.id, label:c.label, emoji:c.emoji, points:c.points, repeatable:c.repeatable, schedule:c.schedule||undefined})),
    prizes: prizes.filter(p=>p.child_id===childRow.id).map(p=>({id:p.id, label:p.label, emoji:p.emoji, cost:p.cost, grantsMinutes:p.grants_minutes||undefined})),
    entries: entries.filter(e=>e.child_id===childRow.id).map(e=>({id:e.id, ts:Number(e.ts), kind:e.kind, refId:e.ref_id, label:e.label, emoji:e.emoji, currency:e.currency, amount:e.amount, status:e.status, grantsMinutes:e.grants_minutes||undefined}))
  };
}
async function insertChildFull(c){
  await sb.from('children').insert({id:c.id, name:c.name, points:c.points, minutes:c.minutes, week_start:c.weekStart}).throwOnError();
  if(c.chores.length) await sb.from('chores').insert(c.chores.map(ch=>({id:ch.id, child_id:c.id, label:ch.label, emoji:ch.emoji, points:ch.points, repeatable:ch.repeatable, schedule:ch.schedule||null}))).throwOnError();
  if(c.prizes.length) await sb.from('prizes').insert(c.prizes.map(p=>({id:p.id, child_id:c.id, label:p.label, emoji:p.emoji, cost:p.cost, grants_minutes:p.grantsMinutes||null}))).throwOnError();
}

async function fetchCloudState(){
  const [childrenRes, choresRes, prizesRes, entriesRes, settingsRes] = await Promise.all([
    sb.from('children').select('*').order('created_at'),
    sb.from('chores').select('*'),
    sb.from('prizes').select('*'),
    sb.from('entries').select('*'),
    sb.from('family_settings').select('*').maybeSingle()
  ]);
  const firstError = childrenRes.error || choresRes.error || prizesRes.error || entriesRes.error || settingsRes.error;
  if(firstError) throw firstError;

  let childRows = childrenRes.data;
  let choreRows = choresRes.data, prizeRows = prizesRes.data;
  if(childRows.length===0){
    const fresh = makeChild(uid(), 'Champ');
    await insertChildFull(fresh);
    childRows = [{id:fresh.id, name:fresh.name, points:0, minutes:0, week_start:null}];
    choreRows = fresh.chores.map(c=>({...c, child_id:fresh.id}));
    prizeRows = fresh.prizes.map(p=>({...p, child_id:fresh.id, grants_minutes:p.grantsMinutes||null}));
  }

  let pin = '1234';
  if(settingsRes.data){ pin = settingsRes.data.pin; }
  else { await sb.from('family_settings').insert({pin:'1234'}).throwOnError(); }

  const children = childRows.map(cr => rowsToChild(cr, choreRows, prizeRows, entriesRes.data));
  return { pin, children };
}

function handleSyncError(error){
  console.error('PointPal sync error', error);
  connectionOk = false;
  updateOfflineBanner();
}

/* ---------- realtime + connectivity ---------- */
let realtimeChannel = null;
let refetchTimer = null;

function scheduleRefetch(){
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(async ()=>{
    try{
      const cloud = await fetchCloudState();
      const activeId = child ? child.id : null;
      state.pin = cloud.pin;
      state.children = cloud.children;
      child = state.children.find(c=>c.id===activeId) || state.children[0];
      state.activeChildId = child.id;
      connectionOk = true;
      updateOfflineBanner();
      render();
    }catch(e){
      handleSyncError(e);
    }
  }, 300);
}

function subscribeRealtime(){
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  const filter = `user_id=eq.${authUserId}`;
  realtimeChannel = sb.channel('family-sync')
    .on('postgres_changes', {event:'*', schema:'public', table:'children', filter}, scheduleRefetch)
    .on('postgres_changes', {event:'*', schema:'public', table:'chores', filter}, scheduleRefetch)
    .on('postgres_changes', {event:'*', schema:'public', table:'prizes', filter}, scheduleRefetch)
    .on('postgres_changes', {event:'*', schema:'public', table:'entries', filter}, scheduleRefetch)
    .subscribe((status)=>{
      if(status==='SUBSCRIBED'){ connectionOk = true; updateOfflineBanner(); }
      else if(status==='CHANNEL_ERROR' || status==='TIMED_OUT' || status==='CLOSED'){ connectionOk = false; updateOfflineBanner(); }
    });
}

function updateOfflineBanner(){
  const banner = document.getElementById('offlineBanner');
  if(banner) banner.classList.toggle('show', !connectionOk);
  const mc = document.getElementById('mainContent');
  if(mc) mc.classList.toggle('offline-locked', !connectionOk);
  const schoolBtn = document.getElementById('schoolBtn');
  if(schoolBtn) schoolBtn.classList.toggle('offline-locked', !connectionOk);
}
window.addEventListener('online', ()=>{ connectionOk = true; updateOfflineBanner(); if(state) scheduleRefetch(); });
window.addEventListener('offline', ()=>{ connectionOk = false; updateOfflineBanner(); });

/* ---------- date helpers ---------- */
function dateKey(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayKey(){ return dateKey(new Date()); }
function getMonday(d){
  const nd = new Date(d);
  const day = nd.getDay();
  const diff = (day===0 ? -6 : 1-day);
  nd.setDate(nd.getDate()+diff);
  nd.setHours(0,0,0,0);
  return nd;
}
function weekKeyFor(d){ return dateKey(getMonday(d)); }
function addDays(d, n){ const nd = new Date(d); nd.setDate(nd.getDate()+n); return nd; }
function daysInMonthCount(y, m){ return new Date(y, m+1, 0).getDate(); }

const DOW_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEK_ORDINAL = {1:'1st', 2:'2nd', 3:'3rd', 4:'4th', '-1':'Last'};

function nthWeekdayOfMonthMatches(date, week){
  if(week === -1){
    const nextWeek = new Date(date);
    nextWeek.setDate(date.getDate()+7);
    return nextWeek.getMonth() !== date.getMonth();
  }
  return Math.ceil(date.getDate()/7) === week;
}

function matchesScheduleForDate(sched, date){
  if(!sched || sched.type==='daily' || sched.type==='once') return true;
  const dow = date.getDay();
  if(sched.type==='weekly'){
    return (sched.days||[]).includes(dow);
  }
  if(sched.type==='biweekly'){
    if(dow !== sched.day) return false;
    const anchor = new Date(sched.anchorMonday+'T00:00:00');
    const thisMonday = getMonday(date);
    const weeksDiff = Math.round((thisMonday - anchor) / (7*24*60*60*1000));
    return weeksDiff % 2 === 0;
  }
  if(sched.type==='monthly'){
    if(dow !== sched.day) return false;
    return nthWeekdayOfMonthMatches(date, sched.week);
  }
  return true;
}

function isChoreVisibleToday(chore){
  const sched = chore.schedule;
  if(sched && sched.type==='once'){
    const alreadyDone = child.entries.some(e=>e.kind==='chore' && e.refId===chore.id && e.status==='approved');
    return !alreadyDone;
  }
  return matchesScheduleForDate(sched, new Date());
}

function scheduleSummaryText(sched){
  if(!sched || sched.type==='daily') return 'Daily';
  if(sched.type==='once') return 'One-time';
  if(sched.type==='weekly'){
    if(!sched.days || sched.days.length===0) return 'Certain days';
    return sched.days.slice().sort().map(d=>DOW_ABBR[d]).join(', ');
  }
  if(sched.type==='biweekly') return `Every other ${DOW_ABBR[sched.day]}`;
  if(sched.type==='monthly') return `${WEEK_ORDINAL[sched.week]} ${DOW_ABBR[sched.day]}`;
  return 'Daily';
}

function scheduleMidnightRefresh(){
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 5);
  setTimeout(()=>{
    render();
    scheduleMidnightRefresh();
  }, next.getTime()-now.getTime());
}
function ensureWeek(c){
  const wk = weekKeyFor(new Date());
  if(c.weekStart !== wk){
    c.weekStart = wk;
    sb.from('children').update({week_start: wk}).eq('id', c.id).then(({error})=>{ if(error) handleSyncError(error); });
  }
}

/* ---------- derived helpers (all take an explicit child) ---------- */
function entriesToday(c, kind, refId){
  const tk = todayKey();
  return c.entries.filter(e => e.kind===kind && (refId===undefined || e.refId===refId) && dateKey(new Date(e.ts))===tk);
}
function entriesForDay(c, dk){
  return c.entries.filter(e => dateKey(new Date(e.ts))===dk).sort((a,b)=>a.ts-b.ts);
}
function goodDaysThisWeekApproved(c){
  const wk = c.weekStart;
  return c.entries.filter(e => e.kind==='school' && e.status==='approved' && weekKeyFor(new Date(e.ts))===wk).length;
}
function bonusAlreadyGrantedThisWeek(c){
  const wk = c.weekStart;
  return c.entries.some(e => e.kind==='bonus' && weekKeyFor(new Date(e.ts))===wk);
}
function pendingEntries(){
  const all = [];
  state.children.forEach(c=>{
    c.entries.forEach(e=>{
      if(e.status==='pending') all.push(Object.assign({}, e, {_childId:c.id, _childName:c.name}));
    });
  });
  return all.sort((a,b)=>a.ts-b.ts);
}
function findEntryOwner(id){
  for(const c of state.children){
    const e = c.entries.find(x=>x.id===id);
    if(e) return {child:c, entry:e};
  }
  return null;
}

/* ---------- id gen ---------- */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

function requireOnline(){
  if(!connectionOk){ toast('Offline — try again once reconnected'); return false; }
  return true;
}

/* ============ ACTIONS ============ */
async function requestChore(choreId, evt){
  if(!requireOnline()) return;
  const chore = child.chores.find(c=>c.id===choreId);
  if(!chore) return;
  if(chore.schedule && chore.schedule.type==='once'){
    const already = child.entries.some(e=>e.kind==='chore' && e.refId===choreId && e.status!=='denied');
    if(already){ toast(`${chore.label} is already done! 🎉`); return; }
  } else if(!chore.repeatable){
    const already = entriesToday(child, 'chore', choreId).some(e=>e.status!=='denied');
    if(already){ toast(`${chore.label} is already done for today! 🎉`); return; }
  }
  const entry = { id:uid(), ts:Date.now(), kind:'chore', refId:choreId, label:chore.label, emoji:chore.emoji, currency:'points', amount:chore.points, status:'pending' };
  child.entries.push(entry);
  spawnFloaterAt(evt, `+${chore.points} pts (pending)`, 'var(--gold-deep)');
  toast(`Sent "${chore.label}" for approval ⏳`);
  render();
  try{ await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError(); }catch(err){ handleSyncError(err); }
}

async function requestSchoolDay(evt){
  if(!requireOnline()) return;
  ensureWeek(child);
  const already = entriesToday(child, 'school').some(e=>e.status!=='denied');
  if(already){ toast('Already marked for today! 🌟'); return; }
  const entry = { id:uid(), ts:Date.now(), kind:'school', refId:'school', label:'Good Day at School', emoji:'🎒', currency:'minutes', amount:15, status:'pending' };
  child.entries.push(entry);
  spawnFloaterAt(evt, `+15 min (pending)`, 'var(--gold-deep)');
  toast('Sent for approval ⏳');
  render();
  try{ await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError(); }catch(err){ handleSyncError(err); }
}

function pastDateOrToast(dateStr){
  if(!dateStr){ toast('Pick a date'); return null; }
  const d = new Date(dateStr+'T12:00:00');
  if(dateKey(d) > todayKey()){ toast('Pick today or an earlier date'); return null; }
  return d;
}

async function addPastSchoolDay(dateStr){
  if(!requireOnline()) return;
  const d = pastDateOrToast(dateStr);
  if(!d) return;
  const dk = dateKey(d);
  const already = entriesForDay(child, dk).some(e=>e.kind==='school' && e.status!=='denied');
  if(already){ toast('That day already has a school entry'); return; }

  const schoolEntry = { id:uid(), ts:d.getTime(), kind:'school', refId:'school', label:'Good Day at School', emoji:'🎒', currency:'minutes', amount:15, status:'approved' };
  child.entries.push(schoolEntry);
  child.minutes += 15;

  const wk = weekKeyFor(d);
  const goodDays = child.entries.filter(e=>e.kind==='school' && e.status==='approved' && weekKeyFor(new Date(e.ts))===wk).length;
  const bonusAlready = child.entries.some(e=>e.kind==='bonus' && weekKeyFor(new Date(e.ts))===wk);
  let bonusEntry = null;
  if(goodDays>=5 && !bonusAlready){
    bonusEntry = { id:uid(), ts:d.getTime(), kind:'bonus', refId:'bonus', label:'5-Day Streak Bonus!', emoji:'🏆', currency:'minutes', amount:120, status:'approved' };
    child.entries.push(bonusEntry);
    child.minutes += 120;
    toast('5 good days that week — bonus added! 🏆');
  } else {
    toast('Added a Good Day at School ✅');
  }
  renderParentBody(); render();

  try{
    await sb.from('entries').insert(toEntryRow(schoolEntry, child.id)).throwOnError();
    if(bonusEntry) await sb.from('entries').insert(toEntryRow(bonusEntry, child.id)).throwOnError();
    await sb.from('children').update({minutes: child.minutes}).eq('id', child.id).throwOnError();
  }catch(err){ handleSyncError(err); }
}

async function addPastChore(choreId, dateStr){
  if(!requireOnline()) return;
  const chore = child.chores.find(c=>c.id===choreId);
  if(!chore) return;
  const d = pastDateOrToast(dateStr);
  if(!d) return;
  const dk = dateKey(d);
  if(!chore.repeatable){
    const already = entriesForDay(child, dk).some(e=>e.kind==='chore' && e.refId===choreId && e.status!=='denied');
    if(already){ toast(`${chore.label} already has an entry that day`); return; }
  }
  const entry = { id:uid(), ts:d.getTime(), kind:'chore', refId:choreId, label:chore.label, emoji:chore.emoji, currency:'points', amount:chore.points, status:'approved' };
  child.entries.push(entry);
  child.points += chore.points;
  toast(`Added "${chore.label}" ✅`);
  renderParentBody(); render();
  try{
    await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError();
    await sb.from('children').update({points: child.points}).eq('id', child.id).throwOnError();
  }catch(err){ handleSyncError(err); }
}

async function addPastPrizeRedemption(prizeId, dateStr){
  if(!requireOnline()) return;
  const prize = child.prizes.find(p=>p.id===prizeId);
  if(!prize) return;
  const d = pastDateOrToast(dateStr);
  if(!d) return;
  const entry = {
    id:uid(), ts:d.getTime(), kind:'redeem', refId:prizeId,
    label:prize.label, emoji:prize.emoji, currency:'points', amount:prize.cost, status:'approved',
    grantsMinutes: prize.grantsMinutes || 0
  };
  child.entries.push(entry);
  child.points = Math.max(0, child.points - prize.cost);
  if(prize.grantsMinutes) child.minutes += prize.grantsMinutes;
  toast(`Added "${prize.label}" redemption`);
  renderParentBody(); render();
  try{
    await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError();
    await sb.from('children').update({points: child.points, minutes: child.minutes}).eq('id', child.id).throwOnError();
  }catch(err){ handleSyncError(err); }
}

async function requestPrize(prizeId, evt){
  if(!requireOnline()) return;
  const prize = child.prizes.find(p=>p.id===prizeId);
  if(!prize) return;
  const already = child.entries.some(e=>e.kind==='redeem' && e.refId===prizeId && e.status==='pending');
  if(already){ toast('Already waiting on approval for that one!'); return; }
  const entry = {
    id:uid(), ts:Date.now(), kind:'redeem', refId:prizeId,
    label:prize.label, emoji:prize.emoji, currency:'points', amount:prize.cost, status:'pending',
    grantsMinutes: prize.grantsMinutes || 0
  };
  child.entries.push(entry);
  spawnFloaterAt(evt, `Requested!`, 'var(--coral-deep)');
  toast(`Asked to redeem "${prize.label}" 🙋`);
  render();
  try{ await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError(); }catch(err){ handleSyncError(err); }
}

async function approveEntry(id, opts){
  if(!connectionOk){ if(!(opts && opts.silent)) toast('Offline — try again once reconnected'); return; }
  const owner = findEntryOwner(id);
  if(!owner) return;
  const c = owner.child, e = owner.entry;
  if(e.status!=='pending') return;
  if(!(opts && opts.silent)) snapshotForUndo(`Approved "${e.label}"`, c, e, 'pending');
  e.status='approved';

  if(e.kind==='chore' || e.kind==='school' || e.kind==='bonus'){
    if(e.currency==='points') c.points += e.amount;
    else c.minutes += e.amount;
    burstConfetti();
  } else if(e.kind==='redeem'){
    c.points -= e.amount;
    if(e.grantsMinutes) c.minutes += e.grantsMinutes;
    burstConfetti();
  }

  let newBonus = null;
  if(e.kind==='school'){
    ensureWeek(c);
    const goodDays = goodDaysThisWeekApproved(c);
    if(goodDays>=5 && !bonusAlreadyGrantedThisWeek(c)){
      newBonus = { id:uid(), ts:Date.now(), kind:'bonus', refId:'bonus', label:'5-Day Streak Bonus!', emoji:'🏆', currency:'minutes', amount:120, status:'pending' };
      c.entries.push(newBonus);
      if(lastActionSnapshot) lastActionSnapshot.extraEntryId = newBonus.id;
      toast('5 good days this week — bonus sent for approval! 🏆');
    }
  }
  render();

  try{
    await sb.from('entries').update({status:'approved'}).eq('id', id).throwOnError();
    await sb.from('children').update({points:c.points, minutes:c.minutes}).eq('id', c.id).throwOnError();
    if(newBonus) await sb.from('entries').insert(toEntryRow(newBonus, c.id)).throwOnError();
  }catch(err){ handleSyncError(err); }
}

async function bulkApproveAll(){
  const ids = pendingEntries().map(e=>e.id);
  if(ids.length===0) return;
  const beforeLen = state.children.reduce((sum,c)=>sum+c.entries.length, 0);
  await Promise.all(ids.map(id=>approveEntry(id, {silent:true})));
  const afterLen = state.children.reduce((sum,c)=>sum+c.entries.length, 0);
  const bonusAdded = afterLen > beforeLen;
  toast(bonusAdded
    ? `Approved ${ids.length} item${ids.length>1?'s':''} — plus a new streak bonus to approve! 🏆`
    : `Approved ${ids.length} item${ids.length>1?'s':''} ✅`);
}

async function denyEntry(id, opts){
  if(!connectionOk){ if(!(opts && opts.silent)) toast('Offline — try again once reconnected'); return; }
  const owner = findEntryOwner(id);
  if(!owner) return;
  const c = owner.child, e = owner.entry;
  if(e.status!=='pending') return;
  if(!(opts && opts.silent)) snapshotForUndo(`Denied "${e.label}"`, c, e, 'pending');
  e.status='denied';
  render();
  try{ await sb.from('entries').update({status:'denied'}).eq('id', id).throwOnError(); }catch(err){ handleSyncError(err); }
}

/* ============ UNDO TOAST ============ */
let lastActionSnapshot = null;
let undoTimer = null;

function snapshotForUndo(message, c, entry, prevStatus){
  lastActionSnapshot = {
    childId: c.id,
    entryId: entry.id,
    prevStatus,
    points: c.points,
    minutes: c.minutes,
    extraEntryId: null
  };
  showUndoToast(message);
}

function showUndoToast(message){
  clearTimeout(undoTimer);
  document.getElementById('undoToastMsg').textContent = message;
  document.getElementById('undoToast').classList.add('show');
  const bar = document.getElementById('undoToastBarFill');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;
  bar.style.transition = 'width 6000ms linear';
  bar.style.width = '0%';
  undoTimer = setTimeout(hideUndoToast, 6000);
}

function hideUndoToast(){
  clearTimeout(undoTimer);
  undoTimer = null;
  lastActionSnapshot = null;
  document.getElementById('undoToast').classList.remove('show');
}

async function performUndo(){
  if(!lastActionSnapshot) return;
  const snap = lastActionSnapshot;
  const c = state.children.find(x=>x.id===snap.childId);
  hideUndoToast();
  if(!c) return;

  const entry = c.entries.find(e=>e.id===snap.entryId);
  if(entry) entry.status = snap.prevStatus;
  if(snap.extraEntryId){
    c.entries = c.entries.filter(e=>e.id!==snap.extraEntryId);
  }
  c.points = snap.points;
  c.minutes = snap.minutes;

  render();
  toast('Undone ↩️');

  try{
    if(entry) await sb.from('entries').update({status: snap.prevStatus}).eq('id', snap.entryId).throwOnError();
    if(snap.extraEntryId) await sb.from('entries').delete().eq('id', snap.extraEntryId).throwOnError();
    await sb.from('children').update({points:c.points, minutes:c.minutes}).eq('id', c.id).throwOnError();
  }catch(err){ handleSyncError(err); }
}

/* ============ PIN FLOW ============ */
const PIN_LOCK_KEY = 'pointpal_pin_lock';
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 30000;
let pinLockTimer = null;

function getPinLockState(){
  try{
    const raw = localStorage.getItem(PIN_LOCK_KEY);
    return raw ? JSON.parse(raw) : {fails:0, lockUntil:null};
  }catch(e){ return {fails:0, lockUntil:null}; }
}
function savePinLockState(s){
  try{ localStorage.setItem(PIN_LOCK_KEY, JSON.stringify(s)); }catch(e){}
}

function openPin(ctx){
  pinContext = ctx;
  pinBuffer='';
  document.getElementById('pinOverlay').classList.add('show');
  updatePinLockUI();
}
function closePin(){
  document.getElementById('pinOverlay').classList.remove('show');
  pinBuffer='';
  clearInterval(pinLockTimer);
}

function updatePinLockUI(){
  const lock = getPinLockState();
  const pad = document.getElementById('pinPad');
  const title = document.getElementById('pinTitle');
  const sub = document.getElementById('pinSub');
  clearInterval(pinLockTimer);
  if(lock.lockUntil && lock.lockUntil > Date.now()){
    pad.style.display = 'none';
    title.textContent = 'Locked';
    renderPinDots();
    const tick = ()=>{
      const remaining = Math.max(0, Math.ceil((lock.lockUntil - Date.now())/1000));
      sub.textContent = `Too many wrong tries. Try again in ${remaining}s`;
      if(remaining<=0){
        clearInterval(pinLockTimer);
        savePinLockState({fails:0, lockUntil:null});
        pad.style.display = 'grid';
        title.textContent = 'Parent PIN';
        sub.textContent = 'Enter the 4-digit code';
        renderPinDots();
      }
    };
    tick();
    pinLockTimer = setInterval(tick, 1000);
  } else {
    pad.style.display = 'grid';
    title.textContent = 'Parent PIN';
    sub.textContent = 'Enter the 4-digit code';
    renderPinDots();
  }
}

function pressPinKey(k){
  const lock = getPinLockState();
  if(lock.lockUntil && lock.lockUntil > Date.now()) return;
  if(k==='del'){ pinBuffer = pinBuffer.slice(0,-1); renderPinDots(); return; }
  if(pinBuffer.length>=4) return;
  pinBuffer += k;
  renderPinDots();
  if(pinBuffer.length===4){
    setTimeout(()=>{
      if(pinBuffer===state.pin){
        savePinLockState({fails:0, lockUntil:null});
        closePin();
        if(pinContext==='unlock'){ openParent(); }
      } else {
        const newFails = lock.fails + 1;
        if(newFails >= PIN_MAX_FAILS){
          savePinLockState({fails:0, lockUntil: Date.now()+PIN_LOCK_MS});
          pinBuffer='';
          updatePinLockUI();
        } else {
          savePinLockState({fails:newFails, lockUntil:null});
          const dots = document.getElementById('pinDots');
          dots.style.animation='none';
          void dots.offsetWidth;
          dots.style.animation='shake 400ms ease';
          pinBuffer='';
          renderPinDots();
        }
      }
    }, 120);
  }
}
function renderPinDots(){
  const dots = document.getElementById('pinDots');
  dots.innerHTML='';
  for(let i=0;i<4;i++){
    const d = document.createElement('div');
    d.className = 'pin-dot' + (i<pinBuffer.length ? ' filled':'');
    dots.appendChild(d);
  }
}
function buildPinPad(){
  const pad = document.getElementById('pinPad');
  pad.innerHTML='';
  const keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
  keys.forEach(k=>{
    const btn = document.createElement('button');
    btn.className='pin-key';
    if(k===''){ btn.style.visibility='hidden'; }
    else if(k==='del'){ btn.textContent='⌫'; btn.onclick=()=>pressPinKey('del'); }
    else { btn.textContent=k; btn.onclick=()=>pressPinKey(k); }
    pad.appendChild(btn);
  });
}

/* ============ PARENT ZONE ============ */
const PARENT_IDLE_MS = 120000; // auto-lock Parent Zone after 2 idle minutes
let parentLastActivity = 0;
let parentIdleChecker = null;
function resetParentIdleTimer(){ parentLastActivity = Date.now(); }
function startParentIdleWatch(){
  resetParentIdleTimer();
  document.addEventListener('click', resetParentIdleTimer);
  document.addEventListener('input', resetParentIdleTimer);
  document.addEventListener('touchstart', resetParentIdleTimer);
  clearInterval(parentIdleChecker);
  parentIdleChecker = setInterval(()=>{
    if(Date.now() - parentLastActivity > PARENT_IDLE_MS){
      closeParent();
      toast('Parent Zone locked (idle) 🔒');
    }
  }, 5000);
}
function stopParentIdleWatch(){
  clearInterval(parentIdleChecker);
  document.removeEventListener('click', resetParentIdleTimer);
  document.removeEventListener('input', resetParentIdleTimer);
  document.removeEventListener('touchstart', resetParentIdleTimer);
}

function openParent(){
  activeParentTab='approve';
  settingsTab='profile';
  manualEntryType=null;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.ptab==='approve'));
  renderParentBody();
  document.getElementById('parentOverlay').classList.add('show');
  startParentIdleWatch();
}
function closeParent(){
  stopParentIdleWatch();
  document.getElementById('parentOverlay').classList.remove('show');
}
function renderParentBody(){
  const body = document.getElementById('parentBody');
  if(activeParentTab==='approve') body.innerHTML = parentApproveHTML();
  else if(activeParentTab==='chores') body.innerHTML = parentChoresHTML();
  else if(activeParentTab==='prizes') body.innerHTML = parentPrizesHTML();
  else body.innerHTML = parentSettingsHTML();
  wireParentBody();
}

function parentApproveHTML(){
  const pend = pendingEntries();
  if(pend.length===0){
    return `<div class="empty-state"><div class="e">✅</div>Nothing waiting on you right now.</div>`;
  }
  const header = `
    <div class="approve-all-row">
      <div class="approve-all-count">${pend.length} waiting</div>
      <button class="btn-bulk-approve" id="bulkApproveBtn">Approve All</button>
    </div>`;
  const multiChild = state.children.length > 1;
  return header + pend.map(e=>{
    const sign = e.kind==='redeem' ? '−' : '+';
    const cur = e.currency==='points' ? 'pts' : 'min';
    let extra = '';
    if(e.kind==='redeem'){
      const owner = state.children.find(c=>c.id===e._childId);
      const after = (owner ? owner.points : 0) - e.amount;
      extra = `<div class="approval-meta">Balance after approving: <b style="color:${after<0?'var(--danger)':'var(--ink)'}">${after} pts</b></div>`;
    }
    return `
    <div class="approval-item">
      <div class="approval-top">
        <div class="approval-label">${e.emoji} ${e.label}${multiChild?` <span class="child-tag">${e._childName}</span>`:''}</div>
        <div class="approval-amount">${sign}${e.amount} ${cur}</div>
      </div>
      <div class="approval-meta">${timeAgo(e.ts)}${e.grantsMinutes?` · also grants ${e.grantsMinutes} min`:''}</div>
      ${extra}
      <div class="approval-actions">
        <button class="btn btn-approve" data-approve="${e.id}">Approve</button>
        <button class="btn btn-deny" data-deny="${e.id}">Deny</button>
      </div>
    </div>`;
  }).join('');
}

function parentChoresHTML(){
  const rows = child.chores.map(c=>`
    <div class="list-edit-item">
      <button class="icon-swatch" data-edit-chore-icon="${c.id}">${c.emoji}</button>
      <input class="settings-input label-edit" data-chore-label="${c.id}" value="${c.label}">
      <button class="schedule-pill" data-edit-chore-schedule="${c.id}">📅 ${scheduleSummaryText(c.schedule)}</button>
      <label style="display:flex; align-items:center; gap:5px; font-weight:700; font-size:12px; color:var(--ink-soft); white-space:nowrap;">
        <input type="checkbox" data-chore-repeat="${c.id}" ${c.repeatable?'checked':''}> Repeatable
      </label>
      <input class="settings-input" type="number" min="0" data-chore-points="${c.id}" value="${c.points}">
      <button class="icon-btn-sm" data-chore-del="${c.id}">Remove</button>
    </div>
  `).join('');
  return `
    <div class="sheet-sub">Editing <b>${child.name}</b>'s chores. Names, points, icons, and schedules all update live. Removing a chore doesn't erase past history.</div>
    ${rows}
    <div class="add-row" style="flex-wrap:wrap;">
      <button class="icon-swatch" id="newChoreIconBtn" style="margin-top:10px;">${pendingChoreIcon}</button>
      <input id="newChoreLabel" class="child-name-input" placeholder="New chore name" style="flex:1; margin-top:10px;">
      <button class="schedule-pill" id="newChoreScheduleBtn" style="margin-top:10px;">📅 ${scheduleSummaryText(pendingChoreSchedule)}</button>
      <input id="newChorePoints" class="settings-input" type="number" placeholder="pts" style="margin-top:8px;">
      <label style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; margin-top:8px;">
        <input type="checkbox" id="newChoreRepeat"> Repeatable
      </label>
      <button class="btn btn-primary" id="addChoreBtn" style="margin-top:8px;">Add Chore</button>
    </div>
  `;
}

function parentPrizesHTML(){
  const rows = child.prizes.map(p=>`
    <div class="list-edit-item">
      <button class="icon-swatch" data-edit-prize-icon="${p.id}">${p.emoji}</button>
      <input class="settings-input label-edit" data-prize-label="${p.id}" value="${p.label}">
      <input class="settings-input" type="number" min="0" data-prize-minutes="${p.id}" value="${p.grantsMinutes||0}" title="Bonus minutes granted" style="width:56px;">
      <input class="settings-input" type="number" min="0" data-prize-cost="${p.id}" value="${p.cost}">
      <button class="icon-btn-sm" data-prize-del="${p.id}">Remove</button>
    </div>
  `).join('');
  return `
    <div class="sheet-sub">Editing <b>${child.name}</b>'s prizes. Names, costs, bonus minutes, and icons all update live.</div>
    ${rows}
    <div class="add-row" style="flex-wrap:wrap;">
      <button class="icon-swatch" id="newPrizeIconBtn" style="margin-top:10px;">${pendingPrizeIcon}</button>
      <input id="newPrizeLabel" class="child-name-input" placeholder="New prize name" style="flex:1; margin-top:10px;">
      <input id="newPrizeCost" class="settings-input" type="number" placeholder="cost" style="margin-top:8px;">
      <input id="newPrizeMinutes" class="settings-input" type="number" placeholder="min" style="margin-top:8px;" title="Minutes granted (optional)">
      <button class="btn btn-primary" id="addPrizeBtn" style="margin-top:8px;">Add Prize</button>
    </div>
  `;
}

function iconPickerHTML(){
  return `<div class="icon-grid">${ICON_SET.map(ic=>`<button data-icon="${ic}">${ic}</button>`).join('')}</div>`;
}
function openIconPicker(ctx){
  iconPickerContext = ctx;
  document.getElementById('iconPickerBody').innerHTML = iconPickerHTML();
  document.querySelectorAll('#iconPickerBody [data-icon]').forEach(b=>{
    b.onclick=()=>pickIcon(b.dataset.icon);
  });
  document.getElementById('iconOverlay').classList.add('show');
}
function closeIconPicker(){
  document.getElementById('iconOverlay').classList.remove('show');
  iconPickerContext = null;
}
async function pickIcon(emoji){
  const ctx = iconPickerContext;
  if(!ctx) return;
  closeIconPicker();
  if(ctx.type==='newChore'){
    pendingChoreIcon = emoji;
    const btn = document.getElementById('newChoreIconBtn');
    if(btn) btn.textContent = emoji;
  } else if(ctx.type==='newPrize'){
    pendingPrizeIcon = emoji;
    const btn = document.getElementById('newPrizeIconBtn');
    if(btn) btn.textContent = emoji;
  } else if(ctx.type==='editChore'){
    if(!requireOnline()) return;
    const c = child.chores.find(x=>x.id===ctx.id);
    if(c){ c.emoji = emoji; render(); try{ await sb.from('chores').update({emoji}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); } }
  } else if(ctx.type==='editPrize'){
    if(!requireOnline()) return;
    const p = child.prizes.find(x=>x.id===ctx.id);
    if(p){ p.emoji = emoji; render(); try{ await sb.from('prizes').update({emoji}).eq('id', p.id).throwOnError(); }catch(err){ handleSyncError(err); } }
  }
}

function openSchedulePicker(ctx){
  schedulePickerContext = ctx;
  const current = ctx.type==='newChore' ? pendingChoreSchedule : (child.chores.find(c=>c.id===ctx.id)||{}).schedule;
  scheduleDraft = structuredClone(current || {type:'daily'});
  document.getElementById('schedulePickerBody').innerHTML = scheduleEditorHTML();
  wireScheduleEditor();
  document.getElementById('scheduleOverlay').classList.add('show');
}
function closeSchedulePicker(){
  document.getElementById('scheduleOverlay').classList.remove('show');
  schedulePickerContext = null;
}

function scheduleEditorHTML(){
  const types = [
    {key:'daily', label:'Daily'},
    {key:'weekly', label:'Certain Days'},
    {key:'biweekly', label:'Every Other Week'},
    {key:'monthly', label:'Monthly'},
    {key:'once', label:'One-Time'}
  ];
  const typeRow = `<div class="sched-type-row">${types.map(t=>`<button class="sched-type-btn ${scheduleDraft.type===t.key?'active':''}" data-sched-type="${t.key}">${t.label}</button>`).join('')}</div>`;

  let sub = '';
  if(scheduleDraft.type==='weekly'){
    const days = scheduleDraft.days || [];
    sub = `
      <div class="sched-sub-label">Which days?</div>
      <div class="sched-day-row">${DOW_ABBR.map((d,i)=>`<button class="sched-day-btn ${days.includes(i)?'active':''}" data-sched-day="${i}">${d[0]}</button>`).join('')}</div>
    `;
  } else if(scheduleDraft.type==='biweekly'){
    const day = scheduleDraft.day ?? new Date().getDay();
    sub = `
      <div class="sched-sub-label">Which day?</div>
      <select id="schedBiweeklyDay" class="child-name-input">${DOW_ABBR.map((d,i)=>`<option value="${i}" ${day===i?'selected':''}>${d}</option>`).join('')}</select>
      <div class="sheet-sub" style="margin-top:8px;">Alternates every other week starting this week.</div>
    `;
  } else if(scheduleDraft.type==='monthly'){
    const week = scheduleDraft.week ?? 1;
    const day = scheduleDraft.day ?? new Date().getDay();
    sub = `
      <div class="sched-sub-label">Which week?</div>
      <select id="schedMonthlyWeek" class="child-name-input">${[1,2,3,4,-1].map(w=>`<option value="${w}" ${week===w?'selected':''}>${WEEK_ORDINAL[w]}</option>`).join('')}</select>
      <div class="sched-sub-label">Which day?</div>
      <select id="schedMonthlyDay" class="child-name-input">${DOW_ABBR.map((d,i)=>`<option value="${i}" ${day===i?'selected':''}>${d}</option>`).join('')}</select>
    `;
  } else if(scheduleDraft.type==='once'){
    sub = `<div class="sheet-sub" style="margin-top:8px;">Shows up until it's approved once, then disappears for good unless added again.</div>`;
  } else {
    sub = `<div class="sheet-sub" style="margin-top:8px;">Shows up every day.</div>`;
  }

  return typeRow + sub;
}

function wireScheduleEditor(){
  document.querySelectorAll('[data-sched-type]').forEach(b=>{
    b.onclick=()=>{
      const type = b.dataset.schedType;
      if(type==='weekly') scheduleDraft = {type, days: scheduleDraft.days || [new Date().getDay()]};
      else if(type==='biweekly') scheduleDraft = {type, day: scheduleDraft.day ?? new Date().getDay(), anchorMonday: dateKey(getMonday(new Date()))};
      else if(type==='monthly') scheduleDraft = {type, week: scheduleDraft.week ?? 1, day: scheduleDraft.day ?? new Date().getDay()};
      else scheduleDraft = {type};
      document.getElementById('schedulePickerBody').innerHTML = scheduleEditorHTML();
      wireScheduleEditor();
    };
  });
  document.querySelectorAll('[data-sched-day]').forEach(b=>{
    b.onclick=()=>{
      const day = parseInt(b.dataset.schedDay);
      const days = new Set(scheduleDraft.days||[]);
      if(days.has(day)) days.delete(day); else days.add(day);
      scheduleDraft.days = [...days];
      b.classList.toggle('active');
    };
  });
  const biweeklyDay = document.getElementById('schedBiweeklyDay');
  if(biweeklyDay) biweeklyDay.onchange=()=>{ scheduleDraft.day = parseInt(biweeklyDay.value); };
  const monthlyWeek = document.getElementById('schedMonthlyWeek');
  if(monthlyWeek) monthlyWeek.onchange=()=>{ scheduleDraft.week = parseInt(monthlyWeek.value); };
  const monthlyDay = document.getElementById('schedMonthlyDay');
  if(monthlyDay) monthlyDay.onchange=()=>{ scheduleDraft.day = parseInt(monthlyDay.value); };
}

async function saveSchedule(){
  const ctx = schedulePickerContext;
  if(!ctx) return;
  const sched = structuredClone(scheduleDraft);
  closeSchedulePicker();
  if(ctx.type==='newChore'){
    pendingChoreSchedule = sched;
    const btn = document.getElementById('newChoreScheduleBtn');
    if(btn) btn.textContent = `📅 ${scheduleSummaryText(sched)}`;
  } else if(ctx.type==='editChore'){
    if(!requireOnline()) return;
    const c = child.chores.find(x=>x.id===ctx.id);
    if(c){
      c.schedule = sched; render();
      try{ await sb.from('chores').update({schedule: sched}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
    }
  }
}

function parentSettingsHTML(){
  const tabs = `
    <div class="subtab-row">
      <button class="subtab-btn ${settingsTab==='profile'?'active':''}" data-stab="profile">Profile</button>
      <button class="subtab-btn ${settingsTab==='points'?'active':''}" data-stab="points">Points &amp; Time</button>
      <button class="subtab-btn ${settingsTab==='manual'?'active':''}" data-stab="manual">Manual Entries</button>
      <button class="subtab-btn ${settingsTab==='data'?'active':''}" data-stab="data">Data</button>
    </div>`;
  let body;
  if(settingsTab==='points') body = settingsPointsHTML();
  else if(settingsTab==='manual') body = settingsManualHTML();
  else if(settingsTab==='data') body = settingsDataHTML();
  else body = settingsProfileHTML();
  return tabs + body;
}

function settingsProfileHTML(){
  const rows = state.children.map(c=>`
    <div class="list-edit-item">
      <input class="settings-input label-edit" data-child-name="${c.id}" value="${c.name}">
      <button class="icon-btn-sm" data-child-del="${c.id}" ${state.children.length<=1?'disabled':''}>Remove</button>
    </div>
  `).join('');
  return `
    <div class="settings-label">Children</div>
    <div class="sheet-sub" style="margin-bottom:8px;">Switch between kids using the tabs at the top of Home.</div>
    ${rows}
    <div class="add-row" style="flex-wrap:wrap;">
      <input id="newChildName" class="child-name-input" placeholder="Add a child" style="flex:1; margin-top:10px;">
      <button class="btn btn-primary" id="addChildBtn" style="margin-top:10px;">Add Child</button>
    </div>

    <div class="settings-row" style="margin-top:22px;">
      <div class="settings-label">Change PIN</div>
    </div>
    <input class="child-name-input" id="newPinInput" placeholder="New 4-digit PIN" maxlength="4" inputmode="numeric">

    <button class="btn btn-primary" id="saveSettingsBtn" style="margin-top:18px;">Save PIN</button>
  `;
}

function settingsPointsHTML(){
  return `
    <div class="sheet-sub" style="margin-bottom:8px;">Adjusting <b>${child.name}</b>'s balance.</div>
    <div class="settings-row">
      <div class="settings-label">Points balance</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="icon-btn-sm" data-adjust="points:-10">−10</button>
        <b>${child.points}</b>
        <button class="icon-btn-sm" data-adjust="points:10">+10</button>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-label">Screen time (min)</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="icon-btn-sm" data-adjust="minutes:-5">−5</button>
        <b>${child.minutes}</b>
        <button class="icon-btn-sm" data-adjust="minutes:5">+5</button>
      </div>
    </div>
  `;
}

function settingsManualHTML(){
  if(manualEntryType==='school') return manualSchoolFormHTML();
  if(manualEntryType==='chore') return manualChoreFormHTML();
  if(manualEntryType==='prize') return manualPrizeFormHTML();
  return settingsManualMenuHTML();
}

function settingsManualMenuHTML(){
  return `
    <div class="sheet-sub" style="margin-bottom:12px;">Add something that already happened, dated in the past. These apply right away — no approval needed.</div>
    <div class="manual-grid">
      <button class="manual-tile mt-school" data-manual-open="school">
        <div class="manual-tile-ic">🎒</div>
        <div class="manual-tile-text">
          <div class="manual-tile-lbl">School Day</div>
          <div class="manual-tile-sub">Backfill a missed day</div>
        </div>
        <div class="manual-tile-chev">›</div>
      </button>
      <button class="manual-tile mt-chore" data-manual-open="chore">
        <div class="manual-tile-ic">✅</div>
        <div class="manual-tile-text">
          <div class="manual-tile-lbl">Chore</div>
          <div class="manual-tile-sub">Credit a past completion</div>
        </div>
        <div class="manual-tile-chev">›</div>
      </button>
      <button class="manual-tile mt-prize" data-manual-open="prize">
        <div class="manual-tile-ic">🎁</div>
        <div class="manual-tile-text">
          <div class="manual-tile-lbl">Redemption</div>
          <div class="manual-tile-sub">Log a past prize redemption</div>
        </div>
        <div class="manual-tile-chev">›</div>
      </button>
    </div>
  `;
}

function manualBackHTML(){
  return `<button class="icon-btn-sm" id="manualBackBtn" style="margin-bottom:16px;">‹ Back</button>`;
}

function manualSchoolFormHTML(){
  return `
    ${manualBackHTML()}
    <div class="settings-label" style="margin-bottom:4px;">Add a missed school day</div>
    <div class="sheet-sub" style="margin-bottom:8px;">For <b>${child.name}</b>. Counts toward that week's streak and can trigger the 5-day bonus.</div>
    <div class="add-row" style="flex-wrap:wrap;">
      <input type="date" id="missedSchoolDate" class="child-name-input" style="flex:1 1 100%;" max="${todayKey()}">
      <button class="btn btn-primary" id="addMissedSchoolBtn" style="margin-top:8px;">Add Missed Day</button>
    </div>
  `;
}

function manualChoreFormHTML(){
  const choreOptions = child.chores.map(c=>`<option value="${c.id}">${c.emoji} ${c.label} (+${c.points} pts)</option>`).join('');
  return `
    ${manualBackHTML()}
    <div class="settings-label" style="margin-bottom:4px;">Add a chore completion</div>
    <div class="sheet-sub" style="margin-bottom:8px;">For <b>${child.name}</b>. Credits points immediately — no approval needed.</div>
    ${child.chores.length===0 ? `<div class="sheet-sub">No chores set up yet.</div>` : `
    <div class="add-row" style="flex-wrap:wrap;">
      <select id="manualChoreSelect" class="child-name-input" style="flex:1 1 100%;">${choreOptions}</select>
      <input type="date" id="manualChoreDate" class="child-name-input" style="flex:1 1 100%; margin-top:8px;" max="${todayKey()}">
      <button class="btn btn-primary" id="addManualChoreBtn" style="margin-top:8px;">Add Chore Entry</button>
    </div>`}
  `;
}

function manualPrizeFormHTML(){
  const prizeOptions = child.prizes.map(p=>`<option value="${p.id}">${p.emoji} ${p.label} (−${p.cost} pts)</option>`).join('');
  return `
    ${manualBackHTML()}
    <div class="settings-label" style="margin-bottom:4px;">Add a prize redemption</div>
    <div class="sheet-sub" style="margin-bottom:8px;">For <b>${child.name}</b>. Deducts points immediately (won't go below 0).</div>
    ${child.prizes.length===0 ? `<div class="sheet-sub">No prizes set up yet.</div>` : `
    <div class="add-row" style="flex-wrap:wrap;">
      <select id="manualPrizeSelect" class="child-name-input" style="flex:1 1 100%;">${prizeOptions}</select>
      <input type="date" id="manualPrizeDate" class="child-name-input" style="flex:1 1 100%; margin-top:8px;" max="${todayKey()}">
      <button class="btn btn-primary" id="addManualPrizeBtn" style="margin-top:8px;">Add Redemption</button>
    </div>`}
  `;
}

function settingsDataHTML(){
  return `
    <div class="settings-label" style="margin-bottom:8px;">Danger Zone</div>
    <div class="sheet-sub" style="margin-bottom:12px;">This erases all of <b>${child.name}</b>'s points, minutes, and history. This can't be undone.</div>
    <button class="btn btn-deny" id="resetAllBtn">Reset ${child.name}'s Data</button>
  `;
}

function wireParentBody(){
  document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveEntry(b.dataset.approve));
  document.querySelectorAll('[data-deny]').forEach(b=>b.onclick=()=>denyEntry(b.dataset.deny));
  const bulkApproveBtn = document.getElementById('bulkApproveBtn');
  if(bulkApproveBtn) bulkApproveBtn.onclick=()=>bulkApproveAll();

  document.querySelectorAll('[data-chore-label]').forEach(inp=>{
    inp.onchange=async ()=>{
      const c = child.chores.find(x=>x.id===inp.dataset.choreLabel);
      if(!c) return;
      if(!requireOnline()){ inp.value = c.label; return; }
      const val = inp.value.trim();
      if(val){
        c.label = val; render();
        try{ await sb.from('chores').update({label:val}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
      } else { inp.value = c.label; }
    };
  });
  document.querySelectorAll('[data-chore-points]').forEach(inp=>{
    inp.onchange=async ()=>{
      const c = child.chores.find(x=>x.id===inp.dataset.chorePoints);
      if(!c || !requireOnline()) return;
      c.points = parseInt(inp.value)||0;
      try{ await sb.from('chores').update({points:c.points}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-chore-repeat]').forEach(inp=>{
    inp.onchange=async ()=>{
      const c = child.chores.find(x=>x.id===inp.dataset.choreRepeat);
      if(!c) return;
      if(!requireOnline()){ inp.checked = !inp.checked; return; }
      c.repeatable = inp.checked; render();
      try{ await sb.from('chores').update({repeatable:c.repeatable}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-chore-del]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      const id = b.dataset.choreDel;
      child.chores = child.chores.filter(c=>c.id!==id);
      renderParentBody(); render();
      try{ await sb.from('chores').delete().eq('id', id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-edit-chore-icon]').forEach(b=>{
    b.onclick=()=>openIconPicker({type:'editChore', id:b.dataset.editChoreIcon});
  });
  const newChoreIconBtn = document.getElementById('newChoreIconBtn');
  if(newChoreIconBtn) newChoreIconBtn.onclick=()=>openIconPicker({type:'newChore'});
  document.querySelectorAll('[data-edit-chore-schedule]').forEach(b=>{
    b.onclick=()=>openSchedulePicker({type:'editChore', id:b.dataset.editChoreSchedule});
  });
  const newChoreScheduleBtn = document.getElementById('newChoreScheduleBtn');
  if(newChoreScheduleBtn) newChoreScheduleBtn.onclick=()=>openSchedulePicker({type:'newChore'});
  const addChoreBtn = document.getElementById('addChoreBtn');
  if(addChoreBtn) addChoreBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    const label = document.getElementById('newChoreLabel').value.trim();
    const pts = parseInt(document.getElementById('newChorePoints').value)||0;
    const rep = document.getElementById('newChoreRepeat').checked;
    if(!label) return;
    const newChore = {id:uid(), label, emoji:pendingChoreIcon, points:pts, repeatable:rep, schedule:pendingChoreSchedule};
    child.chores.push(newChore);
    pendingChoreIcon = '⭐';
    pendingChoreSchedule = {type:'daily'};
    renderParentBody(); render();
    try{ await sb.from('chores').insert({id:newChore.id, child_id:child.id, label:newChore.label, emoji:newChore.emoji, points:newChore.points, repeatable:newChore.repeatable, schedule:newChore.schedule}).throwOnError(); }catch(err){ handleSyncError(err); }
  };

  document.querySelectorAll('[data-prize-label]').forEach(inp=>{
    inp.onchange=async ()=>{
      const p = child.prizes.find(x=>x.id===inp.dataset.prizeLabel);
      if(!p) return;
      if(!requireOnline()){ inp.value = p.label; return; }
      const val = inp.value.trim();
      if(val){
        p.label = val; render();
        try{ await sb.from('prizes').update({label:val}).eq('id', p.id).throwOnError(); }catch(err){ handleSyncError(err); }
      } else { inp.value = p.label; }
    };
  });
  document.querySelectorAll('[data-prize-minutes]').forEach(inp=>{
    inp.onchange=async ()=>{
      const p = child.prizes.find(x=>x.id===inp.dataset.prizeMinutes);
      if(!p || !requireOnline()) return;
      const mins = parseInt(inp.value);
      p.grantsMinutes = mins > 0 ? mins : undefined;
      try{ await sb.from('prizes').update({grants_minutes: mins > 0 ? mins : null}).eq('id', p.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-prize-cost]').forEach(inp=>{
    inp.onchange=async ()=>{
      const p = child.prizes.find(x=>x.id===inp.dataset.prizeCost);
      if(!p || !requireOnline()) return;
      p.cost = parseInt(inp.value)||0;
      try{ await sb.from('prizes').update({cost:p.cost}).eq('id', p.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-prize-del]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      const id = b.dataset.prizeDel;
      child.prizes = child.prizes.filter(p=>p.id!==id);
      renderParentBody(); render();
      try{ await sb.from('prizes').delete().eq('id', id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-edit-prize-icon]').forEach(b=>{
    b.onclick=()=>openIconPicker({type:'editPrize', id:b.dataset.editPrizeIcon});
  });
  const newPrizeIconBtn = document.getElementById('newPrizeIconBtn');
  if(newPrizeIconBtn) newPrizeIconBtn.onclick=()=>openIconPicker({type:'newPrize'});
  const addPrizeBtn = document.getElementById('addPrizeBtn');
  if(addPrizeBtn) addPrizeBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    const label = document.getElementById('newPrizeLabel').value.trim();
    const cost = parseInt(document.getElementById('newPrizeCost').value)||0;
    const mins = parseInt(document.getElementById('newPrizeMinutes').value)||0;
    if(!label) return;
    const newPrize = {id:uid(), label, emoji:pendingPrizeIcon, cost, grantsMinutes:mins||undefined};
    child.prizes.push(newPrize);
    pendingPrizeIcon = '🎁';
    renderParentBody(); render();
    try{ await sb.from('prizes').insert({id:newPrize.id, child_id:child.id, label:newPrize.label, emoji:newPrize.emoji, cost:newPrize.cost, grants_minutes:newPrize.grantsMinutes||null}).throwOnError(); }catch(err){ handleSyncError(err); }
  };

  document.querySelectorAll('[data-adjust]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      const [field, delta] = b.dataset.adjust.split(':');
      child[field] = Math.max(0, child[field] + parseInt(delta));
      renderParentBody(); render();
      try{ await sb.from('children').update({[field]: child[field]}).eq('id', child.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });

  document.querySelectorAll('[data-stab]').forEach(b=>{
    b.onclick=()=>{ settingsTab = b.dataset.stab; manualEntryType = null; renderParentBody(); };
  });
  document.querySelectorAll('[data-manual-open]').forEach(b=>{
    b.onclick=()=>{ manualEntryType = b.dataset.manualOpen; renderParentBody(); };
  });
  const manualBackBtn = document.getElementById('manualBackBtn');
  if(manualBackBtn) manualBackBtn.onclick=()=>{ manualEntryType = null; renderParentBody(); };

  const addMissedSchoolBtn = document.getElementById('addMissedSchoolBtn');
  if(addMissedSchoolBtn) addMissedSchoolBtn.onclick=()=>{
    addPastSchoolDay(document.getElementById('missedSchoolDate').value);
  };
  const addManualChoreBtn = document.getElementById('addManualChoreBtn');
  if(addManualChoreBtn) addManualChoreBtn.onclick=()=>{
    addPastChore(document.getElementById('manualChoreSelect').value, document.getElementById('manualChoreDate').value);
  };
  const addManualPrizeBtn = document.getElementById('addManualPrizeBtn');
  if(addManualPrizeBtn) addManualPrizeBtn.onclick=()=>{
    addPastPrizeRedemption(document.getElementById('manualPrizeSelect').value, document.getElementById('manualPrizeDate').value);
  };

  document.querySelectorAll('[data-child-name]').forEach(inp=>{
    inp.onchange=async ()=>{
      const c = state.children.find(x=>x.id===inp.dataset.childName);
      if(!c) return;
      if(!requireOnline()){ inp.value = c.name; return; }
      const val = inp.value.trim();
      if(val){
        c.name = val; render();
        try{ await sb.from('children').update({name:val}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
      } else { inp.value = c.name; }
    };
  });
  document.querySelectorAll('[data-child-del]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      if(state.children.length<=1) return;
      const c = state.children.find(x=>x.id===b.dataset.childDel);
      if(!c) return;
      if(confirm(`Remove ${c.name} and all of their history? This can't be undone.`)){
        state.children = state.children.filter(x=>x.id!==c.id);
        if(state.activeChildId===c.id){
          state.activeChildId = state.children[0].id;
          child = state.children[0];
          localStorage.setItem(ACTIVE_CHILD_KEY, child.id);
        }
        renderParentBody(); render();
        try{ await sb.from('children').delete().eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
      }
    };
  });
  const addChildBtn = document.getElementById('addChildBtn');
  if(addChildBtn) addChildBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    const name = document.getElementById('newChildName').value.trim();
    if(!name) return;
    const newChild = makeChild(uid(), name);
    state.children.push(newChild);
    state.activeChildId = newChild.id;
    child = newChild;
    localStorage.setItem(ACTIVE_CHILD_KEY, child.id);
    renderParentBody(); render();
    try{ await insertChildFull(newChild); }catch(err){ handleSyncError(err); }
  };

  const saveBtn = document.getElementById('saveSettingsBtn');
  if(saveBtn) saveBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    const newPin = document.getElementById('newPinInput').value.trim();
    if(newPin.length===4 && /^\d{4}$/.test(newPin)){
      state.pin = newPin;
      toast('PIN updated ✅');
      try{ await sb.from('family_settings').update({pin:newPin}).eq('user_id', authUserId).throwOnError(); }catch(err){ handleSyncError(err); }
    } else {
      toast('Enter a 4-digit PIN');
    }
  };
  const resetBtn = document.getElementById('resetAllBtn');
  if(resetBtn) resetBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    if(confirm(`This will erase all of ${child.name}'s points, minutes, and history. Are you sure?`)){
      const idx = state.children.findIndex(c=>c.id===child.id);
      const fresh = makeChild(child.id, child.name);
      state.children[idx] = fresh;
      child = fresh;
      ensureWeek(child);
      closeParent(); render();
      try{
        await sb.from('entries').delete().eq('child_id', fresh.id).throwOnError();
        await sb.from('chores').delete().eq('child_id', fresh.id).throwOnError();
        await sb.from('prizes').delete().eq('child_id', fresh.id).throwOnError();
        await sb.from('children').update({points:0, minutes:0, week_start: fresh.weekStart}).eq('id', fresh.id).throwOnError();
        await sb.from('chores').insert(fresh.chores.map(c=>({id:c.id, child_id:fresh.id, label:c.label, emoji:c.emoji, points:c.points, repeatable:c.repeatable, schedule:c.schedule||null}))).throwOnError();
        await sb.from('prizes').insert(fresh.prizes.map(p=>({id:p.id, child_id:fresh.id, label:p.label, emoji:p.emoji, cost:p.cost, grants_minutes:p.grantsMinutes||null}))).throwOnError();
      }catch(err){ handleSyncError(err); }
    }
  };
}

/* ============ RENDER: main views ============ */
function render(){
  ensureWeek(child);
  document.getElementById('greetingName').textContent = `Hey, ${child.name}! 👋`;
  document.getElementById('dateLine').textContent = new Date().toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'});
  document.getElementById('pointsVal').textContent = child.points;
  document.getElementById('minutesVal').textContent = child.minutes;

  const pct = Math.max(6, (child.points % 1000)/1000*100);
  document.getElementById('pointsWater').style.height = pct+'%';
  refreshFishTank();

  const pend = pendingEntries().length;
  const badge = document.getElementById('pendingBadge');
  if(pend>0){ badge.style.display='block'; badge.textContent=pend; } else { badge.style.display='none'; }

  renderChildSwitcher();

  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===view));

  const el = document.getElementById('mainContent');
  if(view==='home') el.innerHTML = homeHTML();
  else if(view==='prizes') el.innerHTML = prizesHTML();
  else el.innerHTML = historyHTML();
  wireMainContent();
  updateOfflineBanner();

  if(document.getElementById('parentOverlay').classList.contains('show')){
    renderParentBody();
  }
}

function renderChildSwitcher(){
  const row = document.getElementById('childSwitchRow');
  if(!row) return;
  if(state.children.length<=1){ row.style.display='none'; row.innerHTML=''; return; }
  row.style.display='flex';
  row.innerHTML = state.children.map(c=>
    `<button class="child-pill ${c.id===child.id?'active':''}" data-switch-child="${c.id}">${c.name}</button>`
  ).join('');
  row.querySelectorAll('[data-switch-child]').forEach(b=>{
    b.onclick=()=>switchChild(b.dataset.switchChild);
  });
}

function homeHTML(){
  const schoolToday = entriesToday(child, 'school')[0];
  const schoolStatus = schoolToday ? schoolToday.status : null;
  const goodDays = goodDaysThisWeekApproved(child);
  const streakDots = Array.from({length:5}).map((_,i)=>`<div class="streak-dot ${i<goodDays?'filled':''}"></div>`).join('');

  const choreCards = child.chores.filter(isChoreVisibleToday).map(c=>{
    const todays = entriesToday(child, 'chore', c.id);
    const approvedCount = todays.filter(e=>e.status==='approved').length;
    const pendingCount = todays.filter(e=>e.status==='pending').length;
    let cls='chore-card', statusHTML='';
    if(!c.repeatable){
      if(approvedCount>0){ cls+=' done'; statusHTML='<div class="chore-status done">Done ✓</div>'; }
      else if(pendingCount>0){ cls+=' pending'; statusHTML='<div class="chore-status pending">Waiting</div>'; }
    } else if(approvedCount+pendingCount>0){
      statusHTML = `<div class="chore-count">${approvedCount+pendingCount}x today</div>`;
    }
    return `
      <button class="${cls}" data-chore="${c.id}">
        ${statusHTML}
        <div class="chore-emoji">${c.emoji}</div>
        <div class="chore-label">${c.label}</div>
        <div class="chore-points">+${c.points} pts</div>
      </button>`;
  }).join('');

  return `
    <div class="section-title">Today at School <span class="tag">${goodDays}/5 this week</span></div>
    <div class="school-card ${schoolStatus||''}">
      <div class="school-emoji">🎒</div>
      <div class="school-text">
        <div class="school-title">Good Day at School</div>
        <div class="school-sub">${schoolStatus==='approved' ? '15 min added!' : schoolStatus==='pending' ? 'Waiting for approval...' : 'Tap when you had a good day'}</div>
      </div>
      <button class="school-btn ${schoolStatus||''}" id="schoolBtn" ${schoolStatus?'disabled':''}>
        ${schoolStatus==='approved' ? '✓' : schoolStatus==='pending' ? '⏳' : '+'}
      </button>
    </div>
    <div class="streak-row">${streakDots}</div>

    <div class="section-title">Today's Chores</div>
    <div class="grid">${choreCards}</div>
  `;
}

function prizesHTML(){
  if(child.prizes.length===0){
    return `<div class="empty-state"><div class="e">🎁</div>No prizes set up yet.</div>`;
  }
  const cards = child.prizes.map(p=>{
    const pending = child.entries.some(e=>e.kind==='redeem' && e.refId===p.id && e.status==='pending');
    const affordable = child.points >= p.cost;
    return `
    <div class="prize-card ${pending?'requested':''}">
      <div class="prize-emoji">${p.emoji}</div>
      <div class="prize-info">
        <div class="prize-title">${p.label}</div>
        <div class="prize-cost">${p.cost} pts${p.grantsMinutes?` · +${p.grantsMinutes} min`:''}</div>
      </div>
      <button class="prize-btn ${pending?'requested':''}" data-prize="${p.id}" ${(!affordable && !pending)?'disabled':''}>
        ${pending ? 'Waiting…' : affordable ? 'Redeem' : 'Need more'}
      </button>
    </div>`;
  }).join('');
  return `<div class="prize-list">${cards}</div>`;
}

function historyItemRowHTML(e){
  let amtClass='wait', amtText='';
  const cur = e.currency==='points'?'pts':'min';
  const sign = e.kind==='redeem' ? '−' : '+';
  if(e.status==='approved'){ amtClass = e.kind==='redeem'?'neg':'pos'; amtText=`${sign}${e.amount} ${cur}`; }
  else if(e.status==='pending'){ amtClass='wait'; amtText=`${sign}${e.amount} ${cur} · pending`; }
  else { amtClass='deny'; amtText=`${sign}${e.amount} ${cur} · denied`; }
  return `
  <div class="history-item">
    <div class="history-emoji">${e.emoji}</div>
    <div class="history-info">
      <div class="history-label">${e.label}</div>
      <div class="history-meta">${timeAgo(e.ts)}</div>
    </div>
    <div class="history-amount ${amtClass}">${amtText}</div>
  </div>`;
}

function historyHTML(){
  const tabs = `
    <div class="tab-row">
      <button class="tab-btn ${historyMode==='week'?'active':''}" data-hmode="week">Week</button>
      <button class="tab-btn ${historyMode==='month'?'active':''}" data-hmode="month">Month</button>
    </div>`;
  return tabs + (historyMode==='week' ? weekViewHTML() : monthViewHTML());
}

function weekViewHTML(){
  const monday = getMonday(addDays(new Date(), historyWeekOffset*7));
  const sunday = addDays(monday, 6);
  const label = `${monday.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${sunday.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
  const rows = Array.from({length:7}).map((_,i)=>dayRowHTML(addDays(monday,i))).join('');
  return `
    <div class="cal-nav">
      <button class="cal-nav-btn" data-week-nav="-1">‹</button>
      <div class="cal-nav-label">${label}${historyWeekOffset===0?' <span class="tag">This week</span>':''}</div>
      <button class="cal-nav-btn" data-week-nav="1">›</button>
    </div>
    <div class="week-list">${rows}</div>
  `;
}

function dayRowHTML(d){
  const dk = dateKey(d);
  const entries = entriesForDay(child, dk);
  const isToday = dk===todayKey();
  const chips = entries.map(e=>{
    const sign = e.kind==='redeem' ? '−' : '+';
    const cur = e.currency==='points' ? 'pts' : 'min';
    let cls = 'chip-wait';
    if(e.status==='approved') cls = e.kind==='redeem' ? 'chip-neg' : 'chip-pos';
    else if(e.status==='denied') cls = 'chip-deny';
    return `<span class="day-chip ${cls}">${e.emoji}<b>${sign}${e.amount} ${cur}</b></span>`;
  }).join('');
  return `
    <button class="day-row ${isToday?'today':''}" data-day="${dk}">
      <div class="day-row-date">
        <div class="day-row-dow">${d.toLocaleDateString(undefined,{weekday:'short'})}</div>
        <div class="day-row-num">${d.getDate()}</div>
      </div>
      <div class="day-row-chips">${chips || '<span class="day-row-empty">Nothing yet</span>'}</div>
    </button>
  `;
}

function monthViewHTML(){
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth()+historyMonthOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const label = base.toLocaleDateString(undefined,{month:'long', year:'numeric'});
  const firstDow = new Date(y, m, 1).getDay();
  const numDays = daysInMonthCount(y, m);

  const cells = [];
  for(let i=0;i<firstDow;i++) cells.push(null);
  for(let d=1; d<=numDays; d++) cells.push(new Date(y, m, d));
  while(cells.length % 7 !== 0) cells.push(null);

  const dowHeader = ['S','M','T','W','T','F','S'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
  const cellsHTML = cells.map(d=>{
    if(!d) return `<div class="cal-cell empty"></div>`;
    const dk = dateKey(d);
    const approved = entriesForDay(child, dk).filter(e=>e.status==='approved');
    let earnedPts=0, redeemedPts=0;
    approved.forEach(e=>{
      if(e.kind==='redeem') redeemedPts += e.amount;
      else if(e.currency==='points') earnedPts += e.amount;
    });
    const isToday = dk===todayKey();
    const hasActivity = earnedPts>0 || redeemedPts>0;
    return `
      <button class="cal-cell ${isToday?'today':''} ${hasActivity?'has-activity':''}" data-day="${dk}">
        <div class="cal-cell-num">${d.getDate()}</div>
        ${earnedPts>0?`<div class="cal-cell-amt pos">+${earnedPts}</div>`:''}
        ${redeemedPts>0?`<div class="cal-cell-amt neg">−${redeemedPts}</div>`:''}
      </button>`;
  }).join('');

  return `
    <div class="cal-nav">
      <button class="cal-nav-btn" data-month-nav="-1">‹</button>
      <div class="cal-nav-label">${label}</div>
      <button class="cal-nav-btn" data-month-nav="1">›</button>
    </div>
    <div class="cal-grid cal-dow-row">${dowHeader}</div>
    <div class="cal-grid">${cellsHTML}</div>
  `;
}

function dayDetailHTML(dk){
  const entries = entriesForDay(child, dk);
  if(entries.length===0){
    return `<div class="empty-state"><div class="e">📭</div>Nothing this day.</div>`;
  }
  return entries.map(historyItemRowHTML).join('');
}

function openDay(dk){
  document.getElementById('dayTitle').textContent = new Date(dk+'T00:00:00').toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'});
  document.getElementById('dayBody').innerHTML = dayDetailHTML(dk);
  document.getElementById('dayOverlay').classList.add('show');
}
function closeDay(){
  document.getElementById('dayOverlay').classList.remove('show');
}

function wireMainContent(){
  document.querySelectorAll('[data-chore]').forEach(b=>{
    b.onclick=(ev)=>requestChore(b.dataset.chore, ev);
  });
  const schoolBtn = document.getElementById('schoolBtn');
  if(schoolBtn) schoolBtn.onclick=(ev)=>requestSchoolDay(ev);
  document.querySelectorAll('[data-prize]').forEach(b=>{
    b.onclick=(ev)=>requestPrize(b.dataset.prize, ev);
  });

  document.querySelectorAll('[data-hmode]').forEach(b=>{
    b.onclick=()=>{ historyMode = b.dataset.hmode; render(); };
  });
  document.querySelectorAll('[data-week-nav]').forEach(b=>{
    b.onclick=()=>{ historyWeekOffset += parseInt(b.dataset.weekNav); render(); };
  });
  document.querySelectorAll('[data-month-nav]').forEach(b=>{
    b.onclick=()=>{ historyMonthOffset += parseInt(b.dataset.monthNav); render(); };
  });
  document.querySelectorAll('[data-day]').forEach(b=>{
    b.onclick=()=>openDay(b.dataset.day);
  });
}

/* ============ FISH TANK DECOR ============ */
let fishSpawned=false;
function refreshFishTank(){
  const meter = document.getElementById('pointsMeter');
  if(fishSpawned) return;
  fishSpawned=true;
  const water = document.getElementById('pointsWater');
  for(let i=0;i<2;i++){
    const fish = document.createElement('div');
    fish.className='fish-icon';
    fish.textContent = FISH_EMOJIS[i%FISH_EMOJIS.length];
    fish.style.fontSize = (10+i*2)+'px';
    fish.style.left = (20+i*40)+'%';
    fish.style.bottom = (8+i*10)+'px';
    fish.style.animationDelay = (i*1.4)+'s';
    water.appendChild(fish);
  }
  for(let i=0;i<3;i++){
    const b = document.createElement('div');
    b.className='bubble';
    b.style.left = (15+i*28)+'%';
    b.style.animationDelay = (i*1.1)+'s';
    water.appendChild(b);
  }
}

/* ============ FEEDBACK FX ============ */
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove('show'), 2200);
}

function spawnFloaterAt(evt, text, color){
  const layer = document.getElementById('floaters');
  const f = document.createElement('div');
  f.className='floater';
  f.textContent = text;
  f.style.color = color || 'var(--success)';
  let x = window.innerWidth/2, y = window.innerHeight/2;
  if(evt && evt.currentTarget){
    const r = evt.currentTarget.getBoundingClientRect();
    x = r.left + r.width/2; y = r.top;
  }
  f.style.left = x+'px'; f.style.top = y+'px'; f.style.transform='translateX(-50%)';
  layer.appendChild(f);
  setTimeout(()=>f.remove(), 1200);
}

function burstConfetti(){
  const layer = document.getElementById('floaters');
  const colors = ['#FF6B4A','#17A398','#FFB627','#34C759','#5FCBBF'];
  const cx = window.innerWidth/2;
  for(let i=0;i<18;i++){
    const c = document.createElement('div');
    c.className='confetti';
    c.style.background = colors[i%colors.length];
    c.style.left = (cx + (Math.random()*220-110))+'px';
    c.style.top = '90px';
    c.style.animationDelay = (Math.random()*0.2)+'s';
    c.style.borderRadius = Math.random()>0.5 ? '50%':'2px';
    layer.appendChild(c);
    setTimeout(()=>c.remove(), 1600);
  }
}

function timeAgo(ts){
  const diff = Date.now()-ts;
  const mins = Math.floor(diff/60000);
  if(mins<1) return 'Just now';
  if(mins<60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  if(hrs<24) return `${hrs}h ago`;
  const days = Math.floor(hrs/24);
  if(days<7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined,{month:'short', day:'numeric'});
}

/* ============ BOOT / AUTH ============ */
async function afterAuth(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('loadingScreen').style.display='flex';
  document.getElementById('loadingSub').textContent = 'Syncing…';
  try{
    const { data: { user } } = await sb.auth.getUser();
    authUserId = user.id;
    const cloud = await fetchCloudState();
    const savedActiveId = localStorage.getItem(ACTIVE_CHILD_KEY);
    state = { pin: cloud.pin, activeChildId: savedActiveId, children: cloud.children };
    if(!state.activeChildId || !state.children.find(c=>c.id===state.activeChildId)){
      state.activeChildId = state.children[0].id;
    }
    child = state.children.find(c=>c.id===state.activeChildId);
    localStorage.setItem(ACTIVE_CHILD_KEY, child.id);

    document.getElementById('loadingScreen').style.display='none';
    connectionOk = true;
    buildPinPad();
    ensureWeek(child);
    render();
    scheduleMidnightRefresh();
    subscribeRealtime();
  }catch(err){
    console.error('boot error', err);
    document.getElementById('loadingSub').textContent = 'Connection problem — retrying…';
    setTimeout(afterAuth, 3000);
  }
}

async function boot(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session){
    document.getElementById('loadingScreen').style.display='none';
    document.getElementById('loginScreen').style.display='flex';
    return;
  }
  await afterAuth();
}

document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if(!email || !password){ errEl.textContent = 'Enter email and password'; return; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error){ errEl.textContent = error.message; return; }
  await afterAuth();
});

/* ============ INIT / NAV WIRING ============ */
document.querySelectorAll('.nav-btn').forEach(b=>{
  b.addEventListener('click', ()=>{ view=b.dataset.view; fishSpawned = fishSpawned; render(); });
});
document.getElementById('lockBtn').addEventListener('click', ()=>openPin('unlock'));
document.getElementById('pinCancel').addEventListener('click', closePin);
document.getElementById('parentClose').addEventListener('click', closeParent);
document.querySelectorAll('[data-ptab]').forEach(b=>{
  b.addEventListener('click', ()=>{
    activeParentTab = b.dataset.ptab;
    document.querySelectorAll('[data-ptab]').forEach(x=>x.classList.toggle('active', x===b));
    renderParentBody();
  });
});
document.getElementById('pinOverlay').addEventListener('click', (e)=>{ if(e.target.id==='pinOverlay') closePin(); });
document.getElementById('parentOverlay').addEventListener('click', (e)=>{ if(e.target.id==='parentOverlay') closeParent(); });
document.getElementById('dayClose').addEventListener('click', closeDay);
document.getElementById('dayOverlay').addEventListener('click', (e)=>{ if(e.target.id==='dayOverlay') closeDay(); });
document.getElementById('iconClose').addEventListener('click', closeIconPicker);
document.getElementById('iconOverlay').addEventListener('click', (e)=>{ if(e.target.id==='iconOverlay') closeIconPicker(); });
document.getElementById('scheduleClose').addEventListener('click', closeSchedulePicker);
document.getElementById('scheduleOverlay').addEventListener('click', (e)=>{ if(e.target.id==='scheduleOverlay') closeSchedulePicker(); });
document.getElementById('scheduleSaveBtn').addEventListener('click', saveSchedule);
document.getElementById('undoToastBtn').addEventListener('click', performUndo);

let view = 'home';
let pinContext = null;   // 'unlock' -> opens parent overlay
let pinBuffer = '';
let activeParentTab = 'approve';
let historyMode = 'week';     // 'week' | 'month'
let historyWeekOffset = 0;    // 0 = this week, -1 = last week, ...
let historyMonthOffset = 0;   // 0 = this month, -1 = last month, ...
let pendingChoreIcon = '⭐';
let pendingPrizeIcon = '🎁';
let pendingChoreSchedule = {type:'daily'};
let iconPickerContext = null; // {type:'newChore'|'newPrize'|'editChore'|'editPrize', id?}
let schedulePickerContext = null; // {type:'newChore'|'editChore', id?}
let scheduleDraft = {type:'daily'};
let settingsTab = 'profile'; // 'profile' | 'points' | 'manual' | 'data'
let manualEntryType = null; // null | 'school' | 'chore' | 'prize'

boot();

/* register service worker */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

/* shake keyframes injected (used by pin dots on wrong entry) */
const styleTag = document.createElement('style');
styleTag.textContent = `@keyframes shake{ 10%,90%{transform:translateX(-2px);} 20%,80%{transform:translateX(4px);} 30%,50%,70%{transform:translateX(-8px);} 40%,60%{transform:translateX(8px);} }`;
document.head.appendChild(styleTag);
