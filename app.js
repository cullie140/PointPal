/* ============ POINTPAL — app logic ============ */

const STORAGE_KEY = 'pointpal_v1';
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

const DEFAULT_STATE = {
  childName: 'Champ',
  points: 0,
  minutes: 0,
  weekStart: null,          // ISO date (Monday) this week's streak is counted against
  pin: '1234',
  chores: [
    { id:'dishes',   label:'Dishes',             emoji:'🍽️', points:5,  repeatable:false },
    { id:'brush',    label:'Brush Teeth',        emoji:'🪥', points:5,  repeatable:false },
    { id:'wipe',     label:'Wipe Butt',          emoji:'🧻', points:5,  repeatable:true  },
    { id:'shower',   label:'Shower',             emoji:'🚿', points:10, repeatable:false },
    { id:'dressed',  label:'Get Up & Dressed',   emoji:'👕', points:10, repeatable:false },
    { id:'worksheet',label:'Worksheet',          emoji:'📝', points:1,  repeatable:true  },
  ],
  prizes: [
    { id:'p5min',    label:'5 Minutes Electronics',   emoji:'⏱️', cost:20,   grantsMinutes:5 },
    { id:'treat',    label:'Extra Treat or Dessert',  emoji:'🍪', cost:100 },
    { id:'icecream', label:'Go Out for Ice Cream',    emoji:'🍦', cost:250 },
    { id:'toy',      label:'$5–$10 Toy',              emoji:'🧸', cost:250 },
    { id:'outing',   label:'Fun Outing',              emoji:'🎡', cost:500 },
    { id:'fish',     label:'Fish',                    emoji:'🐠', cost:1000 },
  ],
  entries: []   // {id, ts, kind:'chore'|'school'|'bonus'|'redeem', refId, label, emoji, currency:'points'|'minutes', amount, status:'pending'|'approved'|'denied', grantsMinutes?}
};

let state = loadState();
let view = 'home';
let pinContext = null;   // 'unlock' -> opens parent overlay
let pinBuffer = '';
let activeParentTab = 'approve';
let historyMode = 'week';     // 'week' | 'month'
let historyWeekOffset = 0;    // 0 = this week, -1 = last week, ...
let historyMonthOffset = 0;   // 0 = this month, -1 = last month, ...
let pendingChoreIcon = '⭐';
let pendingPrizeIcon = '🎁';
let iconPickerContext = null; // {type:'newChore'|'newPrize'|'editChore'|'editPrize', id?}

/* ---------- persistence ---------- */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_STATE), parsed);
  }catch(e){
    return structuredClone(DEFAULT_STATE);
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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

function scheduleMidnightRefresh(){
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 5);
  setTimeout(()=>{
    render();
    scheduleMidnightRefresh();
  }, next.getTime()-now.getTime());
}
function ensureWeek(){
  const wk = weekKeyFor(new Date());
  if(state.weekStart !== wk){
    state.weekStart = wk;
    saveState();
  }
}

/* ---------- derived helpers ---------- */
function entriesToday(kind, refId){
  const tk = todayKey();
  return state.entries.filter(e => e.kind===kind && (refId===undefined || e.refId===refId) && dateKey(new Date(e.ts))===tk);
}
function entriesForDay(dk){
  return state.entries.filter(e => dateKey(new Date(e.ts))===dk).sort((a,b)=>a.ts-b.ts);
}
function goodDaysThisWeekApproved(){
  const wk = state.weekStart;
  return state.entries.filter(e => e.kind==='school' && e.status==='approved' && weekKeyFor(new Date(e.ts))===wk).length;
}
function bonusAlreadyGrantedThisWeek(){
  const wk = state.weekStart;
  return state.entries.some(e => e.kind==='bonus' && weekKeyFor(new Date(e.ts))===wk);
}
function pendingEntries(){
  return state.entries.filter(e=>e.status==='pending').sort((a,b)=>a.ts-b.ts);
}

