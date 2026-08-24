/* ============ POINTPAL — app logic ============ */

const EMOJI_INPUT_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

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

const AVATAR_SET = [
  '🦖','🦕',
  '🚧','🚜','🏗️','🚛','🚚','⚙️','🔧','🔨','🛠️',
  '🦥',
  '🚀','🪐','🌌','👽','🛸','🌙','☄️','🌠','⭐',
  '🧪','🔬','🧬','⚗️','🧫','🔭',
  '🥷','⚔️','🌀','💨',
  '🦸','🦸‍♂️','🦸‍♀️','🛡️','⚡','💥',
  '👾','🎮','🐉'
];

const DEFAULT_CHORES = [
  { id:'dishes',   label:'Dishes',             emoji:'🍽️', amount:5,  currency:'points', repeatable:false },
  { id:'brush',    label:'Brush Teeth',        emoji:'🪥', amount:5,  currency:'points', repeatable:false },
  { id:'wipe',     label:'Wipe Butt',          emoji:'🧻', amount:5,  currency:'points', repeatable:true  },
  { id:'shower',   label:'Shower',             emoji:'🚿', amount:10, currency:'points', repeatable:false },
  { id:'dressed',  label:'Get Up & Dressed',   emoji:'👕', amount:10, currency:'points', repeatable:false },
  { id:'worksheet',label:'Worksheet',          emoji:'📝', amount:1,  currency:'points', repeatable:true  },
  { id:'school',   label:'Good Day at School', emoji:'🎒', amount:15, currency:'minutes',repeatable:false },
];
const DEFAULT_CHALLENGES = [
  { id:'default-school', choreId:'school', label:'Good Day at School Streak', target:5, bonus:120, currency:'minutes', type:'recurring' }
];
const DEFAULT_PRIZES = [
  { id:'p5min',    label:'5 Minutes Electronics',   emoji:'⏱️', cost:20, grantsMinutes:5 },
  { id:'treat',    label:'Extra Treat or Dessert',  emoji:'🍪', cost:100 },
  { id:'icecream', label:'Go Out for Ice Cream',    emoji:'🍦', cost:250 },
  { id:'toy',      label:'$5–$10 Toy',              emoji:'🧸', cost:250 },
  { id:'outing',   label:'Fun Outing',              emoji:'🎡', cost:500 },
  { id:'fish',     label:'Fish',                    emoji:'🐠', cost:1000 },
];