/* ---------- id gen ---------- */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

/* ============ ACTIONS ============ */
function requestChore(choreId, evt){
  const chore = state.chores.find(c=>c.id===choreId);
  if(!chore) return;
  if(!chore.repeatable){
    const already = entriesToday('chore', choreId).some(e=>e.status!=='denied');
    if(already){ toast(`${chore.label} is already done for today! 🎉`); return; }
  }
  state.entries.push({
    id:uid(), ts:Date.now(), kind:'chore', refId:choreId,
    label:chore.label, emoji:chore.emoji, currency:'points', amount:chore.points, status:'pending'
  });
  saveState();
  spawnFloaterAt(evt, `+${chore.points} pts (pending)`, 'var(--gold-deep)');
  toast(`Sent "${chore.label}" for approval ⏳`);
  render();
}

function requestSchoolDay(evt){
  ensureWeek();
  const already = entriesToday('school').some(e=>e.status!=='denied');
  if(already){ toast('Already marked for today! 🌟'); return; }
  state.entries.push({
    id:uid(), ts:Date.now(), kind:'school', refId:'school',
    label:'Good Day at School', emoji:'🎒', currency:'minutes', amount:15, status:'pending'
  });
  saveState();
  spawnFloaterAt(evt, `+15 min (pending)`, 'var(--gold-deep)');
  toast('Sent for approval ⏳');
  render();
}

function requestPrize(prizeId, evt){
  const prize = state.prizes.find(p=>p.id===prizeId);
  if(!prize) return;
  const already = state.entries.some(e=>e.kind==='redeem' && e.refId===prizeId && e.status==='pending');
  if(already){ toast('Already waiting on approval for that one!'); return; }
  state.entries.push({
    id:uid(), ts:Date.now(), kind:'redeem', refId:prizeId,
    label:prize.label, emoji:prize.emoji, currency:'points', amount:prize.cost, status:'pending',
    grantsMinutes: prize.grantsMinutes || 0
  });
  saveState();
  spawnFloaterAt(evt, `Requested!`, 'var(--coral-deep)');
  toast(`Asked to redeem "${prize.label}" 🙋`);
  render();
}

function approveEntry(id){
  const e = state.entries.find(x=>x.id===id);
  if(!e || e.status!=='pending') return;
  e.status='approved';

  if(e.kind==='chore' || e.kind==='school' || e.kind==='bonus'){
    if(e.currency==='points') state.points += e.amount;
    else state.minutes += e.amount;
    burstConfetti();
  } else if(e.kind==='redeem'){
    state.points -= e.amount;
    if(e.grantsMinutes) state.minutes += e.grantsMinutes;
    burstConfetti();
  }

  if(e.kind==='school'){
    ensureWeek();
    const goodDays = goodDaysThisWeekApproved();
    if(goodDays>=5 && !bonusAlreadyGrantedThisWeek()){
      state.entries.push({
        id:uid(), ts:Date.now(), kind:'bonus', refId:'bonus',
        label:'5-Day Streak Bonus!', emoji:'🏆', currency:'minutes', amount:120, status:'pending'
      });
      toast('5 good days this week — bonus sent for approval! 🏆');
    }
  }
  saveState();
  render();
}

function denyEntry(id){
  const e = state.entries.find(x=>x.id===id);
  if(!e || e.status!=='pending') return;
  e.status='denied';
  saveState();
  render();
}