function makeChild(id, name){
  // DEFAULT_CHORES/PRIZES/CHALLENGES use fixed literal ids ('dishes', 'school', ...) as
  // human-readable source data, but those ids are primary keys in Supabase — reusing them
  // for every child would collide the moment a second child is inserted. Mint fresh ids here.
  const chores = structuredClone(DEFAULT_CHORES);
  const prizes = structuredClone(DEFAULT_PRIZES);
  const challenges = structuredClone(DEFAULT_CHALLENGES);
  const choreIdMap = {};
  chores.forEach(c=>{ const newId = uid(); choreIdMap[c.id] = newId; c.id = newId; });
  prizes.forEach(p=>{ p.id = uid(); });
  challenges.forEach(ch=>{ ch.id = uid(); ch.choreId = choreIdMap[ch.choreId] || ch.choreId; });
  return {
    id, name,
    avatar: AVATAR_SET[0],
    pin: (state && state.pin) || '1234',
    points: 0,
    minutes: 0,
    weekStart: null,          // ISO date (Monday) this week's streak is counted against
    goalPrizeId: null,        // prize the child has pinned as their savings goal
    chores,
    prizes,
    challenges,
    punishments: [],            // {id, label, blockPoints, blockMinutes, blockPrizes, endsAt}
    entries: [],                // {id, ts, kind:'chore'|'bonus'|'redeem', refId, label, emoji, currency:'points'|'minutes', amount, status:'pending'|'approved'|'denied'}
    notifications: []           // {id, kind:'celebration'|'message', label, emoji, amount, currency, message, ts} — queued Pip moments, delivered next time this child's session becomes active
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
  deliverPendingNotifications();
}

function bySortOrder(a, b){
  const ao = a.sortOrder==null ? Infinity : a.sortOrder;
  const bo = b.sortOrder==null ? Infinity : b.sortOrder;
  if(ao!==bo) return ao-bo;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function nextSortOrder(list){
  return 1 + list.reduce((max,x)=>Math.max(max, x.sortOrder==null?-1:x.sortOrder), -1);
}

/* ---------- row <-> app shape converters ---------- */
function toEntryRow(entry, childId){
  return {
    id: entry.id, child_id: childId, ts: entry.ts, kind: entry.kind, ref_id: entry.refId || null,
    label: entry.label, emoji: entry.emoji, currency: entry.currency, amount: entry.amount,
    status: entry.status, fulfilled: entry.fulfilled || false, minutes_used: entry.minutesUsed || 0,
    grants_minutes: entry.grantsMinutes || 0
  };
}
function toNotificationRow(n, childId){
  return {
    id: n.id, child_id: childId, kind: n.kind, label: n.label || null, emoji: n.emoji || null,
    amount: n.amount==null ? null : n.amount, currency: n.currency || null, message: n.message || null, ts: n.ts
  };
}
function rowsToChild(childRow, chores, prizes, challenges, punishments, entries, notifications){
  return {
    id: childRow.id,
    name: childRow.name,
    avatar: childRow.avatar || AVATAR_SET[0],
    pin: childRow.pin || null,
    points: childRow.points,
    minutes: childRow.minutes,
    weekStart: childRow.week_start,
    goalPrizeId: childRow.goal_prize_id || null,
    chores: chores.filter(c=>c.child_id===childRow.id).map(c=>({id:c.id, label:c.label, emoji:c.emoji, amount:c.amount, currency:c.currency, repeatable:c.repeatable, schedule:c.schedule||undefined, sortOrder:c.sort_order==null?null:Number(c.sort_order)})).sort(bySortOrder),
    prizes: prizes.filter(p=>p.child_id===childRow.id).map(p=>({id:p.id, label:p.label, emoji:p.emoji, cost:p.cost, grantsMinutes:p.grants_minutes||undefined, limitMax:p.limit_max||undefined, limitPeriod:p.limit_period||undefined, sortOrder:p.sort_order==null?null:Number(p.sort_order)})).sort(bySortOrder),
    challenges: challenges.filter(ch=>ch.child_id===childRow.id).map(ch=>({id:ch.id, choreId:ch.chore_id, label:ch.label, target:ch.target, bonus:ch.bonus, currency:ch.currency, type:ch.type, startDate:ch.start_date||undefined, endDate:ch.end_date||undefined})),
    punishments: punishments.filter(p=>p.child_id===childRow.id).map(p=>({id:p.id, label:p.label, blockPoints:p.block_points, blockMinutes:p.block_minutes, blockPrizes:p.block_prizes, endsAt:Number(p.ends_at)})),
    notifications: (notifications||[]).filter(n=>n.child_id===childRow.id).map(n=>({id:n.id, kind:n.kind, label:n.label, emoji:n.emoji, amount:n.amount, currency:n.currency, message:n.message, ts:Number(n.ts)})).sort((a,b)=>a.ts-b.ts),
    entries: entries.filter(e=>e.child_id===childRow.id).map(e=>({id:e.id, ts:Number(e.ts), kind:e.kind, refId:e.ref_id, label:e.label, emoji:e.emoji, currency:e.currency, amount:e.amount, status:e.status, fulfilled:!!e.fulfilled, minutesUsed:Number(e.minutes_used)||0, grantsMinutes:Number(e.grants_minutes)||0}))
  };
}
async function insertChildFull(c){
  await sb.from('children').insert({id:c.id, name:c.name, avatar:c.avatar, pin:c.pin, points:c.points, minutes:c.minutes, week_start:c.weekStart}).throwOnError();
  if(c.chores.length) await sb.from('chores').insert(c.chores.map((ch,i)=>({id:ch.id, child_id:c.id, label:ch.label, emoji:ch.emoji, amount:ch.amount, currency:ch.currency, repeatable:ch.repeatable, schedule:ch.schedule||null, sort_order:i}))).throwOnError();
  if(c.prizes.length) await sb.from('prizes').insert(c.prizes.map((p,i)=>({id:p.id, child_id:c.id, label:p.label, emoji:p.emoji, cost:p.cost, grants_minutes:p.grantsMinutes||null, limit_max:p.limitMax||null, limit_period:p.limitPeriod||null, sort_order:i}))).throwOnError();
  if(c.challenges.length) await sb.from('challenges').insert(c.challenges.map(ch=>({id:ch.id, child_id:c.id, chore_id:ch.choreId, label:ch.label, target:ch.target, bonus:ch.bonus, currency:ch.currency, type:ch.type, start_date:ch.startDate||null, end_date:ch.endDate||null}))).throwOnError();
  if(c.punishments.length) await sb.from('punishments').insert(c.punishments.map(p=>({id:p.id, child_id:c.id, label:p.label, block_points:p.blockPoints, block_minutes:p.blockMinutes, block_prizes:p.blockPrizes, ends_at:p.endsAt}))).throwOnError();
}

async function fetchCloudState(){
  const [childrenRes, choresRes, prizesRes, challengesRes, punishmentsRes, entriesRes, notificationsRes, settingsRes] = await Promise.all([
    sb.from('children').select('*').order('created_at'),
    sb.from('chores').select('*'),
    sb.from('prizes').select('*'),
    sb.from('challenges').select('*'),
    sb.from('punishments').select('*'),
    sb.from('entries').select('*'),
    sb.from('notifications').select('*'),
    sb.from('family_settings').select('*').maybeSingle()
  ]);
  const firstError = childrenRes.error || choresRes.error || prizesRes.error || challengesRes.error || punishmentsRes.error || entriesRes.error || notificationsRes.error || settingsRes.error;
  if(firstError) throw firstError;

  let childRows = childrenRes.data;
  let choreRows = choresRes.data, prizeRows = prizesRes.data, challengeRows = challengesRes.data, punishmentRows = punishmentsRes.data;
  if(childRows.length===0){
    const fresh = makeChild(uid(), 'Champ');
    await insertChildFull(fresh);
    childRows = [{id:fresh.id, name:fresh.name, points:0, minutes:0, week_start:null}];
    choreRows = fresh.chores.map(c=>({...c, child_id:fresh.id}));
    prizeRows = fresh.prizes.map(p=>({...p, child_id:fresh.id}));
    challengeRows = fresh.challenges.map(ch=>({...ch, child_id:fresh.id, chore_id:ch.choreId, start_date:ch.startDate||null, end_date:ch.endDate||null}));
    punishmentRows = [];
  }

  let pin = '1234';
  if(settingsRes.data){ pin = settingsRes.data.pin; }
  else { await sb.from('family_settings').insert({pin:'1234'}).throwOnError(); }

  const children = childRows.map(cr => rowsToChild(cr, choreRows, prizeRows, challengeRows, punishmentRows, entriesRes.data, notificationsRes.data));
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
      deliverPendingNotifications();
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
    .on('postgres_changes', {event:'*', schema:'public', table:'challenges', filter}, scheduleRefetch)
    .on('postgres_changes', {event:'*', schema:'public', table:'punishments', filter}, scheduleRefetch)
    .on('postgres_changes', {event:'*', schema:'public', table:'entries', filter}, scheduleRefetch)
    .on('postgres_changes', {event:'*', schema:'public', table:'notifications', filter}, scheduleRefetch)
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

function limitSummaryText(limitMax, limitPeriod){
  if(!limitMax) return 'No limit';
  return `${limitMax}/${limitPeriod==='week'?'wk':'day'}`;
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
/* ---------- challenges: recurring or date-bound bonus goals tied to a chore ---------- */
function isChallengeActive(ch, dk){
  return ch.type==='recurring' ? true : (dk>=ch.startDate && dk<=ch.endDate);
}
function challengeProgress(c, ch){
  const inWindow = ch.type==='recurring'
    ? e => weekKeyFor(new Date(e.ts))===c.weekStart
    : e => { const d=dateKey(new Date(e.ts)); return d>=ch.startDate && d<=ch.endDate; };
  return c.entries.filter(e=>e.kind==='chore' && e.refId===ch.choreId && e.status==='approved' && inWindow(e)).length;
}
function challengeBonusGranted(c, ch){
  return ch.type==='recurring'
    ? c.entries.some(e=>e.kind==='bonus' && e.refId===ch.id && weekKeyFor(new Date(e.ts))===c.weekStart)
    : c.entries.some(e=>e.kind==='bonus' && e.refId===ch.id);
}
function maybeGrantChallengeBonus(c, ch, status){
  if(!isChallengeActive(ch, todayKey())) return null;
  if(challengeProgress(c, ch) < ch.target) return null;
  if(challengeBonusGranted(c, ch)) return null;
  const bonus = { id:uid(), ts:Date.now(), kind:'bonus', refId:ch.id, label:`${ch.label} Bonus!`, emoji:'🏆', currency:ch.currency, amount:ch.bonus, status, fulfilled:false, minutesUsed:0 };
  c.entries.push(bonus);
  if(status==='approved'){ if(ch.currency==='points') c.points+=ch.bonus; else c.minutes+=ch.bonus; }
  return bonus;
}
function checkChallengesForApproval(c, entry, status){
  if(entry.kind!=='chore') return [];
  ensureWeek(c);
  return (c.challenges||[]).filter(ch=>ch.choreId===entry.refId).map(ch=>maybeGrantChallengeBonus(c, ch, status)).filter(Boolean);
}

/* ---------- punishments: temporary blocks on earning/redeeming ---------- */
function isPunishmentActive(p){ return Date.now() < p.endsAt; }
function activePunishments(c){ return (c.punishments||[]).filter(isPunishmentActive); }
function isBlocked(c, field){ return activePunishments(c).some(p=>p[field]); }
function isChoreBlocked(c, chore){
  return (chore.currency==='points' && isBlocked(c,'blockPoints')) || (chore.currency==='minutes' && isBlocked(c,'blockMinutes'));
}
function formatRemaining(ms){
  const totalMin = Math.max(0, Math.ceil(ms/60000));
  const days = Math.floor(totalMin/1440);
  const hours = Math.floor((totalMin%1440)/60);
  const mins = totalMin%60;
  if(days>0) return `${days}d ${hours}h left`;
  if(hours>0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}
let punishmentExpiryTimer = null;
function schedulePunishmentExpiry(){
  clearTimeout(punishmentExpiryTimer);
  const active = activePunishments(child);
  if(!active.length) return;
  const soonest = Math.min(...active.map(p=>p.endsAt));
  const expiring = active.filter(p=>p.endsAt===soonest);
  punishmentExpiryTimer = setTimeout(()=>{
    render();
    expiring.forEach(notifyPunishmentExpired);
  }, Math.max(0, soonest-Date.now())+250);
}

async function notifyPunishmentExpired(p){
  const notif = { id:'comeback-'+p.id, kind:'comeback', label:p.label, emoji:null, amount:null, currency:null, message:null, ts:Date.now() };
  try{
    await sb.from('notifications').insert(toNotificationRow(notif, child.id)).throwOnError();
    child.notifications = child.notifications || [];
    child.notifications.push(notif);
  }catch(err){
    // duplicate id means another device's own timer already created this notification for the
    // same expiry -- expected whenever more than one kiosk has this child active, not a real error.
    if(!(err && err.code==='23505')) handleSyncError(err);
  }
}

/* ---------- prize stock limits ---------- */
function redeemCountInPeriod(c, prizeId, period){
  const inWindow = period==='week'
    ? e => weekKeyFor(new Date(e.ts))===weekKeyFor(new Date())
    : e => dateKey(new Date(e.ts))===todayKey();
  return c.entries.filter(e=>e.kind==='redeem' && e.refId===prizeId && e.status!=='denied' && inWindow(e)).length;
}
function isPrizeLimitReached(c, prize){
  if(!prize.limitMax) return false;
  return redeemCountInPeriod(c, prize.id, prize.limitPeriod||'day') >= prize.limitMax;
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
  if(isChoreBlocked(child, chore)){ toast('🚫 Blocked by a punishment right now'); return; }
  if(chore.schedule && chore.schedule.type==='once'){
    const already = child.entries.some(e=>e.kind==='chore' && e.refId===choreId && e.status!=='denied');
    if(already){ toast(`${chore.label} is already done! 🎉`); return; }
  } else if(!chore.repeatable){
    const already = entriesToday(child, 'chore', choreId).some(e=>e.status!=='denied');
    if(already){ toast(`${chore.label} is already done for today! 🎉`); return; }
  }
  const entry = { id:uid(), ts:Date.now(), kind:'chore', refId:choreId, label:chore.label, emoji:chore.emoji, currency:chore.currency, amount:chore.amount, status:'pending', fulfilled:false, minutesUsed:0 };
  child.entries.push(entry);
  spawnFloaterAt(evt, `+${chore.amount} ${chore.currency==='points'?'pts':'min'} (pending)`, 'var(--gold-deep)');
  toast(`Sent "${chore.label}" for approval ⏳`);
  render();
  try{ await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError(); }catch(err){ handleSyncError(err); }
}

function pastDateOrToast(dateStr){
  if(!dateStr){ toast('Pick a date'); return null; }
  const d = new Date(dateStr+'T12:00:00');
  if(dateKey(d) > todayKey()){ toast('Pick today or an earlier date'); return null; }
  return d;
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
  const entry = { id:uid(), ts:d.getTime(), kind:'chore', refId:choreId, label:chore.label, emoji:chore.emoji, currency:chore.currency, amount:chore.amount, status:'approved', fulfilled:false, minutesUsed:0 };
  child.entries.push(entry);
  if(chore.currency==='points') child.points += chore.amount; else child.minutes += chore.amount;
  const bonuses = checkChallengesForApproval(child, entry, 'approved');
  toast(bonuses.length ? `Added "${chore.label}" — bonus unlocked! 🏆` : `Added "${chore.label}" ✅`);
  renderParentBody(); render();
  try{
    await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError();
    for(const b of bonuses) await sb.from('entries').insert(toEntryRow(b, child.id)).throwOnError();
    await sb.from('children').update({points: child.points, minutes: child.minutes}).eq('id', child.id).throwOnError();
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
    fulfilled:true, minutesUsed:0, grantsMinutes:prize.grantsMinutes||0
  };
  child.entries.push(entry);
  child.points = Math.max(0, child.points - prize.cost);
  if(entry.grantsMinutes>0) child.minutes += entry.grantsMinutes;
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
  if(isBlocked(child, 'blockPrizes')){ toast('🚫 Prize redemption is paused right now'); return; }
  if(isPrizeLimitReached(child, prize)){ toast(`🚫 ${prize.label} limit reached for this ${prize.limitPeriod||'day'}`); return; }
  const already = child.entries.some(e=>e.kind==='redeem' && e.refId===prizeId && e.status==='pending');
  if(already){ toast('Already waiting on approval for that one!'); return; }
  const entry = {
    id:uid(), ts:Date.now(), kind:'redeem', refId:prizeId,
    label:prize.label, emoji:prize.emoji, currency:'points', amount:prize.cost, status:'pending',
    fulfilled:false, minutesUsed:0, grantsMinutes:prize.grantsMinutes||0
  };
  child.entries.push(entry);
  spawnFloaterAt(evt, `Requested!`, 'var(--coral-deep)');
  toast(`Asked to redeem "${prize.label}" 🙋`);
  const clearedGoal = child.goalPrizeId===prizeId;
  if(clearedGoal) child.goalPrizeId = null;
  render();
  try{
    await sb.from('entries').insert(toEntryRow(entry, child.id)).throwOnError();
    if(clearedGoal) await sb.from('children').update({goal_prize_id:null}).eq('id', child.id).throwOnError();
  }catch(err){ handleSyncError(err); }
}

async function toggleSavingsGoal(prizeId){
  if(!requireOnline()) return;
  const prize = child.prizes.find(p=>p.id===prizeId);
  if(!prize) return;
  child.goalPrizeId = child.goalPrizeId===prizeId ? null : prizeId;
  render();
  try{ await sb.from('children').update({goal_prize_id: child.goalPrizeId}).eq('id', child.id).throwOnError(); }catch(err){ handleSyncError(err); }
}

async function approveEntry(id, opts){
  if(!connectionOk){ if(!(opts && opts.silent)) toast('Offline — try again once reconnected'); return; }
  const owner = findEntryOwner(id);
  if(!owner) return;
  const c = owner.child, e = owner.entry;
  if(e.status!=='pending') return;
  if(!(opts && opts.silent)) snapshotForUndo(`Approved "${e.label}"`, c, e, 'pending');
  e.status='approved';

  if(e.kind==='chore' || e.kind==='bonus'){
    if(e.currency==='points') c.points += e.amount;
    else c.minutes += e.amount;
    burstConfetti();
  } else if(e.kind==='redeem'){
    c.points -= e.amount;
    burstConfetti();
  }

  const notif = {
    id: uid(), kind:'celebration', label: e.label, emoji: e.emoji,
    amount: e.kind==='redeem' ? null : e.amount, currency: e.kind==='redeem' ? null : e.currency,
    message: null, ts: Date.now()
  };
  c.notifications = c.notifications || [];
  c.notifications.push(notif);

  const newBonuses = checkChallengesForApproval(c, e, 'pending');
  if(newBonuses.length){
    if(lastActionSnapshot) newBonuses.forEach(b=>lastActionSnapshot.extraEntryIds.push(b.id));
    toast(`"${e.label}" approved — a challenge bonus was sent for approval too! 🏆`);
  }
  render();

  try{
    await sb.from('entries').update({status:'approved'}).eq('id', id).throwOnError();
    await sb.from('children').update({points:c.points, minutes:c.minutes}).eq('id', c.id).throwOnError();
    await sb.from('notifications').insert(toNotificationRow(notif, c.id)).throwOnError();
    for(const b of newBonuses) await sb.from('entries').insert(toEntryRow(b, c.id)).throwOnError();
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

async function markFulfilled(id){
  if(!requireOnline()) return;
  const owner = findEntryOwner(id);
  if(!owner) return;
  const c = owner.child, e = owner.entry;
  if(e.kind!=='redeem' || e.status!=='approved' || e.fulfilled) return;
  e.fulfilled = true;
  if(e.grantsMinutes>0) c.minutes += e.grantsMinutes;
  toast(e.grantsMinutes>0 ? `Marked "${e.label}" as delivered — +${e.grantsMinutes} min added ✅` : `Marked "${e.label}" as delivered ✅`);
  renderParentBody(); render();
  try{
    await sb.from('entries').update({fulfilled:true}).eq('id', id).throwOnError();
    if(e.grantsMinutes>0) await sb.from('children').update({minutes:c.minutes}).eq('id', c.id).throwOnError();
  }catch(err){ handleSyncError(err); }
}

function minutesGrantTotal(e){
  if(e.kind==='redeem') return e.fulfilled ? (e.grantsMinutes||0) : 0;
  return e.currency==='minutes' ? e.amount : 0;
}

async function logMinutesUsed(amount){
  if(!requireOnline()) return;
  const c = child;
  const requested = Math.max(0, Math.floor(amount) || 0);
  if(requested<=0){ toast('Enter a valid number of minutes'); return; }
  const openEntries = c.entries
    .filter(e=>e.status==='approved' && minutesGrantTotal(e)-(e.minutesUsed||0)>0)
    .sort((a,b)=>a.ts-b.ts);
  let remaining = requested;
  const touched = [];
  for(const e of openEntries){
    if(remaining<=0) break;
    const avail = minutesGrantTotal(e) - (e.minutesUsed||0);
    const take = Math.min(avail, remaining);
    if(take<=0) continue;
    e.minutesUsed = (e.minutesUsed||0) + take;
    remaining -= take;
    touched.push(e);
  }
  const applied = requested - remaining;
  if(applied<=0){ toast('No earned minutes left to log against'); return; }
  c.minutes = Math.max(0, c.minutes - applied);
  toast(applied<requested
    ? `Logged ${applied} min used — that's all that was tracked as earned (${c.minutes} min left)`
    : `Logged ${applied} min used — ${c.minutes} min left`);
  renderParentBody(); render();
  try{
    for(const e of touched) await sb.from('entries').update({minutes_used:e.minutesUsed}).eq('id', e.id).throwOnError();
    await sb.from('children').update({minutes:c.minutes}).eq('id', c.id).throwOnError();
  }catch(err){ handleSyncError(err); }
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
    extraEntryIds: []
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
  if(snap.extraEntryIds && snap.extraEntryIds.length){
    c.entries = c.entries.filter(e=>!snap.extraEntryIds.includes(e.id));
  }
  c.points = snap.points;
  c.minutes = snap.minutes;

  render();
  toast('Undone ↩️');

  try{
    if(entry) await sb.from('entries').update({status: snap.prevStatus}).eq('id', snap.entryId).throwOnError();
    for(const extraId of (snap.extraEntryIds||[])) await sb.from('entries').delete().eq('id', extraId).throwOnError();
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

function pinPromptLabel(ctx){
  if(ctx && ctx.type==='child'){
    const c = state.children.find(x=>x.id===ctx.childId);
    return c ? `${c.avatar} ${c.name}'s PIN` : 'Enter PIN';
  }
  return 'Parent PIN';
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
        title.textContent = pinPromptLabel(pinContext);
        sub.textContent = 'Enter the 4-digit code';
        renderPinDots();
      }
    };
    tick();
    pinLockTimer = setInterval(tick, 1000);
  } else {
    pad.style.display = 'grid';
    title.textContent = pinPromptLabel(pinContext);
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
      const expected = (pinContext && pinContext.type==='child')
        ? ((state.children.find(c=>c.id===pinContext.childId)||{}).pin || state.pin)
        : state.pin;
      if(pinBuffer===expected){
        savePinLockState({fails:0, lockUntil:null});
        closePin();
        hideLockScreen();
        resetAppIdleTimer();
        if(pinContext && pinContext.type==='child'){ switchChild(pinContext.childId); }
        else { openParent(); }
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

/* ============ KIOSK IDLE LOCK ============ */
const APP_IDLE_MS = 30000; // drop to the lock screen after 30 idle seconds
let appLastActivity = 0;
let appIdleChecker = null;
let kioskLocked = false;

function resetAppIdleTimer(){ appLastActivity = Date.now(); }
function startAppIdleWatch(){
  resetAppIdleTimer();
  document.addEventListener('click', resetAppIdleTimer);
  document.addEventListener('input', resetAppIdleTimer);
  document.addEventListener('touchstart', resetAppIdleTimer);
  appIdleChecker = setInterval(()=>{
    if(!kioskLocked && Date.now() - appLastActivity > APP_IDLE_MS){
      showLockScreen();
    }
  }, 5000);
}

function pickLockScreenPip(){
  if(state.children.some(c=>(c.notifications||[]).some(n=>n.kind==='celebration' || n.kind==='comeback'))){
    return 'pip-celebration.png';
  }
  if(state.children.some(c=>activePunishments(c).length>0)){
    return 'pip-pause.png';
  }
  if(state.children.some(c=>(c.challenges||[]).some(ch=>{
    if(!isChallengeActive(ch, todayKey())) return false;
    const p = challengeProgress(c, ch);
    return p>0 && p<ch.target;
  }))){
    return 'pip-streak.png';
  }
  return Math.random()<0.5 ? 'pip-wave.png' : 'pip-flying.png';
}

function renderLockScreen(){
  const grid = document.getElementById('lockGrid');
  if(!grid) return;
  const pipImg = document.getElementById('lockPipImg');
  if(pipImg) pipImg.src = pickLockScreenPip();
  grid.style.gridTemplateColumns = state.children.length<=1 ? '1fr' : 'repeat(2,1fr)';
  grid.innerHTML = state.children.map((c,i)=>`
    <button class="lock-tile" data-lock-child="${c.id}" style="animation-delay:${i*90}ms">
      ${(c.notifications||[]).length>0 ? '<img class="lock-mail-badge" src="badge-mail.png" alt="">' : ''}
      <div class="lock-tile-avatar">${c.avatar}</div>
      <div class="lock-tile-name">${c.name}</div>
      <div class="lock-tile-stats"><img class="lock-tile-stat-icon" src="pip-point-core.png" alt="">${c.points} <span>·</span> ${c.minutes} min</div>
    </button>`).join('') + `
    <button class="lock-tile lock-tile-parent" data-lock-parent="1" style="animation-delay:${state.children.length*90}ms">
      <div class="lock-tile-avatar">🔐</div>
      <div class="lock-tile-name">Parent</div>
    </button>`;
  grid.querySelectorAll('[data-lock-child]').forEach(b=>{
    b.onclick=()=>openPin({type:'child', childId:b.dataset.lockChild});
  });
  const parentTile = grid.querySelector('[data-lock-parent]');
  if(parentTile) parentTile.onclick=()=>openPin({type:'parent'});
}

const LOCK_TAGLINES = [
  'Tap your avatar to continue',
  'Ready for an adventure?',
  "Let's keep the streak alive!",
  'Little wins, big adventures.',
  'Pip is waiting for you!'
];
let lockTaglineTimer = null, lockTaglineIndex = 0;
function startLockTagline(){
  stopLockTagline();
  lockTaglineIndex = 0;
  const el = document.getElementById('lockTagline');
  if(!el) return;
  el.textContent = LOCK_TAGLINES[0];
  lockTaglineTimer = setInterval(()=>{
    el.classList.add('fade');
    setTimeout(()=>{
      lockTaglineIndex = (lockTaglineIndex+1) % LOCK_TAGLINES.length;
      el.textContent = LOCK_TAGLINES[lockTaglineIndex];
      el.classList.remove('fade');
    }, 400);
  }, 4000);
}
function stopLockTagline(){
  clearInterval(lockTaglineTimer);
  lockTaglineTimer = null;
}
function showLockScreen(){
  if(kioskLocked) return;
  kioskLocked = true;
  document.querySelectorAll('.overlay.show').forEach(el=>el.classList.remove('show'));
  pinBuffer=''; pinContext=null;
  renderLockScreen();
  document.getElementById('kioskLockScreen').classList.add('show');
  startLockTagline();
}
function hideLockScreen(){
  kioskLocked = false;
  document.getElementById('kioskLockScreen').classList.remove('show');
  stopLockTagline();
}

/* ============ PARENT ZONE ============ */
function openParent(){
  activeParentTab='approve';
  settingsTab='profile';
  manualEntryType=null;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.ptab==='approve'));
  renderParentBody();
  document.getElementById('parentOverlay').classList.add('show');
}
function closeParent(){
  document.getElementById('parentOverlay').classList.remove('show');
}
function renderParentBody(){
  const body = document.getElementById('parentBody');
  if(activeParentTab==='approve') body.innerHTML = parentApproveHTML();
  else if(activeParentTab==='chores') body.innerHTML = parentChoresHTML();
  else if(activeParentTab==='prizes') body.innerHTML = parentPrizesHTML();
  else if(activeParentTab==='challenges') body.innerHTML = parentChallengesHTML();
  else if(activeParentTab==='punishments') body.innerHTML = parentPunishmentsHTML();
  else body.innerHTML = parentSettingsHTML();
  wireParentBody();
}

function parentApproveHTML(){
  const pend = pendingEntries();
  const multiChild = state.children.length > 1;
  const unfulfilled = state.children.flatMap(c=>c.entries
    .filter(e=>e.kind==='redeem' && e.status==='approved' && !e.fulfilled)
    .map(e=>Object.assign({}, e, {_childId:c.id, _childName:c.name}))
  ).sort((a,b)=>a.ts-b.ts);

  if(pend.length===0 && unfulfilled.length===0){
    return `<div class="empty-state"><div class="e">✅</div>Nothing waiting on you right now.</div>`;
  }

  const pendHTML = pend.length ? `
    <div class="approve-all-row">
      <div class="approve-all-count">${pend.length} waiting</div>
      <button class="btn-bulk-approve" id="bulkApproveBtn">Approve All</button>
    </div>` + pend.map(e=>{
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
      <div class="approval-meta">${timeAgo(e.ts)}</div>
      ${extra}
      <div class="approval-actions">
        <button class="btn btn-approve" data-approve="${e.id}">Approve</button>
        <button class="btn btn-deny" data-deny="${e.id}">Deny</button>
      </div>
    </div>`;
  }).join('') : '';

  const fulfillHTML = unfulfilled.length ? `
    <div class="approve-all-row" style="margin-top:${pend.length?'22px':'0'};">
      <div class="approve-all-count">${unfulfilled.length} claimed, not delivered yet</div>
    </div>` + unfulfilled.map(e=>`
    <div class="approval-item">
      <div class="approval-top">
        <div class="approval-label">${e.emoji} ${e.label}${multiChild?` <span class="child-tag">${e._childName}</span>`:''}</div>
      </div>
      <div class="approval-meta">Approved ${timeAgo(e.ts)}</div>
      <div class="approval-actions">
        <button class="btn btn-approve" data-fulfill="${e.id}">Mark Delivered</button>
      </div>
    </div>`).join('') : '';

  return pendHTML + fulfillHTML;
}

function parentChoresHTML(){
  const rows = child.chores.map(c=>`
    <div class="list-edit-item" data-reorder-id="${c.id}">
      <div class="item-row-main">
        <button class="drag-handle" data-drag-handle>⠿</button>
        <button class="icon-swatch" data-edit-chore-icon="${c.id}">${c.emoji}</button>
        <input class="label-edit" data-chore-label="${c.id}" value="${c.label}">
        <button class="icon-btn-sm" data-chore-del="${c.id}">Remove</button>
      </div>
      <div class="item-row-meta">
        <input class="settings-input" type="number" min="0" data-chore-amount="${c.id}" value="${c.amount}">
        <button class="icon-btn-sm currency-toggle" data-chore-currency="${c.id}">${c.currency==='points'?'Pts':'Min'}</button>
        <button class="schedule-pill" data-edit-chore-schedule="${c.id}">📅 ${scheduleSummaryText(c.schedule)}</button>
        <label class="inline-check">
          <input type="checkbox" data-chore-repeat="${c.id}" ${c.repeatable?'checked':''}> Repeatable
        </label>
      </div>
    </div>
  `).join('');
  return `
    <div class="sheet-sub">Editing <b>${child.name}</b>'s activities. Names, amounts, icons, and schedules all update live. Drag ⠿ to reorder — that's the order shown on Home. Removing an activity doesn't erase past history.</div>
    <div class="reorder-list" id="choreReorderList">${rows}</div>
    <div class="list-edit-item" style="border-bottom:none;">
      <div class="item-row-main" style="margin-top:10px;">
        <button class="icon-swatch" id="newChoreIconBtn">${pendingChoreIcon}</button>
        <input id="newChoreLabel" class="label-edit" placeholder="New activity name">
      </div>
      <div class="item-row-meta">
        <input id="newChoreAmount" class="settings-input" type="number" placeholder="amt">
        <button class="icon-btn-sm currency-toggle" id="newChoreCurrencyBtn">${pendingChoreCurrency==='points'?'Pts':'Min'}</button>
        <button class="schedule-pill" id="newChoreScheduleBtn">📅 ${scheduleSummaryText(pendingChoreSchedule)}</button>
        <label class="inline-check">
          <input type="checkbox" id="newChoreRepeat"> Repeatable
        </label>
      </div>
      <button class="btn btn-primary" id="addChoreBtn" style="margin-top:10px;">Add Activity</button>
    </div>
  `;
}

function parentChallengesHTML(){
  const rows = (child.challenges||[]).map(ch=>{
    const chore = child.chores.find(c=>c.id===ch.choreId);
    const cur = ch.currency==='points' ? 'pts' : 'min';
    const window = ch.type==='recurring' ? 'Weekly' : `${ch.startDate} → ${ch.endDate}`;
    return `
    <div class="list-edit-item">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="font-size:24px;">${chore ? chore.emoji : '🏆'}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; font-size:14px;">${ch.label}</div>
          <div style="font-size:12px; color:var(--ink-soft); font-weight:700;">${chore ? chore.label : 'Unknown activity'} · ${ch.target}x · +${ch.bonus} ${cur} · ${window}</div>
        </div>
        <button class="icon-btn-sm" data-edit-challenge="${ch.id}">Edit</button>
        <button class="icon-btn-sm" data-challenge-del="${ch.id}">Remove</button>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="sheet-sub">Challenges watch an activity's approvals and pay a bonus once the target is hit — recurring ones reset every week, one-time ones only run between the dates you set.</div>
    ${rows || `<div class="empty-state"><div class="e">🏆</div>No challenges set up yet.</div>`}
    <div class="add-row" style="margin-top:16px;">
      <button class="btn btn-primary" id="addChallengeBtn" style="width:100%;">+ Add Challenge</button>
    </div>
  `;
}

function parentPunishmentsHTML(){
  const rows = (child.punishments||[]).filter(isPunishmentActive).map(p=>{
    const blocks = [p.blockPoints&&'🪙 points', p.blockMinutes&&'⏰ time', p.blockPrizes&&'🎁 prizes'].filter(Boolean).join(' · ');
    return `
    <div class="list-edit-item">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="font-size:24px;">🚫</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; font-size:14px;">${p.label}</div>
          <div style="font-size:12px; color:var(--ink-soft); font-weight:700;">${blocks} blocked · ${formatRemaining(p.endsAt-Date.now())}</div>
        </div>
        <button class="icon-btn-sm" data-edit-punishment="${p.id}">Edit</button>
        <button class="icon-btn-sm" data-punishment-del="${p.id}">Remove</button>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="sheet-sub">Punishments temporarily block earning points, earning screen time, and/or redeeming prizes for a set amount of time. They lift automatically, or you can remove one early.</div>
    ${rows || `<div class="empty-state"><div class="e">🚫</div>No active punishments.</div>`}
    <div class="add-row" style="margin-top:16px;">
      <button class="btn btn-primary" id="addPunishmentBtn" style="width:100%;">+ Add Punishment</button>
    </div>
  `;
}

function parentPrizesHTML(){
  const rows = child.prizes.map(p=>`
    <div class="list-edit-item" data-reorder-id="${p.id}">
      <div class="item-row-main">
        <button class="drag-handle" data-drag-handle>⠿</button>
        <button class="icon-swatch" data-edit-prize-icon="${p.id}">${p.emoji}</button>
        <input class="label-edit" data-prize-label="${p.id}" value="${p.label}">
        <button class="icon-btn-sm" data-prize-del="${p.id}">Remove</button>
      </div>
      <div class="item-row-meta">
        <input class="settings-input" type="number" min="0" data-prize-cost="${p.id}" value="${p.cost}">
        <input class="settings-input" type="number" min="0" data-prize-minutes="${p.id}" value="${p.grantsMinutes||''}" placeholder="min">
        <button class="schedule-pill" data-edit-prize-limit="${p.id}">🔁 ${limitSummaryText(p.limitMax, p.limitPeriod)}</button>
      </div>
    </div>
  `).join('');
  return `
    <div class="sheet-sub">Editing <b>${child.name}</b>'s prizes. Names, costs, and icons all update live. Drag ⠿ to reorder — that's the order shown in Prizes. "min" is optional — set it for screen-time prizes so marking a redemption Delivered also credits that many minutes. The 🔁 pill sets an optional redemption limit — cap how often a prize can be redeemed per day or week.</div>
    <div class="reorder-list" id="prizeReorderList">${rows}</div>
    <div class="list-edit-item" style="border-bottom:none;">
      <div class="item-row-main" style="margin-top:10px;">
        <button class="icon-swatch" id="newPrizeIconBtn">${pendingPrizeIcon}</button>
        <input id="newPrizeLabel" class="label-edit" placeholder="New prize name">
      </div>
      <div class="item-row-meta">
        <input id="newPrizeCost" class="settings-input" type="number" placeholder="cost">
        <input id="newPrizeMinutes" class="settings-input" type="number" placeholder="min" min="0">
        <button class="schedule-pill" id="newPrizeLimitBtn">🔁 ${limitSummaryText(pendingPrizeLimit.max, pendingPrizeLimit.period)}</button>
      </div>
      <button class="btn btn-primary" id="addPrizeBtn" style="margin-top:10px;">Add Prize</button>
    </div>
  `;
}

function iconPickerHTML(){
  const set = (iconPickerContext && iconPickerContext.type==='childAvatar') ? AVATAR_SET : ICON_SET;
  return `
    <div class="icon-type-row">
      <input id="iconTypeInput" class="icon-type-input" type="text" placeholder="Type any emoji…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <button class="icon-type-use-btn" id="iconTypeUseBtn">Use</button>
    </div>
    <div class="icon-grid-label">Quick picks</div>
    <div class="icon-grid">${set.map(ic=>`<button data-icon="${ic}">${ic}</button>`).join('')}</div>
  `;
}
function openIconPicker(ctx){
  iconPickerContext = ctx;
  const title = document.getElementById('iconPickerTitle');
  if(title) title.textContent = ctx.type==='childAvatar' ? 'Pick an Avatar' : 'Pick an Icon';
  document.getElementById('iconPickerBody').innerHTML = iconPickerHTML();
  document.querySelectorAll('#iconPickerBody [data-icon]').forEach(b=>{
    b.onclick=()=>pickIcon(b.dataset.icon);
  });
  const typeInput = document.getElementById('iconTypeInput');
  const useBtn = document.getElementById('iconTypeUseBtn');
  if(typeInput){
    // Native emoji keyboards insert a whole emoji in one shot, so as soon as
    // the field contains one we can apply it immediately — no extra tap needed.
    typeInput.oninput = ()=>{
      const val = typeInput.value.trim();
      if(val && EMOJI_INPUT_RE.test(val)) pickIcon(val);
    };
  }
  if(useBtn){
    useBtn.onclick=()=>{
      const val = typeInput ? typeInput.value.trim() : '';
      if(val) pickIcon(val);
    };
  }
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
  } else if(ctx.type==='childAvatar'){
    if(!requireOnline()) return;
    const c = state.children.find(x=>x.id===ctx.id);
    if(c){ c.avatar = emoji; renderParentBody(); render(); try{ await sb.from('children').update({avatar:emoji}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); } }
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

function openChallengePicker(ctx){
  challengePickerContext = ctx;
  const existing = ctx.type==='edit' ? child.challenges.find(c=>c.id===ctx.id) : null;
  challengeDraft = structuredClone(existing || {
    choreId: (child.chores[0]||{}).id, label:'', target:5, bonus:50, currency:'points', type:'recurring',
    startDate: todayKey(), endDate: todayKey()
  });
  document.getElementById('challengePickerBody').innerHTML = challengeEditorHTML();
  wireChallengeEditor();
  document.getElementById('challengeOverlay').classList.add('show');
}
function closeChallengePicker(){
  document.getElementById('challengeOverlay').classList.remove('show');
  challengePickerContext = null;
}

function challengeEditorHTML(){
  const choreOptions = child.chores.map(c=>`<option value="${c.id}" ${challengeDraft.choreId===c.id?'selected':''}>${c.emoji} ${c.label}</option>`).join('');
  const currencyRow = `<div class="sched-type-row">
    <button class="sched-type-btn ${challengeDraft.currency==='points'?'active':''}" data-chal-currency="points">Points</button>
    <button class="sched-type-btn ${challengeDraft.currency==='minutes'?'active':''}" data-chal-currency="minutes">Minutes</button>
  </div>`;
  const typeRow = `<div class="sched-type-row">
    <button class="sched-type-btn ${challengeDraft.type==='recurring'?'active':''}" data-chal-type="recurring">Recurring (weekly)</button>
    <button class="sched-type-btn ${challengeDraft.type==='onetime'?'active':''}" data-chal-type="onetime">One-Time</button>
  </div>`;
  const dateRow = challengeDraft.type==='onetime' ? `
    <div class="sched-sub-label">Starts</div>
    <input type="date" id="chalStartDate" class="child-name-input" value="${challengeDraft.startDate}">
    <div class="sched-sub-label">Ends</div>
    <input type="date" id="chalEndDate" class="child-name-input" value="${challengeDraft.endDate}">
  ` : `<div class="sheet-sub" style="margin-top:8px;">Resets every week, indefinitely — same as School's streak.</div>`;

  return `
    <div class="sched-sub-label">Which activity?</div>
    <select id="chalChoreSelect" class="child-name-input">${choreOptions}</select>
    <div class="sched-sub-label">Challenge name</div>
    <input id="chalLabel" class="child-name-input" placeholder="e.g. Dishes Streak" value="${challengeDraft.label}">
    <div class="sched-sub-label">Target count</div>
    <input id="chalTarget" class="settings-input" type="number" min="1" value="${challengeDraft.target}" style="width:100%;">
    <div class="sched-sub-label">Bonus amount</div>
    <input id="chalBonus" class="settings-input" type="number" min="0" value="${challengeDraft.bonus}" style="width:100%;">
    ${currencyRow}
    <div class="sched-sub-label">Type</div>
    ${typeRow}
    ${dateRow}
  `;
}

function wireChallengeEditor(){
  const choreSelect = document.getElementById('chalChoreSelect');
  if(choreSelect) choreSelect.onchange=()=>{ challengeDraft.choreId = choreSelect.value; };
  const labelInp = document.getElementById('chalLabel');
  if(labelInp) labelInp.oninput=()=>{ challengeDraft.label = labelInp.value; };
  const targetInp = document.getElementById('chalTarget');
  if(targetInp) targetInp.oninput=()=>{ challengeDraft.target = parseInt(targetInp.value)||1; };
  const bonusInp = document.getElementById('chalBonus');
  if(bonusInp) bonusInp.oninput=()=>{ challengeDraft.bonus = parseInt(bonusInp.value)||0; };
  document.querySelectorAll('[data-chal-currency]').forEach(b=>{
    b.onclick=()=>{ challengeDraft.currency = b.dataset.chalCurrency; document.getElementById('challengePickerBody').innerHTML = challengeEditorHTML(); wireChallengeEditor(); };
  });
  document.querySelectorAll('[data-chal-type]').forEach(b=>{
    b.onclick=()=>{ challengeDraft.type = b.dataset.chalType; document.getElementById('challengePickerBody').innerHTML = challengeEditorHTML(); wireChallengeEditor(); };
  });
  const startInp = document.getElementById('chalStartDate');
  if(startInp) startInp.onchange=()=>{ challengeDraft.startDate = startInp.value; };
  const endInp = document.getElementById('chalEndDate');
  if(endInp) endInp.onchange=()=>{ challengeDraft.endDate = endInp.value; };
}

async function saveChallenge(){
  const ctx = challengePickerContext;
  if(!ctx || !requireOnline()) return;
  const chore = child.chores.find(c=>c.id===challengeDraft.choreId);
  if(!chore) return;
  const draft = structuredClone(challengeDraft);
  if(!draft.label) draft.label = `${chore.label} Challenge`;
  closeChallengePicker();
  if(ctx.type==='new'){
    const newChallenge = Object.assign({id:uid()}, draft);
    child.challenges.push(newChallenge);
    renderParentBody(); render();
    try{
      await sb.from('challenges').insert({id:newChallenge.id, child_id:child.id, chore_id:newChallenge.choreId, label:newChallenge.label, target:newChallenge.target, bonus:newChallenge.bonus, currency:newChallenge.currency, type:newChallenge.type, start_date:newChallenge.startDate||null, end_date:newChallenge.endDate||null}).throwOnError();
    }catch(err){ handleSyncError(err); }
  } else {
    const c = child.challenges.find(x=>x.id===ctx.id);
    if(!c) return;
    Object.assign(c, draft);
    renderParentBody(); render();
    try{
      await sb.from('challenges').update({chore_id:c.choreId, label:c.label, target:c.target, bonus:c.bonus, currency:c.currency, type:c.type, start_date:c.startDate||null, end_date:c.endDate||null}).eq('id', c.id).throwOnError();
    }catch(err){ handleSyncError(err); }
  }
}

function openPunishmentPicker(ctx){
  punishmentPickerContext = ctx;
  const existing = ctx.type==='edit' ? child.punishments.find(p=>p.id===ctx.id) : null;
  const remainingMs = existing ? Math.max(0, existing.endsAt-Date.now()) : 0;
  punishmentDraft = existing ? {
    label: existing.label, blockPoints: existing.blockPoints, blockMinutes: existing.blockMinutes, blockPrizes: existing.blockPrizes,
    durationAmount: Math.max(1, Math.round(remainingMs/3600000)), durationUnit:'hours'
  } : { label:'', blockPoints:false, blockMinutes:false, blockPrizes:false, durationAmount:1, durationUnit:'days' };
  document.getElementById('punishmentPickerBody').innerHTML = punishmentEditorHTML();
  wirePunishmentEditor();
  document.getElementById('punishmentOverlay').classList.add('show');
}
function closePunishmentPicker(){
  document.getElementById('punishmentOverlay').classList.remove('show');
  punishmentPickerContext = null;
}

function punishmentEditorHTML(){
  const blockRow = `<div class="sched-type-row">
    <button class="sched-type-btn ${punishmentDraft.blockPoints?'active':''}" data-pun-block="blockPoints">🪙 Points</button>
    <button class="sched-type-btn ${punishmentDraft.blockMinutes?'active':''}" data-pun-block="blockMinutes">⏰ Time</button>
    <button class="sched-type-btn ${punishmentDraft.blockPrizes?'active':''}" data-pun-block="blockPrizes">🎁 Prizes</button>
  </div>`;
  const unitRow = `<div class="sched-type-row">
    <button class="sched-type-btn ${punishmentDraft.durationUnit==='hours'?'active':''}" data-pun-unit="hours">Hours</button>
    <button class="sched-type-btn ${punishmentDraft.durationUnit==='days'?'active':''}" data-pun-unit="days">Days</button>
  </div>`;
  return `
    <div class="sched-sub-label">Reason (optional)</div>
    <input id="punLabel" class="child-name-input" placeholder="e.g. Backtalk" value="${punishmentDraft.label}">
    <div class="sched-sub-label">Block what?</div>
    ${blockRow}
    <div class="sched-sub-label">For how long?</div>
    <input id="punDuration" class="settings-input" type="number" min="1" value="${punishmentDraft.durationAmount}" style="width:100%;">
    ${unitRow}
  `;
}

function wirePunishmentEditor(){
  const labelInp = document.getElementById('punLabel');
  if(labelInp) labelInp.oninput=()=>{ punishmentDraft.label = labelInp.value; };
  const durInp = document.getElementById('punDuration');
  if(durInp) durInp.oninput=()=>{ punishmentDraft.durationAmount = parseInt(durInp.value)||1; };
  document.querySelectorAll('[data-pun-block]').forEach(b=>{
    b.onclick=()=>{
      const field = b.dataset.punBlock;
      punishmentDraft[field] = !punishmentDraft[field];
      b.classList.toggle('active');
    };
  });
  document.querySelectorAll('[data-pun-unit]').forEach(b=>{
    b.onclick=()=>{ punishmentDraft.durationUnit = b.dataset.punUnit; document.getElementById('punishmentPickerBody').innerHTML = punishmentEditorHTML(); wirePunishmentEditor(); };
  });
}

async function savePunishment(){
  const ctx = punishmentPickerContext;
  if(!ctx || !requireOnline()) return;
  if(!punishmentDraft.blockPoints && !punishmentDraft.blockMinutes && !punishmentDraft.blockPrizes){ toast('Pick at least one thing to block'); return; }
  if(!punishmentDraft.durationAmount || punishmentDraft.durationAmount<1){ toast('Enter a duration'); return; }
  const ms = punishmentDraft.durationAmount * (punishmentDraft.durationUnit==='hours' ? 3600000 : 86400000);
  const endsAt = Date.now() + ms;
  const label = punishmentDraft.label.trim() || 'Punishment';
  closePunishmentPicker();
  if(ctx.type==='new'){
    const newPunishment = { id:uid(), label, blockPoints:punishmentDraft.blockPoints, blockMinutes:punishmentDraft.blockMinutes, blockPrizes:punishmentDraft.blockPrizes, endsAt };
    child.punishments.push(newPunishment);
    renderParentBody(); render();
    try{
      await sb.from('punishments').insert({id:newPunishment.id, child_id:child.id, label:newPunishment.label, block_points:newPunishment.blockPoints, block_minutes:newPunishment.blockMinutes, block_prizes:newPunishment.blockPrizes, ends_at:newPunishment.endsAt}).throwOnError();
    }catch(err){ handleSyncError(err); }
  } else {
    const p = child.punishments.find(x=>x.id===ctx.id);
    if(!p) return;
    Object.assign(p, {label, blockPoints:punishmentDraft.blockPoints, blockMinutes:punishmentDraft.blockMinutes, blockPrizes:punishmentDraft.blockPrizes, endsAt});
    renderParentBody(); render();
    try{
      await sb.from('punishments').update({label:p.label, block_points:p.blockPoints, block_minutes:p.blockMinutes, block_prizes:p.blockPrizes, ends_at:p.endsAt}).eq('id', p.id).throwOnError();
    }catch(err){ handleSyncError(err); }
  }
}

function openLimitPicker(ctx){
  limitPickerContext = ctx;
  let max, period;
  if(ctx.type==='newPrize'){ max = pendingPrizeLimit.max; period = pendingPrizeLimit.period; }
  else { const p = child.prizes.find(x=>x.id===ctx.id); max = p ? p.limitMax : undefined; period = p ? p.limitPeriod : undefined; }
  limitDraft = { enabled: !!max, max: max||1, period: period||'day' };
  document.getElementById('limitPickerBody').innerHTML = limitEditorHTML();
  wireLimitEditor();
  document.getElementById('limitOverlay').classList.add('show');
}
function closeLimitPicker(){
  document.getElementById('limitOverlay').classList.remove('show');
  limitPickerContext = null;
}

function limitEditorHTML(){
  const enabledRow = `<div class="sched-type-row">
    <button class="sched-type-btn ${!limitDraft.enabled?'active':''}" data-lim-enabled="off">No Limit</button>
    <button class="sched-type-btn ${limitDraft.enabled?'active':''}" data-lim-enabled="on">Limited</button>
  </div>`;
  const detail = limitDraft.enabled ? `
    <div class="sched-sub-label">Max redemptions</div>
    <input id="limMax" class="settings-input" type="number" min="1" value="${limitDraft.max}" style="width:100%;">
    <div class="sched-sub-label">Per</div>
    <div class="sched-type-row">
      <button class="sched-type-btn ${limitDraft.period==='day'?'active':''}" data-lim-period="day">Day</button>
      <button class="sched-type-btn ${limitDraft.period==='week'?'active':''}" data-lim-period="week">Week</button>
    </div>
  ` : `<div class="sheet-sub" style="margin-top:8px;">This prize can be redeemed as often as it's affordable — no cap.</div>`;
  return `${enabledRow}${detail}`;
}

function wireLimitEditor(){
  document.querySelectorAll('[data-lim-enabled]').forEach(b=>{
    b.onclick=()=>{ limitDraft.enabled = b.dataset.limEnabled==='on'; document.getElementById('limitPickerBody').innerHTML = limitEditorHTML(); wireLimitEditor(); };
  });
  document.querySelectorAll('[data-lim-period]').forEach(b=>{
    b.onclick=()=>{ limitDraft.period = b.dataset.limPeriod; document.getElementById('limitPickerBody').innerHTML = limitEditorHTML(); wireLimitEditor(); };
  });
  const maxInp = document.getElementById('limMax');
  if(maxInp) maxInp.oninput=()=>{ limitDraft.max = parseInt(maxInp.value)||1; };
}

async function saveLimit(){
  const ctx = limitPickerContext;
  if(!ctx) return;
  const max = limitDraft.enabled ? (limitDraft.max||1) : undefined;
  const period = limitDraft.enabled ? limitDraft.period : undefined;
  closeLimitPicker();
  if(ctx.type==='newPrize'){
    pendingPrizeLimit = { max, period };
    const btn = document.getElementById('newPrizeLimitBtn');
    if(btn) btn.textContent = `🔁 ${limitSummaryText(max, period)}`;
    return;
  }
  if(!requireOnline()) return;
  const p = child.prizes.find(x=>x.id===ctx.id);
  if(!p) return;
  p.limitMax = max; p.limitPeriod = period;
  renderParentBody(); render();
  try{ await sb.from('prizes').update({limit_max:max||null, limit_period:period||null}).eq('id', p.id).throwOnError(); }catch(err){ handleSyncError(err); }
}

function parentSettingsHTML(){
  const tabs = `
    <div class="subtab-row">
      <button class="subtab-btn ${settingsTab==='profile'?'active':''}" data-stab="profile">Profile</button>
      <button class="subtab-btn ${settingsTab==='points'?'active':''}" data-stab="points">Points &amp; Time</button>
      <button class="subtab-btn ${settingsTab==='manual'?'active':''}" data-stab="manual">Manual Entries</button>
      <button class="subtab-btn ${settingsTab==='message'?'active':''}" data-stab="message">Message</button>
      <button class="subtab-btn ${settingsTab==='data'?'active':''}" data-stab="data">Data</button>
    </div>`;
  let body;
  if(settingsTab==='points') body = settingsPointsHTML();
  else if(settingsTab==='manual') body = settingsManualHTML();
  else if(settingsTab==='message') body = settingsMessageHTML();
  else if(settingsTab==='data') body = settingsDataHTML();
  else body = settingsProfileHTML();
  return tabs + body;
}

function settingsMessageHTML(){
  const pending = (child.notifications||[]).filter(n=>n.kind==='message');
  const pendingHTML = pending.length ? `
    <div class="sheet-sub" style="margin:14px 0 6px;">Still waiting to be seen:</div>
    ${pending.map(n=>`
      <div class="list-edit-item">
        <div class="item-row-main">
          <div style="flex:1; min-width:0; font-weight:700; font-size:14px;">"${n.message}"</div>
          <button class="icon-btn-sm" data-cancel-message="${n.id}">Cancel</button>
        </div>
      </div>
    `).join('')}
  ` : '';
  return `
    <div class="sheet-sub" style="margin-bottom:8px;">Send <b>${child.name}</b> a note as Pip — it shows up next time they open their view, the same way an approval celebration does.</div>
    <textarea id="pipMessageInput" class="child-name-input" rows="3" placeholder="You're doing great, keep it up!" style="resize:vertical; min-height:80px;"></textarea>
    <button class="btn btn-primary" id="sendPipMessageBtn" style="margin-top:10px;">Send as Pip</button>
    ${pendingHTML}
  `;
}

function settingsProfileHTML(){
  const rows = state.children.map(c=>`
    <div class="list-edit-item">
      <div class="item-row-main">
        <button class="icon-swatch" data-edit-child-avatar="${c.id}">${c.avatar}</button>
        <input class="label-edit" data-child-name="${c.id}" value="${c.name}">
        <button class="icon-btn-sm" data-child-del="${c.id}" ${state.children.length<=1?'disabled':''}>Remove</button>
      </div>
      <div class="item-row-meta">
        <input class="settings-input" data-child-pin="${c.id}" value="${c.pin||''}" maxlength="4" inputmode="numeric" placeholder="PIN">
      </div>
    </div>
  `).join('');
  return `
    <div class="settings-label">Children</div>
    <div class="sheet-sub" style="margin-bottom:8px;">Switch between kids using the tabs at the top of Home. Each child needs their own 4-digit PIN to switch into their view.</div>
    ${rows}
    <div class="add-row" style="flex-wrap:wrap;">
      <input id="newChildName" class="child-name-input" placeholder="Add a child" style="flex:1; margin-top:10px;">
      <button class="btn btn-primary" id="addChildBtn" style="margin-top:10px;">Add Child</button>
    </div>

    <div class="settings-row" style="margin-top:22px;">
      <div class="settings-label">Change Parent PIN</div>
    </div>
    <input class="child-name-input" id="newPinInput" placeholder="New 4-digit PIN" maxlength="4" inputmode="numeric">

    <button class="btn btn-primary" id="saveSettingsBtn" style="margin-top:18px;">Save PIN</button>
  `;
}

function settingsPointsHTML(){
  const openMinuteEntries = child.entries
    .filter(e=>e.status==='approved' && minutesGrantTotal(e)-(e.minutesUsed||0)>0);
  const logSection = openMinuteEntries.length ? `
    <div class="settings-row" style="margin-top:22px; flex-direction:column; align-items:stretch; gap:8px;">
      <div class="settings-label">Log screen time used</div>
      <div class="sheet-sub" style="margin:0 0 4px;">Deducts from the oldest earned minutes first, so ${child.name} can see what's left.</div>
      <div style="display:flex; gap:8px;">
        <input id="minutesLogAmount" class="settings-input" type="number" min="1" placeholder="min used" style="flex:1;">
        <button class="btn btn-primary" id="logMinutesBtn">Log Used</button>
      </div>
    </div>
  ` : '';
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
    ${logSection}
  `;
}

function settingsManualHTML(){
  if(manualEntryType==='chore') return manualChoreFormHTML();
  if(manualEntryType==='prize') return manualPrizeFormHTML();
  return settingsManualMenuHTML();
}

function settingsManualMenuHTML(){
  return `
    <div class="sheet-sub" style="margin-bottom:12px;">Add something that already happened, dated in the past. These apply right away — no approval needed.</div>
    <div class="manual-grid">
      <button class="manual-tile mt-chore" data-manual-open="chore">
        <div class="manual-tile-ic">✅</div>
        <div class="manual-tile-text">
          <div class="manual-tile-lbl">Activity</div>
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

function manualChoreFormHTML(){
  const choreOptions = child.chores.map(c=>`<option value="${c.id}">${c.emoji} ${c.label} (+${c.amount} ${c.currency==='points'?'pts':'min'})</option>`).join('');
  return `
    ${manualBackHTML()}
    <div class="settings-label" style="margin-bottom:4px;">Add an activity completion</div>
    <div class="sheet-sub" style="margin-bottom:8px;">For <b>${child.name}</b>. Credits points or minutes immediately, and checks any matching challenge — no approval needed.</div>
    ${child.chores.length===0 ? `<div class="sheet-sub">No activities set up yet.</div>` : `
    <div class="add-row" style="flex-wrap:wrap;">
      <select id="manualChoreSelect" class="child-name-input" style="flex:1 1 100%;">${choreOptions}</select>
      <input type="date" id="manualChoreDate" class="child-name-input" style="flex:1 1 100%; margin-top:8px;" max="${todayKey()}">
      <button class="btn btn-primary" id="addManualChoreBtn" style="margin-top:8px;">Add Activity Entry</button>
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

/* ============ DRAG-TO-REORDER ============ */
function wireDragReorder(containerEl, onReordered){
  if(!containerEl || containerEl.dataset.reorderWired) return;
  containerEl.dataset.reorderWired = '1';
  let dragEl = null, pointerId = null, offsetY = 0;

  function rows(){ return Array.from(containerEl.querySelectorAll(':scope > [data-reorder-id]')); }

  function onPointerMove(e){
    if(!dragEl || e.pointerId!==pointerId) return;
    e.preventDefault();
    const others = rows().filter(r=>r!==dragEl);
    const pointerY = e.clientY;
    let target = null, placeBefore = true;
    for(const row of others){
      const r = row.getBoundingClientRect();
      if(pointerY < r.top + r.height/2){ target = row; placeBefore = true; break; }
    }
    if(!target && others.length){ target = others[others.length-1]; placeBefore = false; }
    if(target){
      const beforeNode = placeBefore ? target : target.nextSibling;
      if(dragEl.nextSibling !== beforeNode) containerEl.insertBefore(dragEl, beforeNode);
    }
    dragEl.style.transform = 'none';
    const natural = dragEl.getBoundingClientRect().top;
    dragEl.style.transform = `translateY(${pointerY - offsetY - natural}px)`;
  }

  function onPointerUp(e){
    if(!dragEl || e.pointerId!==pointerId) return;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    dragEl.classList.remove('dragging');
    dragEl.style.transform = '';
    dragEl.style.position = '';
    dragEl.style.zIndex = '';
    const finishedEl = dragEl;
    dragEl = null; pointerId = null;
    onReordered(rows().map(r=>r.dataset.reorderId));
    void finishedEl;
  }

  containerEl.addEventListener('pointerdown', (e)=>{
    const handle = e.target.closest('[data-drag-handle]');
    if(!handle) return;
    const row = handle.closest('[data-reorder-id]');
    if(!row) return;
    e.preventDefault();
    dragEl = row; pointerId = e.pointerId;
    const rect = row.getBoundingClientRect();
    offsetY = e.clientY - rect.top;
    row.classList.add('dragging');
    row.style.position = 'relative';
    row.style.zIndex = '10';
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });
}

async function persistSortOrder(kind, list, orderedIds){
  const byId = new Map(list.map(x=>[x.id, x]));
  orderedIds.forEach((id, i)=>{ const item = byId.get(id); if(item) item.sortOrder = i; });
  list.sort(bySortOrder);
  render();
  try{
    await Promise.all(orderedIds.map((id, i)=>sb.from(kind).update({sort_order:i}).eq('id', id).throwOnError()));
  }catch(err){ handleSyncError(err); }
}

function wireParentBody(){
  document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveEntry(b.dataset.approve));
  document.querySelectorAll('[data-deny]').forEach(b=>b.onclick=()=>denyEntry(b.dataset.deny));
  document.querySelectorAll('[data-fulfill]').forEach(b=>b.onclick=()=>markFulfilled(b.dataset.fulfill));
  const bulkApproveBtn = document.getElementById('bulkApproveBtn');
  if(bulkApproveBtn) bulkApproveBtn.onclick=()=>bulkApproveAll();

  const choreReorderList = document.getElementById('choreReorderList');
  if(choreReorderList) wireDragReorder(choreReorderList, (ids)=>persistSortOrder('chores', child.chores, ids));
  const prizeReorderList = document.getElementById('prizeReorderList');
  if(prizeReorderList) wireDragReorder(prizeReorderList, (ids)=>persistSortOrder('prizes', child.prizes, ids));

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
  document.querySelectorAll('[data-chore-amount]').forEach(inp=>{
    inp.onchange=async ()=>{
      const c = child.chores.find(x=>x.id===inp.dataset.choreAmount);
      if(!c || !requireOnline()) return;
      c.amount = parseInt(inp.value)||0;
      try{ await sb.from('chores').update({amount:c.amount}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-chore-currency]').forEach(b=>{
    b.onclick=async ()=>{
      const c = child.chores.find(x=>x.id===b.dataset.choreCurrency);
      if(!c || !requireOnline()) return;
      c.currency = c.currency==='points' ? 'minutes' : 'points';
      renderParentBody(); render();
      try{ await sb.from('chores').update({currency:c.currency}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
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
  const newChoreCurrencyBtn = document.getElementById('newChoreCurrencyBtn');
  if(newChoreCurrencyBtn) newChoreCurrencyBtn.onclick=()=>{
    pendingChoreCurrency = pendingChoreCurrency==='points' ? 'minutes' : 'points';
    newChoreCurrencyBtn.textContent = pendingChoreCurrency==='points' ? 'Pts' : 'Min';
  };
  const addChoreBtn = document.getElementById('addChoreBtn');
  if(addChoreBtn) addChoreBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    const label = document.getElementById('newChoreLabel').value.trim();
    const amount = parseInt(document.getElementById('newChoreAmount').value)||0;
    const rep = document.getElementById('newChoreRepeat').checked;
    if(!label) return;
    const newChore = {id:uid(), label, emoji:pendingChoreIcon, amount, currency:pendingChoreCurrency, repeatable:rep, schedule:pendingChoreSchedule, sortOrder:nextSortOrder(child.chores)};
    child.chores.push(newChore);
    pendingChoreIcon = '⭐';
    pendingChoreSchedule = {type:'daily'};
    pendingChoreCurrency = 'points';
    renderParentBody(); render();
    try{ await sb.from('chores').insert({id:newChore.id, child_id:child.id, label:newChore.label, emoji:newChore.emoji, amount:newChore.amount, currency:newChore.currency, repeatable:newChore.repeatable, schedule:newChore.schedule, sort_order:newChore.sortOrder}).throwOnError(); }catch(err){ handleSyncError(err); }
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
  document.querySelectorAll('[data-prize-cost]').forEach(inp=>{
    inp.onchange=async ()=>{
      const p = child.prizes.find(x=>x.id===inp.dataset.prizeCost);
      if(!p || !requireOnline()) return;
      p.cost = parseInt(inp.value)||0;
      try{ await sb.from('prizes').update({cost:p.cost}).eq('id', p.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-prize-minutes]').forEach(inp=>{
    inp.onchange=async ()=>{
      const p = child.prizes.find(x=>x.id===inp.dataset.prizeMinutes);
      if(!p || !requireOnline()) return;
      p.grantsMinutes = parseInt(inp.value)||0;
      try{ await sb.from('prizes').update({grants_minutes:p.grantsMinutes}).eq('id', p.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  document.querySelectorAll('[data-edit-prize-limit]').forEach(b=>{
    b.onclick=()=>openLimitPicker({type:'edit', id:b.dataset.editPrizeLimit});
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
  const newPrizeLimitBtn = document.getElementById('newPrizeLimitBtn');
  if(newPrizeLimitBtn) newPrizeLimitBtn.onclick=()=>openLimitPicker({type:'newPrize'});
  const addPrizeBtn = document.getElementById('addPrizeBtn');
  if(addPrizeBtn) addPrizeBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    const label = document.getElementById('newPrizeLabel').value.trim();
    const cost = parseInt(document.getElementById('newPrizeCost').value)||0;
    const grantsMinutes = parseInt(document.getElementById('newPrizeMinutes').value)||0;
    if(!label) return;
    const newPrize = {id:uid(), label, emoji:pendingPrizeIcon, cost, grantsMinutes, limitMax:pendingPrizeLimit.max, limitPeriod:pendingPrizeLimit.period, sortOrder:nextSortOrder(child.prizes)};
    child.prizes.push(newPrize);
    pendingPrizeIcon = '🎁';
    pendingPrizeLimit = {max:undefined, period:'day'};
    renderParentBody(); render();
    try{ await sb.from('prizes').insert({id:newPrize.id, child_id:child.id, label:newPrize.label, emoji:newPrize.emoji, cost:newPrize.cost, grants_minutes:newPrize.grantsMinutes||null, limit_max:newPrize.limitMax||null, limit_period:newPrize.limitPeriod||null, sort_order:newPrize.sortOrder}).throwOnError(); }catch(err){ handleSyncError(err); }
  };

  document.querySelectorAll('[data-edit-challenge]').forEach(b=>{
    b.onclick=()=>openChallengePicker({type:'edit', id:b.dataset.editChallenge});
  });
  document.querySelectorAll('[data-challenge-del]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      const id = b.dataset.challengeDel;
      child.challenges = child.challenges.filter(c=>c.id!==id);
      renderParentBody(); render();
      try{ await sb.from('challenges').delete().eq('id', id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  const addChallengeBtn = document.getElementById('addChallengeBtn');
  if(addChallengeBtn) addChallengeBtn.onclick=()=>{
    if(child.chores.length===0){ toast('Add an activity first'); return; }
    openChallengePicker({type:'new'});
  };

  document.querySelectorAll('[data-edit-punishment]').forEach(b=>{
    b.onclick=()=>openPunishmentPicker({type:'edit', id:b.dataset.editPunishment});
  });
  document.querySelectorAll('[data-punishment-del]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      const id = b.dataset.punishmentDel;
      const removed = child.punishments.find(p=>p.id===id);
      child.punishments = child.punishments.filter(p=>p.id!==id);
      renderParentBody(); render();
      try{
        await sb.from('punishments').delete().eq('id', id).throwOnError();
        if(removed) await notifyPunishmentExpired(removed);
      }catch(err){ handleSyncError(err); }
    };
  });
  const addPunishmentBtn = document.getElementById('addPunishmentBtn');
  if(addPunishmentBtn) addPunishmentBtn.onclick=()=>openPunishmentPicker({type:'new'});

  document.querySelectorAll('[data-adjust]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      const [field, delta] = b.dataset.adjust.split(':');
      child[field] = Math.max(0, child[field] + parseInt(delta));
      renderParentBody(); render();
      try{ await sb.from('children').update({[field]: child[field]}).eq('id', child.id).throwOnError(); }catch(err){ handleSyncError(err); }
    };
  });
  const logMinutesBtn = document.getElementById('logMinutesBtn');
  if(logMinutesBtn) logMinutesBtn.onclick=()=>{
    const amountInput = document.getElementById('minutesLogAmount');
    const amt = parseInt(amountInput.value);
    if(!amt){ toast('Enter a valid number of minutes'); return; }
    logMinutesUsed(amt);
  };
  const sendPipMessageBtn = document.getElementById('sendPipMessageBtn');
  if(sendPipMessageBtn) sendPipMessageBtn.onclick=async ()=>{
    if(!requireOnline()) return;
    const input = document.getElementById('pipMessageInput');
    const text = input.value.trim();
    if(!text) return;
    const notif = { id:uid(), kind:'message', label:null, emoji:null, amount:null, currency:null, message:text, ts:Date.now() };
    child.notifications = child.notifications || [];
    child.notifications.push(notif);
    toast(`Message queued for ${child.name} 💌`);
    renderParentBody();
    try{ await sb.from('notifications').insert(toNotificationRow(notif, child.id)).throwOnError(); }catch(err){ handleSyncError(err); }
  };
  document.querySelectorAll('[data-cancel-message]').forEach(b=>{
    b.onclick=async ()=>{
      if(!requireOnline()) return;
      const id = b.dataset.cancelMessage;
      child.notifications = child.notifications.filter(n=>n.id!==id);
      renderParentBody();
      try{ await sb.from('notifications').delete().eq('id', id).throwOnError(); }catch(err){ handleSyncError(err); }
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
  document.querySelectorAll('[data-edit-child-avatar]').forEach(b=>{
    b.onclick=()=>openIconPicker({type:'childAvatar', id:b.dataset.editChildAvatar});
  });
  document.querySelectorAll('[data-child-pin]').forEach(inp=>{
    inp.onchange=async ()=>{
      const c = state.children.find(x=>x.id===inp.dataset.childPin);
      if(!c || !requireOnline()) return;
      const val = inp.value.trim();
      if(/^\d{4}$/.test(val)){
        c.pin = val;
        try{ await sb.from('children').update({pin:val}).eq('id', c.id).throwOnError(); }catch(err){ handleSyncError(err); }
      } else {
        inp.value = c.pin || '';
        toast('Enter a 4-digit PIN');
      }
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
    newChild.avatar = AVATAR_SET[state.children.length % AVATAR_SET.length];
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
      child.entries = [];
      child.punishments = [];
      child.points = 0;
      child.minutes = 0;
      child.goalPrizeId = null;
      ensureWeek(child);
      closeParent(); render();
      try{
        await sb.from('entries').delete().eq('child_id', child.id).throwOnError();
        await sb.from('punishments').delete().eq('child_id', child.id).throwOnError();
        await sb.from('children').update({points:0, minutes:0, goal_prize_id: null}).eq('id', child.id).throwOnError();
      }catch(err){ handleSyncError(err); }
    }
  };
}

/* ============ RENDER: main views ============ */
function render(){
  ensureWeek(child);
  document.getElementById('greetingName').textContent = `Hey, ${child.avatar} ${child.name}!`;
  document.getElementById('dateLine').textContent = new Date().toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'});
  document.getElementById('pointsVal').textContent = child.points;
  document.getElementById('minutesVal').textContent = child.minutes;

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
  schedulePunishmentExpiry();

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
    `<button class="child-pill ${c.id===child.id?'active':''}" data-switch-child="${c.id}">${c.avatar} ${c.name}</button>`
  ).join('');
  row.querySelectorAll('[data-switch-child]').forEach(b=>{
    b.onclick=()=>{
      const id = b.dataset.switchChild;
      if(id===child.id) return;
      openPin({type:'child', childId:id});
    };
  });
}

function savingsGoalHTML(){
  const goal = child.prizes.find(p=>p.id===child.goalPrizeId);
  if(!goal) return '';
  const pct = Math.max(4, Math.min(100, Math.round(child.points/goal.cost*100)));
  const met = child.points >= goal.cost;
  return `
    <div class="section-title">Savings Goal</div>
    <div class="goal-card">
      <div class="goal-top">
        <img class="goal-pip" src="pip-goal.png" alt="Pip">
        <div class="goal-info">
          <div class="goal-title">${goal.label}</div>
          <div class="goal-sub">${child.points}/${goal.cost} pts${met?' · Ready! 🎉':''}</div>
        </div>
      </div>
      <div class="goal-track"><div class="goal-fill" style="width:${pct}%"></div></div>
    </div>
  `;
}

function activePunishmentsHTML(){
  const active = activePunishments(child);
  if(!active.length) return '';
  const cards = active.map(p=>{
    const blocks = [p.blockPoints&&'🪙 points', p.blockMinutes&&'⏰ time', p.blockPrizes&&'🎁 prizes'].filter(Boolean).join(' · ');
    return `
      <div class="punishment-card">
        <img class="punishment-pip" src="pip-pause.png" alt="Pip">
        <div class="punishment-info">
          <div class="punishment-label">${p.label}</div>
          <div class="punishment-meta">${blocks} paused — ${formatRemaining(p.endsAt-Date.now())}</div>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="section-title">Active Punishments</div>
    <div class="punishment-list">${cards}</div>
  `;
}

function activeChallengesHTML(){
  const active = (child.challenges||[]).filter(ch=>isChallengeActive(ch, todayKey()));
  if(!active.length) return '';
  const cards = active.map(ch=>{
    const progress = challengeProgress(child, ch);
    const done = progress>=ch.target;
    const cur = ch.currency==='points' ? 'pts' : 'min';
    const daysHTML = ch.type==='onetime' ? `<div class="challenge-days">ends ${ch.endDate}</div>` : '';
    return `
      <div class="challenge-card ${done?'done':''}">
        <img class="challenge-pip" src="pip-streak.png" alt="Pip">
        <div class="challenge-info">
          <div class="challenge-title">${ch.label}</div>
          <div class="challenge-progress">${progress}/${ch.target} · +${ch.bonus} ${cur}${done?' ✓':''}</div>
        </div>
        ${daysHTML}
      </div>`;
  }).join('');
  return `
    <div class="section-title">Active Challenges</div>
    <div class="challenge-list">${cards}</div>
  `;
}

function homeHTML(){
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
    if(!statusHTML && isChoreBlocked(child, c)){ cls+=' blocked'; statusHTML='<div class="chore-status blocked">🔒 Blocked</div>'; }
    return `
      <button class="${cls}" data-chore="${c.id}">
        ${statusHTML}
        <div class="chore-emoji">${c.emoji}</div>
        <div class="chore-label">${c.label}</div>
        <div class="chore-points">+${c.amount} ${c.currency==='points'?'pts':'min'}</div>
      </button>`;
  }).join('');

  return `
    ${savingsGoalHTML()}
    ${activePunishmentsHTML()}
    ${activeChallengesHTML()}
    <div class="section-title">Today's Activities</div>
    <div class="grid">${choreCards}</div>
  `;
}

function prizesHTML(){
  if(child.prizes.length===0){
    return `<div class="empty-state"><div class="e">🎁</div>No prizes set up yet.</div>`;
  }
  const blocked = isBlocked(child, 'blockPrizes');
  const banner = blocked ? `<div class="punishment-notice">🚫 Prize redemption is paused right now</div>` : '';
  const cards = child.prizes.map(p=>{
    const pending = child.entries.some(e=>e.kind==='redeem' && e.refId===p.id && e.status==='pending');
    const affordable = child.points >= p.cost;
    const isBlockedNow = blocked && !pending;
    const limitReached = !pending && isPrizeLimitReached(child, p);
    const limitText = p.limitMax ? ` · ${redeemCountInPeriod(child, p.id, p.limitPeriod||'day')}/${p.limitMax} per ${p.limitPeriod==='week'?'wk':'day'}` : '';
    const isGoal = child.goalPrizeId===p.id;
    return `
    <div class="prize-card ${pending?'requested':''} ${(isBlockedNow||limitReached)?'blocked':''}">
      <div class="prize-emoji">${p.emoji}</div>
      <div class="prize-info">
        <div class="prize-title">${p.label}</div>
        <div class="prize-cost">${p.cost} pts${limitText}</div>
      </div>
      <button class="goal-toggle-btn ${isGoal?'active':''}" data-goal-toggle="${p.id}" title="${isGoal?'Remove as savings goal':'Set as savings goal'}">🎯</button>
      <button class="prize-btn ${pending?'requested':''}" data-prize="${p.id}" ${(isBlockedNow || limitReached || (!affordable && !pending))?'disabled':''}>
        ${pending ? 'Waiting…' : isBlockedNow ? 'Blocked 🚫' : limitReached ? 'Limit Reached' : affordable ? 'Redeem' : 'Need more'}
      </button>
    </div>`;
  }).join('');
  return `${banner}<div class="prize-list">${cards}</div>`;
}

function historyItemRowHTML(e){
  let amtClass='wait', amtText='';
  const cur = e.currency==='points'?'pts':'min';
  const sign = e.kind==='redeem' ? '−' : '+';
  if(e.status==='approved'){ amtClass = e.kind==='redeem'?'neg':'pos'; amtText=`${sign}${e.amount} ${cur}`; }
  else if(e.status==='pending'){ amtClass='wait'; amtText=`${sign}${e.amount} ${cur} · pending`; }
  else { amtClass='deny'; amtText=`${sign}${e.amount} ${cur} · denied`; }
  let subMeta = '';
  if(e.status==='approved' && e.kind==='redeem'){
    if(!e.fulfilled){
      subMeta = ` · <span style="color:var(--coral);">not delivered yet</span>`;
    } else if(e.grantsMinutes>0){
      subMeta = (e.minutesUsed||0)>0
        ? ` · ${e.minutesUsed} of ${e.grantsMinutes} min used`
        : ` · +${e.grantsMinutes} min ready to use`;
    }
  } else if(e.status==='approved' && e.currency==='minutes' && (e.minutesUsed||0)>0){
    subMeta = ` · ${e.minutesUsed} of ${e.amount} min used`;
  }
  return `
  <div class="history-item">
    <div class="history-emoji">${e.emoji}</div>
    <div class="history-info">
      <div class="history-label">${e.label}</div>
      <div class="history-meta">${timeAgo(e.ts)}${subMeta}</div>
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
  document.querySelectorAll('[data-prize]').forEach(b=>{
    b.onclick=(ev)=>requestPrize(b.dataset.prize, ev);
  });
  document.querySelectorAll('[data-goal-toggle]').forEach(b=>{
    b.onclick=()=>toggleSavingsGoal(b.dataset.goalToggle);
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

/* ============ FEEDBACK FX ============ */
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove('show'), 2200);
}

function showUpdateToast(){
  document.getElementById('updateToast').classList.add('show');
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

/* ============ PIP NOTIFICATIONS ============ */
function deliverPendingNotifications(){
  if(!child || !child.notifications || !child.notifications.length) return;
  if(kioskLocked) return;
  const parentOverlay = document.getElementById('parentOverlay');
  if(parentOverlay && parentOverlay.classList.contains('show')) return;
  if(document.getElementById('pipNotifyOverlay').classList.contains('show')) return;
  showNextNotification();
}

function showNextNotification(){
  if(!child.notifications.length){ document.getElementById('pipNotifyOverlay').classList.remove('show'); return; }
  const n = child.notifications[0];
  const img = document.getElementById('pipNotifyImg');
  const title = document.getElementById('pipNotifyTitle');
  const body = document.getElementById('pipNotifyBody');
  if(n.kind==='message'){
    img.src = 'pip-message.png';
    title.textContent = 'A message from Pip';
    body.textContent = n.message;
  } else if(n.kind==='comeback'){
    img.src = 'pip-comeback.png';
    title.textContent = 'Welcome back!';
    body.textContent = `Your "${n.label}" pause is over — let's keep going, ${child.name}!`;
  } else {
    img.src = 'pip-celebration.png';
    title.textContent = `${n.emoji||'🎉'} ${n.label} approved!`.trim();
    if(n.currency){
      const cur = n.currency==='points' ? 'pts' : 'min';
      body.textContent = `+${n.amount} ${cur} — nice work, ${child.name}!`;
    } else {
      body.textContent = `You got it, ${child.name}! Ask a parent when it's ready.`;
    }
  }
  document.getElementById('pipNotifyOverlay').classList.add('show');
  if(n.kind==='celebration') burstConfetti();
}

async function dismissNotification(){
  if(!child.notifications.length) return;
  const n = child.notifications.shift();
  if(child.notifications.length){ showNextNotification(); }
  else { document.getElementById('pipNotifyOverlay').classList.remove('show'); }
  try{ await sb.from('notifications').delete().eq('id', n.id).throwOnError(); }catch(err){ handleSyncError(err); }
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
    deliverPendingNotifications();
    scheduleMidnightRefresh();
    subscribeRealtime();
    startAppIdleWatch();
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
  b.addEventListener('click', ()=>{ view=b.dataset.view; render(); });
});
document.getElementById('lockBtn').addEventListener('click', ()=>openPin({type:'parent'}));
document.getElementById('exitProfileBtn').addEventListener('click', ()=>showLockScreen());
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
document.getElementById('challengeClose').addEventListener('click', closeChallengePicker);
document.getElementById('challengeOverlay').addEventListener('click', (e)=>{ if(e.target.id==='challengeOverlay') closeChallengePicker(); });
document.getElementById('challengeSaveBtn').addEventListener('click', saveChallenge);
document.getElementById('punishmentClose').addEventListener('click', closePunishmentPicker);
document.getElementById('punishmentOverlay').addEventListener('click', (e)=>{ if(e.target.id==='punishmentOverlay') closePunishmentPicker(); });
document.getElementById('punishmentSaveBtn').addEventListener('click', savePunishment);
document.getElementById('limitClose').addEventListener('click', closeLimitPicker);
document.getElementById('limitOverlay').addEventListener('click', (e)=>{ if(e.target.id==='limitOverlay') closeLimitPicker(); });
document.getElementById('limitSaveBtn').addEventListener('click', saveLimit);
document.getElementById('undoToastBtn').addEventListener('click', performUndo);
document.getElementById('pipNotifyDismiss').addEventListener('click', dismissNotification);
document.getElementById('pipNotifyOverlay').addEventListener('click', (e)=>{ if(e.target.id==='pipNotifyOverlay') dismissNotification(); });

let view = 'home';
let pinContext = null;   // {type:'parent'} | {type:'child', childId}
let pinBuffer = '';
let activeParentTab = 'approve';
let historyMode = 'week';     // 'week' | 'month'
let historyWeekOffset = 0;    // 0 = this week, -1 = last week, ...
let historyMonthOffset = 0;   // 0 = this month, -1 = last month, ...
let pendingChoreIcon = '⭐';
let pendingPrizeIcon = '🎁';
let pendingPrizeLimit = {max:undefined, period:'day'};
let pendingChoreSchedule = {type:'daily'};
let pendingChoreCurrency = 'points';
let iconPickerContext = null; // {type:'newChore'|'newPrize'|'editChore'|'editPrize', id?}
let schedulePickerContext = null; // {type:'newChore'|'editChore', id?}
let scheduleDraft = {type:'daily'};
let challengePickerContext = null; // {type:'new'|'edit', id?}
let challengeDraft = {type:'recurring'};
let punishmentPickerContext = null; // {type:'new'|'edit', id?}
let punishmentDraft = {durationUnit:'days'};
let limitPickerContext = null; // {type:'newPrize'|'edit', id?}
let limitDraft = {enabled:false, period:'day'};
let settingsTab = 'profile'; // 'profile' | 'points' | 'manual' | 'data'
let manualEntryType = null; // null | 'chore' | 'prize'

boot();

/* register service worker */
if('serviceWorker' in navigator){
  // If the page is already controlled by a SW from a previous visit, a later
  // controllerchange means a new version just took over — worth telling the
  // user. On a fresh install there's no prior controller, so that first
  // claim never triggers the toast.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(hadController) showUpdateToast();
  });
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      // Kiosk tablets can stay open for days without a normal navigation,
      // which is usually what triggers the browser's own update check.
      setInterval(()=>reg.update().catch(()=>{}), 60*60*1000);
    }).catch(()=>{});
  });
  document.getElementById('updateToastBtn').addEventListener('click', ()=>location.reload());
}

/* shake keyframes injected (used by pin dots on wrong entry) */
const styleTag = document.createElement('style');
styleTag.textContent = `@keyframes shake{ 10%,90%{transform:translateX(-2px);} 20%,80%{transform:translateX(4px);} 30%,50%,70%{transform:translateX(-8px);} 40%,60%{transform:translateX(8px);} }`;
document.head.appendChild(styleTag);