/* ============ PIN FLOW ============ */
function openPin(ctx){
  pinContext = ctx;
  pinBuffer='';
  renderPinDots();
  document.getElementById('pinOverlay').classList.add('show');
}
function closePin(){
  document.getElementById('pinOverlay').classList.remove('show');
  pinBuffer='';
}
function pressPinKey(k){
  if(k==='del'){ pinBuffer = pinBuffer.slice(0,-1); renderPinDots(); return; }
  if(pinBuffer.length>=4) return;
  pinBuffer += k;
  renderPinDots();
  if(pinBuffer.length===4){
    setTimeout(()=>{
      if(pinBuffer===state.pin){
        closePin();
        if(pinContext==='unlock'){ openParent(); }
      } else {
        const dots = document.getElementById('pinDots');
        dots.style.animation='none';
        void dots.offsetWidth;
        dots.style.animation='shake 400ms ease';
        pinBuffer='';
        renderPinDots();
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
function openParent(){
  activeParentTab='approve';
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
  else body.innerHTML = parentSettingsHTML();
  wireParentBody();
}

function parentApproveHTML(){
  const pend = pendingEntries();
  if(pend.length===0){
    return `<div class="empty-state"><div class="e">✅</div>Nothing waiting on you right now.</div>`;
  }
  return pend.map(e=>{
    const sign = e.kind==='redeem' ? '−' : '+';
    const cur = e.currency==='points' ? 'pts' : 'min';
    let extra = '';
    if(e.kind==='redeem'){
      const after = state.points - e.amount;
      extra = `<div class="approval-meta">Balance after approving: <b style="color:${after<0?'var(--danger)':'var(--ink)'}">${after} pts</b></div>`;
    }
    return `
    <div class="approval-item">
      <div class="approval-top">
        <div class="approval-label">${e.emoji} ${e.label}</div>
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
  const rows = state.chores.map(c=>`
    <div class="list-edit-item">
      <button class="icon-swatch" data-edit-chore-icon="${c.id}">${c.emoji}</button>
      <span>${c.label}</span>
      <label style="display:flex; align-items:center; gap:5px; font-weight:700; font-size:12px; color:var(--ink-soft); white-space:nowrap;">
        <input type="checkbox" data-chore-repeat="${c.id}" ${c.repeatable?'checked':''}> Repeatable
      </label>
      <input class="settings-input" type="number" min="0" data-chore-points="${c.id}" value="${c.points}">
      <button class="icon-btn-sm" data-chore-del="${c.id}">Remove</button>
    </div>
  `).join('');
  return `
    <div class="sheet-sub">Points update live. Tap an icon to change it. Removing a chore doesn't erase past history.</div>
    ${rows}
    <div class="add-row" style="flex-wrap:wrap;">
      <button class="icon-swatch" id="newChoreIconBtn" style="margin-top:10px;">${pendingChoreIcon}</button>
      <input id="newChoreLabel" class="child-name-input" placeholder="New chore name" style="flex:1; margin-top:10px;">
      <input id="newChorePoints" class="settings-input" type="number" placeholder="pts" style="margin-top:8px;">
      <label style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; margin-top:8px;">
        <input type="checkbox" id="newChoreRepeat"> Repeatable
      </label>
      <button class="btn btn-primary" id="addChoreBtn" style="margin-top:8px;">Add Chore</button>
    </div>
  `;
}

function parentPrizesHTML(){
  const rows = state.prizes.map(p=>`
    <div class="list-edit-item">
      <button class="icon-swatch" data-edit-prize-icon="${p.id}">${p.emoji}</button>
      <span>${p.label}${p.grantsMinutes?` <small style="color:var(--coral-deep); font-weight:800;">(+${p.grantsMinutes} min)</small>`:''}</span>
      <input class="settings-input" type="number" min="0" data-prize-cost="${p.id}" value="${p.cost}">
      <button class="icon-btn-sm" data-prize-del="${p.id}">Remove</button>
    </div>
  `).join('');
  return `
    <div class="sheet-sub">Costs update live. Tap an icon to change it. Add "grants minutes" prizes for electronics-time purchases.</div>
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
function pickIcon(emoji){
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
    const c = state.chores.find(x=>x.id===ctx.id);
    if(c){ c.emoji = emoji; saveState(); render(); }
  } else if(ctx.type==='editPrize'){
    const p = state.prizes.find(x=>x.id===ctx.id);
    if(p){ p.emoji = emoji; saveState(); render(); }
  }
}

function parentSettingsHTML(){
  return `
    <div class="settings-row">
      <div class="settings-label">Child's name</div>
    </div>
    <input class="child-name-input" id="childNameInput" value="${state.childName}">

    <div class="settings-row" style="margin-top:18px;">
      <div class="settings-label">Change PIN</div>
    </div>
    <input class="child-name-input" id="newPinInput" placeholder="New 4-digit PIN" maxlength="4" inputmode="numeric">

    <div class="settings-row" style="margin-top:18px;">
      <div class="settings-label">Points balance</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="icon-btn-sm" data-adjust="points:-10">−10</button>
        <b>${state.points}</b>
        <button class="icon-btn-sm" data-adjust="points:10">+10</button>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-label">Screen time (min)</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="icon-btn-sm" data-adjust="minutes:-5">−5</button>
        <b>${state.minutes}</b>
        <button class="icon-btn-sm" data-adjust="minutes:5">+5</button>
      </div>
    </div>

    <button class="btn btn-primary" id="saveSettingsBtn" style="margin-top:18px;">Save Settings</button>
    <button class="btn btn-deny" id="resetAllBtn" style="margin-top:10px;">Reset All Data</button>
  `;
}

function wireParentBody(){
  document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveEntry(b.dataset.approve));
  document.querySelectorAll('[data-deny]').forEach(b=>b.onclick=()=>denyEntry(b.dataset.deny));

  document.querySelectorAll('[data-chore-points]').forEach(inp=>{
    inp.onchange=()=>{
      const c = state.chores.find(x=>x.id===inp.dataset.chorePoints);
      if(c){ c.points = parseInt(inp.value)||0; saveState(); }
    };
  });
  document.querySelectorAll('[data-chore-repeat]').forEach(inp=>{
    inp.onchange=()=>{
      const c = state.chores.find(x=>x.id===inp.dataset.choreRepeat);
      if(c){ c.repeatable = inp.checked; saveState(); render(); }
    };
  });
  document.querySelectorAll('[data-chore-del]').forEach(b=>{
    b.onclick=()=>{
      state.chores = state.chores.filter(c=>c.id!==b.dataset.choreDel);
      saveState(); renderParentBody(); render();
    };
  });
  document.querySelectorAll('[data-edit-chore-icon]').forEach(b=>{
    b.onclick=()=>openIconPicker({type:'editChore', id:b.dataset.editChoreIcon});
  });
  const newChoreIconBtn = document.getElementById('newChoreIconBtn');
  if(newChoreIconBtn) newChoreIconBtn.onclick=()=>openIconPicker({type:'newChore'});
  const addChoreBtn = document.getElementById('addChoreBtn');
  if(addChoreBtn) addChoreBtn.onclick=()=>{
    const label = document.getElementById('newChoreLabel').value.trim();
    const pts = parseInt(document.getElementById('newChorePoints').value)||0;
    const rep = document.getElementById('newChoreRepeat').checked;
    if(!label) return;
    state.chores.push({id:uid(), label, emoji:pendingChoreIcon, points:pts, repeatable:rep});
    pendingChoreIcon = '⭐';
    saveState(); renderParentBody(); render();
  };

  document.querySelectorAll('[data-prize-cost]').forEach(inp=>{
    inp.onchange=()=>{
      const p = state.prizes.find(x=>x.id===inp.dataset.prizeCost);
      if(p){ p.cost = parseInt(inp.value)||0; saveState(); }
    };
  });
  document.querySelectorAll('[data-prize-del]').forEach(b=>{
    b.onclick=()=>{
      state.prizes = state.prizes.filter(p=>p.id!==b.dataset.prizeDel);
      saveState(); renderParentBody(); render();
    };
  });
  document.querySelectorAll('[data-edit-prize-icon]').forEach(b=>{
    b.onclick=()=>openIconPicker({type:'editPrize', id:b.dataset.editPrizeIcon});
  });
  const newPrizeIconBtn = document.getElementById('newPrizeIconBtn');
  if(newPrizeIconBtn) newPrizeIconBtn.onclick=()=>openIconPicker({type:'newPrize'});
  const addPrizeBtn = document.getElementById('addPrizeBtn');
  if(addPrizeBtn) addPrizeBtn.onclick=()=>{
    const label = document.getElementById('newPrizeLabel').value.trim();
    const cost = parseInt(document.getElementById('newPrizeCost').value)||0;
    const mins = parseInt(document.getElementById('newPrizeMinutes').value)||0;
    if(!label) return;
    state.prizes.push({id:uid(), label, emoji:pendingPrizeIcon, cost, grantsMinutes:mins||undefined});
    pendingPrizeIcon = '🎁';
    saveState(); renderParentBody(); render();
  };

  document.querySelectorAll('[data-adjust]').forEach(b=>{
    b.onclick=()=>{
      const [field, delta] = b.dataset.adjust.split(':');
      state[field] = Math.max(0, state[field] + parseInt(delta));
      saveState(); renderParentBody(); render();
    };
  });

  const saveBtn = document.getElementById('saveSettingsBtn');
  if(saveBtn) saveBtn.onclick=()=>{
    const name = document.getElementById('childNameInput').value.trim();
    const newPin = document.getElementById('newPinInput').value.trim();
    if(name) state.childName = name;
    if(newPin.length===4 && /^\d{4}$/.test(newPin)) state.pin = newPin;
    saveState(); render();
    toast('Settings saved ✅');
  };
  const resetBtn = document.getElementById('resetAllBtn');
  if(resetBtn) resetBtn.onclick=()=>{
    if(confirm('This will erase all points, minutes, and history. Are you sure?')){
      state = structuredClone(DEFAULT_STATE);
      ensureWeek();
      saveState(); closeParent(); render();
    }
  };
}

/* ============ RENDER: main views ============ */
function render(){
  ensureWeek();
  document.getElementById('greetingName').textContent = `Hey, ${state.childName}! 👋`;
  document.getElementById('dateLine').textContent = new Date().toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'});
  document.getElementById('pointsVal').textContent = state.points;
  document.getElementById('minutesVal').textContent = state.minutes;

  const pct = Math.max(6, (state.points % 1000)/1000*100);
  document.getElementById('pointsWater').style.height = pct+'%';
  refreshFishTank();

  const pend = pendingEntries().length;
  const badge = document.getElementById('pendingBadge');
  if(pend>0){ badge.style.display='block'; badge.textContent=pend; } else { badge.style.display='none'; }

  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===view));

  const el = document.getElementById('mainContent');
  if(view==='home') el.innerHTML = homeHTML();
  else if(view==='prizes') el.innerHTML = prizesHTML();
  else el.innerHTML = historyHTML();
  wireMainContent();

  if(document.getElementById('parentOverlay').classList.contains('show')){
    renderParentBody();
  }
}

function homeHTML(){
  const schoolToday = entriesToday('school')[0];
  const schoolStatus = schoolToday ? schoolToday.status : null;
  const goodDays = goodDaysThisWeekApproved();
  const streakDots = Array.from({length:5}).map((_,i)=>`<div class="streak-dot ${i<goodDays?'filled':''}"></div>`).join('');

  const choreCards = state.chores.map(c=>{
    const todays = entriesToday('chore', c.id);
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
  if(state.prizes.length===0){
    return `<div class="empty-state"><div class="e">🎁</div>No prizes set up yet.</div>`;
  }
  const cards = state.prizes.map(p=>{
    const pending = state.entries.some(e=>e.kind==='redeem' && e.refId===p.id && e.status==='pending');
    const affordable = state.points >= p.cost;
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
  const entries = entriesForDay(dk);
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
    const approved = entriesForDay(dk).filter(e=>e.status==='approved');
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
  const entries = entriesForDay(dk);
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

buildPinPad();
ensureWeek();
render();
scheduleMidnightRefresh();

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
