(() => {
  const seed = window.DairySampleData;
  const STORAGE_KEY = 'our-dairy-farm-phase1-demo-v1';
  const TODAY = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
  const localDatabase = window.DairySupabaseConfig?.localDevelopment === true;
  const milkMath = window.DairyMilkCalculations;
  const money = n => `₹${Number(n || 0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const litres = n => `${Number(n || 0).toFixed(3)} L`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateLabel = (value, options={day:'2-digit',month:'short',year:'numeric'}) => new Intl.DateTimeFormat('en-IN', options).format(new Date(`${value}T12:00:00`));
  const getBase = () => ({milkRecords:[],cattle:[],cycles:[],payments:[],farmSettings:null});
  let data, savedLocal={};
  try {
    savedLocal=JSON.parse(localStorage.getItem(STORAGE_KEY))||{};
    if(Object.hasOwn(savedLocal,'milkRecords')){
      delete savedLocal.milkRecords;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(savedLocal));
    }
    if(Object.hasOwn(savedLocal,'cattle')){
      delete savedLocal.cattle;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(savedLocal));
    }
    data={...getBase(),...savedLocal};
  } catch { data = getBase(); }
  // Farm records are always fetched from Supabase and never restored from or written to localStorage.
  data.milkRecords = [];
  data.cattle = [];
  data.cycles=[];
  data.payments=[];
  data.farmSettings=null;
  const el = id => document.getElementById(id);
  let activeFilter = 'all', cattleFilter = 'all', toastTimer;
  let authSession = null;
  let reportType='daily';
  let selectedRestore=null;
  const reportResources={milk:'locked',billing:'locked',cattle:'locked',settings:'locked'};
  const toast = msg => { const node=el('toast'); node.textContent=msg; node.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),2600); };
  const sum = (list,key) => list.reduce((total,item)=>total+Number(item[key]||0),0);
  const sumMoney = list => list.reduce((cents,item)=>cents+Math.round(Number(item.amount||0)*100),0)/100;
  const roundMoney = value => Math.round((Number(value)||0)*100)/100;
  const recordBy = (date,session) => data.milkRecords.find(r=>r.date===date&&r.session===session);
  const dayState = date => milkMath.dayState(data.milkRecords, date);
  const allCycleTotals = cycle => {
    return milkMath.cycleTotals(cycle,data.milkRecords,data.payments);
  };
  const currentCycle = () => data.cycles.find(c=>TODAY>=c.start&&TODAY<=c.end)||null;
  const formatDateInput = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const comparisonRows = selected => milkMath.comparisonRows(data.milkRecords, selected);
  function renderComparison(){
    const selected=el('compare-date').value||TODAY;
    el('compare-date-large').value=selected;
    const rows=comparisonRows(selected);
    el('comparison-compact').innerHTML=rows.slice(1).map(row=>{
      let value=row.date?(row.state.has?`${row.state.total.toFixed(1)} L`:'No record'):'No matching date';
      let change=row.diff==null?'':`${row.diff>0?'+':''}${row.diff.toFixed(1)} L`;
      return `<div class="mini-compare"><span>${esc(row.label.replace('Same weekday ','').replace('Same date ',''))}</span><strong>${esc(value)}</strong><small class="${row.diff<0?'down':''}">${esc(change || (row.date&&row.state.has?(row.state.complete?'Complete day':'Incomplete day'):''))}</small></div>`;
    }).join('');
    el('comparison-table-body').innerHTML=rows.map((row,idx)=>{
      if(!row.date)return `<tr><td>${esc(row.label)}</td><td class="no-record">No matching date</td><td class="no-record">No matching calendar date</td><td class="no-record">—</td></tr>`;
      const state=row.state;
      const production=state.has?`${state.total.toFixed(3)} L`:'No record';
      const sub=state.has&&!state.complete?'<small>Incomplete day · one session</small>':state.has?'<small>Both sessions entered</small>':'';
      let diff=idx===0?'—':row.diff==null?'—':`${row.diff>0?'+':''}${row.diff.toFixed(3)} L`;
      return `<tr><td>${esc(row.label)}</td><td>${esc(dateLabel(row.date,{day:'numeric',month:'short',year:'numeric'}))}</td><td class="${state.has?'':'no-record'}">${esc(production)}${sub}</td><td class="${row.diff<0?'negative':''}">${esc(diff)}</td></tr>`;
    }).join('');
  }
  function renderToday(){
    const s=dayState(TODAY);
    el('today-total').innerHTML=s.has?`${s.total.toFixed(3)} <span>L</span>`:'— <span>L</span>';
    el('morning-total').innerHTML=s.morning?`${s.morning.litres.toFixed(3)} <i>L</i>`:'— <i>L</i>';
    el('evening-total').innerHTML=s.evening?`${s.evening.litres.toFixed(3)} <i>L</i>`:'— <i>L</i>';
    el('morning-state').textContent=s.morning?`Collected · ${s.morning.time||'recorded'}`:'Not entered';
    el('evening-state').textContent=s.evening?`Collected · ${s.evening.time||'recorded'}`:'Not entered';
    el('day-status').className=`status-pill ${s.complete?'complete':'incomplete'}`;
    el('day-status').innerHTML=`<i></i> ${s.complete?'Complete day':s.has?'Incomplete day':'No entry yet'}`;
    const cycle=currentCycle();
    if(!cycle){
      el('cycle-litres').innerHTML='— <small>L</small>';el('cycle-amount').textContent=money(0);el('cycle-estimated-amount').textContent=money(0);el('cycle-estimate').classList.add('hidden');
      document.querySelector('.cycle-day').innerHTML='<b>No cycle</b>';el('cycle-progress-fill').style.width='0%';
      document.querySelector('.cycle-dates').children[0].textContent='—';document.querySelector('.cycle-dates').children[2].textContent='—';
      document.querySelector('.payment-chip').innerHTML='<i></i> No cycle';document.querySelector('.cycle-badge').textContent='NOT INITIALIZED';
      return;
    }
    const totals=allCycleTotals(cycle);
    el('cycle-litres').innerHTML=`${totals.totalLitres.toFixed(1)} <small>L</small>`;
    el('cycle-amount').textContent=money(totals.recordedAmount);
    el('cycle-estimated-amount').textContent=money(totals.estimatedAmount);
    el('cycle-estimate').classList.toggle('hidden',totals.estimatedAmount<=0);
    const start=new Date(`${cycle.start}T12:00:00`),end=new Date(`${cycle.end}T12:00:00`),now=new Date(`${TODAY}T12:00:00`);
    const length=Math.round((end-start)/86400000)+1,day=Math.max(1,Math.min(length,Math.round((now-start)/86400000)+1));
    document.querySelector('.cycle-day').innerHTML=`<b>Day ${day}</b> of ${length}`;
    el('cycle-progress-fill').style.width=`${day/length*100}%`;
    document.querySelector('.cycle-dates').children[0].textContent=dateLabel(cycle.start,{day:'2-digit',month:'short'}).toUpperCase();
    document.querySelector('.cycle-dates').children[2].textContent=dateLabel(cycle.end,{day:'2-digit',month:'short'}).toUpperCase();
    const paid=totals.actualPayments>0;
    document.querySelector('.payment-chip').innerHTML=`<i></i> ${paid?`Received ${money(totals.actualPayments)}`:'Payment pending'}`;
    document.querySelector('.cycle-badge').textContent=cycle.label.toUpperCase();
  }
  function renderRecords(){
    let cycles=[...data.cycles].sort((a,b)=>b.start.localeCompare(a.start));
    let records=[...data.milkRecords];
    const cur=currentCycle(), curIdx=cur?data.cycles.findIndex(c=>c.id===cur.id):-1,prev=cur?data.cycles[curIdx-1]:null;
    if(activeFilter==='current')records=cur?records.filter(r=>r.date>=cur.start&&r.date<=cur.end):[];
    if(activeFilter==='previous'&&prev)records=records.filter(r=>r.date>=prev.start&&r.date<=prev.end);
    if(activeFilter==='custom'){
      const a=el('range-start').value,b=el('range-end').value;
      records=records.filter(r=>r.date>=a&&r.date<=b);
    }
    const dates=[...new Set(records.map(r=>r.date))].sort((a,b)=>b.localeCompare(a));
    const rows=dates.map(date=>({date,state:dayState(date),records:data.milkRecords.filter(r=>r.date===date)}));
    const totalL=sum(records,'litres'), known=records.filter(r=>r.amount!=null), totalAmount=sumMoney(known);
    el('record-summary').innerHTML=`<div><span>Days with records</span><strong>${dates.length}</strong></div><div><span>Morning milk</span><strong>${sum(records.filter(r=>r.session==='MORNING'),'litres').toFixed(1)} L</strong></div><div><span>Evening milk</span><strong>${sum(records.filter(r=>r.session==='EVENING'),'litres').toFixed(1)} L</strong></div><div><span>Total milk</span><strong>${totalL.toFixed(1)} L</strong></div><div><span>Known amount</span><strong>${money(totalAmount)}</strong></div>`;
    el('records-table-body').innerHTML=rows.length?rows.map(({date,state})=>{
      const recs=data.milkRecords.filter(r=>r.date===date), morning=recordBy(date,'MORNING'),evening=recordBy(date,'EVENING');
      const knownAmount=recs.filter(r=>r.amount!=null), status=state.complete?'complete':'incomplete';
      return `<tr><td>${esc(dateLabel(date,{day:'numeric',month:'short',year:'numeric'}))}</td><td>${morning?morning.litres.toFixed(3)+' L':'—'} <button class="edit-record" data-edit-date="${date}" data-edit-session="MORNING">${morning?'Edit':'Add'}</button></td><td>${evening?evening.litres.toFixed(3)+' L':'—'} <button class="edit-record" data-edit-date="${date}" data-edit-session="EVENING">${evening?'Edit':'Add'}</button></td><td>${state.total.toFixed(3)} L</td><td>${knownAmount.length?money(sumMoney(knownAmount)):'—'}</td><td><span class="table-status ${status}">${state.complete?'Complete':'Incomplete'}</span></td><td></td></tr>`;
    }).join(''):'<tr><td colspan="7" class="no-record">No milk records in this view.</td></tr>';
    el('billing-cycles').innerHTML=cycles.map(c=>{
      const t=allCycleTotals(c),isCurrent=cur&&c.id===cur.id,diff=t.paymentDifference;
      const paymentText=t.actualPayments?`Received ${money(t.actualPayments)} · ${diff>0?'+':''}${money(diff)} difference`:'Payment pending';
      return `<article class="billing-card ${isCurrent?'current':''}"><div class="billing-card-top"><h4>${esc(c.label)}</h4>${isCurrent?'<span class="table-status complete">Current</span>':''}</div><p class="cycle-range">${esc(dateLabel(c.start,{day:'numeric',month:'short'}))} – ${esc(dateLabel(c.end,{day:'numeric',month:'short',year:'numeric'}))} · ${esc(c.type==='MANUAL_RESET'?'Manual reset':'10-day cycle')}</p><div class="billing-metrics"><div><span>Milk supplied</span><strong>${t.totalLitres.toFixed(3)} L</strong></div><div><span>Daily average</span><strong>${t.averageDailyMilk.toFixed(3)} L</strong></div><div><span>Recorded amount</span><strong>${money(t.recordedAmount)}</strong></div><div><span>Estimated amount</span><strong>${t.estimatedAmount?money(t.estimatedAmount):'—'}</strong></div><div><span>Weighted fat</span><strong>${t.weightedFat==null?'—':t.weightedFat.toFixed(2)+'%'}</strong></div><div><span>Weighted SNF</span><strong>${t.weightedSnf==null?'—':t.weightedSnf.toFixed(2)+'%'}</strong></div><div><span>Weighted rate</span><strong>${t.weightedRate==null?'—':money(t.weightedRate)+'/L'}</strong></div></div><div class="billing-payment"><span>Payments (${t.payments.length})</span><b class="${t.actualPayments?'':'pending'}">${esc(paymentText)}</b></div>${t.payments.map(p=>`<small class="cycle-range">${esc(dateLabel(p.paymentDate,{day:'numeric',month:'short',year:'numeric'}))}: ${money(p.amount)}${p.notes?` · ${esc(p.notes)}`:''}</small>`).join('')}</article>`;
    }).join('')||'<p class="no-record">No billing cycles have been initialized.</p>';
  }
  function setMilkStatus(message, kind='') {
    const status=el('milk-data-status');
    status.className=`connection-status ${kind}`;
    status.textContent=message;
  }
  function setBillingStatus(message,kind=''){
    const status=el('billing-data-status');status.className=`connection-status ${kind}`;status.textContent=message;
  }
  function setCattleStatus(message,kind=''){
    const status=el('cattle-data-status');status.className=`connection-status ${kind}`;status.textContent=message;
  }
  function reportReadiness(){
    if(!localDatabase)return {state:'error',message:'Reports are available only through the isolated local Supabase connection.'};
    if(!authSession)return {state:'locked',message:'Sign in to load reports from the farm database.'};
    const states=Object.values(reportResources);
    if(states.includes('loading')||states.includes('idle'))return {state:'loading',message:'Loading farm records for reports…'};
    if(states.includes('error'))return {state:'error',message:'Some farm records could not be loaded. Check the connection and retry before printing.'};
    if(states.includes('locked'))return {state:'locked',message:'Sign in to load reports from the farm database.'};
    return {state:'ready',message:'Reports use the records currently loaded from local Supabase.'};
  }
  function reportDateLabel(value,options={day:'numeric',month:'short',year:'numeric'}){
    return new Intl.DateTimeFormat('en-IN',{...options,timeZone:'Asia/Kolkata'}).format(new Date(`${value}T12:00:00+05:30`));
  }
  function setReportResource(name,state){reportResources[name]=state;}
  async function refreshCattleData(){
    if(!localDatabase){data.cattle=[];setReportResource('cattle','error');setCattleStatus('Cattle records are available only through the isolated local Supabase connection.','error');renderCattle();renderReports();return false;}
    if(!authSession){data.cattle=[];setReportResource('cattle','locked');setCattleStatus('Sign in to the local database to load cattle records.');renderCattle();renderReports();return false;}
    setReportResource('cattle','loading');renderReports();
    setCattleStatus('Loading cattle records…');
    try{
      data.cattle=await window.DairyMilkRepository.listCattle();
      setReportResource('cattle','ready');
      setCattleStatus(`Loaded ${data.cattle.length} cattle records from local Supabase.`,'success');
    }catch(error){setReportResource('cattle','error');setCattleStatus(error.message||'Could not load cattle records. Check the local connection and try again.','error');}
    renderCattle();renderReports();return reportResources.cattle==='ready';
  }
  async function refreshBillingData(){
    if(!localDatabase||!authSession){data.cycles=[];data.payments=[];setReportResource('billing','locked');setBillingStatus('Sign in to the local database to load billing data.');render();return false;}
    setReportResource('billing','loading');renderReports();
    setBillingStatus('Loading billing cycles and payments…');
    try{
      const [cycles,payments]=await Promise.all([window.DairyMilkRepository.listCycles(),window.DairyMilkRepository.listPayments()]);
      data.cycles=cycles.sort((a,b)=>a.start.localeCompare(b.start));data.payments=payments;
      setReportResource('billing','ready');
      setBillingStatus(`Loaded ${cycles.length} cycles and ${payments.length} payments from local Supabase.`,'success');
    }catch(error){data.cycles=[];data.payments=[];setReportResource('billing','error');setBillingStatus(error.message||'Could not load billing data.','error');}
    render();return reportResources.billing==='ready';
  }
  async function refreshFarmSettings(){
    if(!localDatabase||!authSession){data.farmSettings=null;setReportResource('settings','locked');renderReports();return false;}
    setReportResource('settings','loading');renderReports();
    try{
      data.farmSettings=await window.DairyMilkRepository.getFarmSettings();
      setReportResource('settings','ready');
    }catch(error){data.farmSettings=null;setReportResource('settings','error');}
    renderReports();return reportResources.settings==='ready';
  }
  async function refreshMilkRecords() {
    if (!localDatabase) {
      data.milkRecords=[];
      data.cycles=[];data.payments=[];
      Object.keys(reportResources).forEach(key=>setReportResource(key,'error'));
      setMilkStatus('Milk records are connected to the isolated local database only. Open this app on the development machine to use them.','error');
      setBillingStatus('Billing integration is available only with the local Supabase development session.','error');
      data.cattle=[];setCattleStatus('Cattle records are available only through the isolated local Supabase connection.','error');
      render();
      return;
    }
    if (!authSession) {
      data.milkRecords=[];
      data.cycles=[];data.payments=[];
      data.cattle=[];data.farmSettings=null;
      Object.keys(reportResources).forEach(key=>setReportResource(key,'locked'));
      setMilkStatus('Sign in with a local development account to load farm records.');
      setBillingStatus('Sign in to the local database to load billing data.');
      data.cattle=[];setCattleStatus('Sign in to the local database to load cattle records.');
      render();
      return;
    }
    setReportResource('milk','loading');renderReports();
    setMilkStatus('Loading milk records…');
    try {
      data.milkRecords=await window.DairyMilkRepository.list();
      setReportResource('milk','ready');
      setMilkStatus(`Loaded ${data.milkRecords.length} milk ${data.milkRecords.length===1?'record':'records'} from local Supabase.`,'success');
    } catch(error) {
      data.milkRecords=[];
      setReportResource('milk','error');
      setMilkStatus(error.message||'Could not load milk records. Check the local connection and try again.','error');
    }
    render();
    await Promise.all([refreshBillingData(),refreshCattleData(),refreshFarmSettings()]);
  }
  function renderCattle(){
    const active=data.cattle.filter(c=>c.status==='ACTIVE').length,total=data.cattle.length;
    el('active-count').textContent=active;el('total-cattle').textContent=total;
    el('herd-total-summary').textContent=total;el('herd-active-summary').textContent=active;el('herd-inactive-summary').textContent=total-active;
    el('mini-herd').innerHTML=data.cattle.map(c=>`<i class="mini-cow ${c.status==='INACTIVE'?'inactive':''}" title="${esc(c.name)} · ${c.status.toLowerCase()}"></i>`).join('');
    const animals=data.cattle.filter(c=>cattleFilter==='all'||c.status===cattleFilter).sort((a,b)=>a.name.localeCompare(b.name));
    el('herd-grid').innerHTML=animals.map(c=>`<article class="animal-card" tabindex="0" role="button" data-animal-id="${esc(c.id)}" aria-label="Edit ${esc(c.name)}"><span class="animal-avatar ${c.status==='INACTIVE'?'inactive':''}"><img src="assets/images/cow.png" alt="" loading="lazy"></span><span class="animal-details"><strong>${esc(c.name)}</strong><small>${c.dob?`Born ${esc(dateLabel(c.dob,{day:'numeric',month:'short',year:'numeric'}))}`:'No birth date added'}</small></span><span class="animal-status ${c.status==='INACTIVE'?'inactive':''}">${c.status==='ACTIVE'?'Active':'Inactive'}</span><span class="animal-arrow">›</span></article>`).join('')||'<p class="no-record">No cattle in this group.</p>';
  }
  const reportLitres=value=>value==null?'—':`${Number(value).toFixed(3)} L`;
  const reportOptional=(value,suffix='')=>value==null?'—':`${Number(value).toFixed(2)}${suffix}`;
  function reportDocument(title,period,body,extraClass=''){
    const farmName=data.farmSettings?.farmName||'Our Dairy Farm';
    const generated=new Intl.DateTimeFormat('en-IN',{dateStyle:'long',timeZone:data.farmSettings?.timezone||'Asia/Kolkata'}).format(new Date());
    return `<article id="report-print-area" class="report-print-document ${extraClass}"><header class="report-document-head"><p class="report-farm-name">${esc(farmName)}</p><p class="eyebrow">FARM REPORT</p><h3>${esc(title)}</h3><p class="report-period">${esc(period)}</p><p class="report-generated">Generated ${esc(generated)}</p></header><button type="button" class="button button-terracotta report-print-action" data-report-print>Print / Save PDF</button>${body}<footer class="report-document-foot">Our Dairy Farm · ${esc(data.farmSettings?.timezone||'Asia/Kolkata')}</footer></article>`;
  }
  function reportSummary(items){return `<div class="report-summary">${items.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${value}</strong></div>`).join('')}</div>`;}
  function renderDailyReport(){
    const date=el('report-date').value||TODAY,state=dayState(date),entries=[state.morning,state.evening].filter(Boolean);
    const knownAmount=entries.reduce((sum,record)=>sum+(record.amount==null?0:Number(record.amount)),0);
    const amountRows=entries.filter(record=>record.amount!=null).length;
    const detail=record=>record?`<span>${reportLitres(record.litres)}</span><small>Fat ${reportOptional(record.fat,'%')} · SNF ${reportOptional(record.snf,'%')} · Rate ${record.rate==null?'—':money(record.rate)+'/L'} · Amount ${record.amount==null?'Not recorded':money(record.amount)}</small>`:'<span class="report-missing">Not entered</span>';
    const body=`${reportSummary([['Total milk',state.has?reportLitres(state.total):'No record'],['Recorded amount',amountRows?money(knownAmount):'—'],['Morning',state.morning?'Entered':'Not entered'],['Evening',state.evening?'Entered':'Not entered']])}<div class="table-wrap report-table-wrap"><table class="report-table"><thead><tr><th>Session</th><th>Milk supplied</th><th>Fat</th><th>SNF</th><th>Rate</th><th>Amount</th></tr></thead><tbody><tr><th>Morning</th><td>${reportLitres(state.morning?.litres)}</td><td>${reportOptional(state.morning?.fat,'%')}</td><td>${reportOptional(state.morning?.snf,'%')}</td><td>${state.morning?.rate==null?'—':money(state.morning.rate)+'/L'}</td><td>${state.morning?.amount==null?'—':money(state.morning.amount)}</td></tr><tr><th>Evening</th><td>${reportLitres(state.evening?.litres)}</td><td>${reportOptional(state.evening?.fat,'%')}</td><td>${reportOptional(state.evening?.snf,'%')}</td><td>${state.evening?.rate==null?'—':money(state.evening.rate)+'/L'}</td><td>${state.evening?.amount==null?'—':money(state.evening.amount)}</td></tr><tr class="report-total-row"><th>Total recorded</th><td>${state.has?reportLitres(state.total):'No record'}</td><td colspan="4">${amountRows?money(knownAmount)+' recorded':'No amount recorded'}</td></tr></tbody></table></div>${state.has?'':`<p class="report-empty">No milk records were found for ${esc(reportDateLabel(date))}.</p>`}${entries.length&&!state.complete?'<p class="report-note">One session is missing. It is shown as “Not entered” and is not counted as zero.</p>':''}`;
    return reportDocument('Daily Milk Report',reportDateLabel(date),body);
  }
  function cycleEntry(record){
    if(!record)return '<span class="report-missing">Not entered</span>';
    const value=record.amount!=null?`Recorded ${money(record.amount)}`:record.rate!=null?`Estimated ${money(record.litres*record.rate)}`:'Amount not recorded';
    return `<span>${reportLitres(record.litres)}</span><small>Fat ${reportOptional(record.fat,'%')} · SNF ${reportOptional(record.snf,'%')}</small><small>Rate ${record.rate==null?'—':money(record.rate)+'/L'} · ${value}</small>`;
  }
  function renderCycleReport(){
    const select=el('report-cycle'),cycles=[...data.cycles].sort((a,b)=>b.start.localeCompare(a.start));
    const prior=select.value;
    select.innerHTML=cycles.map(cycle=>`<option value="${esc(cycle.id)}">${esc(reportDateLabel(cycle.start,{day:'numeric',month:'short'}))} – ${esc(reportDateLabel(cycle.end))}${cycle.type==='MANUAL_RESET'?' · Manual reset':''}</option>`).join('');
    if(cycles.some(cycle=>cycle.id===prior))select.value=prior;
    else if(cycles.length){const current=cycles.find(cycle=>TODAY>=cycle.start&&TODAY<=cycle.end);select.value=(current||cycles[0]).id;}
    const cycle=cycles.find(item=>item.id===select.value);
    if(!cycle)return reportDocument('10-Day Billing Report','No billing cycles',`<p class="report-empty">No billing cycles are available in the farm database.</p>`);
    const days=milkMath.cycleDates(cycle),totals=milkMath.cycleTotals(cycle,data.milkRecords,data.payments);
    const recordsByDate=new Map(totals.records.map(record=>[`${record.date}:${record.session}`,record]));
    const allDays=days.map(date=>{const morning=recordsByDate.get(`${date}:MORNING`),evening=recordsByDate.get(`${date}:EVENING`);return {date,morning,evening,total:Number(morning?.litres||0)+Number(evening?.litres||0),has:!!(morning||evening)};});
    const body=`${reportSummary([['Cycle days',String(days.length)],['Total milk',reportLitres(totals.totalLitres)],['Average per cycle day',reportLitres(totals.averageDailyMilk)],['Recorded amount',money(totals.recordedAmount)],['Estimated amount',money(totals.estimatedAmount)],['Payments received',money(totals.actualPayments)],['Remaining difference',money(totals.paymentDifference)]])}<h4 class="report-subheading">Daily collection</h4>${totals.records.length?'':`<p class="report-empty">No milk records were found in this billing cycle. Each date below is marked accordingly.</p>`}<div class="table-wrap report-table-wrap"><table class="report-table"><thead><tr><th>Date</th><th>Morning</th><th>Evening</th><th>Daily total</th></tr></thead><tbody>${allDays.map(row=>`<tr><th>${esc(reportDateLabel(row.date))}</th><td>${cycleEntry(row.morning)}</td><td>${cycleEntry(row.evening)}</td><td>${row.has?reportLitres(row.total):'No record'}</td></tr>`).join('')}<tr class="report-total-row"><th>Cycle total</th><td colspan="2">${totals.records.length} session${totals.records.length===1?'':'s'} recorded</td><td>${reportLitres(totals.totalLitres)}</td></tr></tbody></table></div><h4 class="report-subheading">Payments received</h4>${totals.payments.length?`<div class="table-wrap report-table-wrap"><table class="report-table"><thead><tr><th>Payment date</th><th>Amount received</th><th>Notes</th></tr></thead><tbody>${totals.payments.slice().sort((a,b)=>a.paymentDate.localeCompare(b.paymentDate)).map(payment=>`<tr><td>${esc(reportDateLabel(payment.paymentDate))}</td><td>${money(payment.amount)}</td><td>${esc(payment.notes||'—')}</td></tr>`).join('')}<tr class="report-total-row"><th>Total received</th><td>${money(totals.actualPayments)}</td><td></td></tr></tbody></table></div>`:'<p class="report-empty">No payments recorded for this cycle.</p>'}<p class="report-note">Recorded amounts include only entries with an amount. Estimated value is shown separately and is never added to the recorded amount.</p>`;
    return reportDocument('10-Day Billing Report',`${reportDateLabel(cycle.start)} – ${reportDateLabel(cycle.end)} · Inclusive`,body,'report-landscape');
  }
  function renderMonthlyReport(){
    const month=el('report-month').value||TODAY.slice(0,7),summary=milkMath.monthRows(data.milkRecords,month);
    const [year,monthNumber]=month.split('-').map(Number);
    const monthTitle=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(Date.UTC(year,monthNumber-1,15,12)));
    const body=`${reportSummary([['Milk total',summary.rows.length?reportLitres(summary.totalLitres):'No record'],['Average per day with records',summary.averageDailyMilk==null?'—':reportLitres(summary.averageDailyMilk)],['Recorded amount',money(summary.recordedAmount)],['Estimated amount',money(summary.estimatedAmount)],['Days with milk records',String(summary.daysWithRecords)],['Incomplete days',String(summary.incompleteDays)]])}${summary.rows.length?'':`<p class="report-empty">No milk records were found for ${esc(monthTitle)}.</p>`}<div class="table-wrap report-table-wrap"><table class="report-table"><thead><tr><th>Date</th><th>Morning</th><th>Evening</th><th>Daily total</th><th>Recorded amount</th><th>Estimated amount</th><th>Status</th></tr></thead><tbody>${summary.rows.map(row=>`<tr><th>${esc(reportDateLabel(row.date))}</th><td>${row.state.morning?reportLitres(row.state.morning.litres):'<span class="report-missing">Not entered</span>'}</td><td>${row.state.evening?reportLitres(row.state.evening.litres):'<span class="report-missing">Not entered</span>'}</td><td>${reportLitres(row.state.total)}</td><td>${row.recordedAmount?money(row.recordedAmount):'—'}</td><td>${row.estimatedAmount?money(row.estimatedAmount):'—'}</td><td>${row.state.complete?'Complete':'Incomplete'}</td></tr>`).join('')}${summary.rows.length?`<tr class="report-total-row"><th>Monthly total</th><td colspan="2">${summary.daysWithRecords} days with records</td><td>${reportLitres(summary.totalLitres)}</td><td>${money(summary.recordedAmount)}</td><td>${money(summary.estimatedAmount)}</td><td>${summary.incompleteDays} incomplete</td></tr>`:''}</tbody></table></div><p class="report-note">Only dates with at least one milk entry are listed. Missing sessions are marked “Not entered”; days with no records are excluded from the average.</p>`;
    return reportDocument('Monthly Milk Report',monthTitle,body,'report-landscape');
  }
  function renderCattleReport(){
    const filter=el('report-cattle-filter').value,animals=data.cattle.slice().sort((a,b)=>a.name.localeCompare(b.name));
    const active=animals.filter(animal=>animal.status==='ACTIVE').length,inactive=animals.length-active;
    const filtered=animals.filter(animal=>filter==='all'||animal.status===filter);
    const body=`${reportSummary([['Total animals',String(animals.length)],['Active',String(active)],['Inactive',String(inactive)],['Shown in this report',String(filtered.length)]])}${filtered.length?'':`<p class="report-empty">No cattle match this filter.</p>`}<div class="table-wrap report-table-wrap"><table class="report-table"><thead><tr><th>Animal</th><th>Status</th><th>Date of birth</th><th>Notes</th></tr></thead><tbody>${filtered.map(animal=>`<tr><th>${esc(animal.name)}</th><td>${animal.status==='ACTIVE'?'Active':'Inactive'}</td><td>${animal.dob?esc(reportDateLabel(animal.dob)):'—'}</td><td>${esc(animal.notes||'—')}</td></tr>`).join('')}</tbody></table></div><p class="report-note">Herd totals show all cattle; the table follows the selected status filter.</p>`;
    return reportDocument('Cattle Register Report',filter==='all'?'All cattle':`${filter==='ACTIVE'?'Active':'Inactive'} cattle`,body);
  }
  function renderReports(){
    const readiness=reportReadiness(),status=el('reports-status');
    status.textContent=readiness.message;status.className=`connection-status ${readiness.state==='ready'?'success':readiness.state==='error'?'error':''}`;
    document.querySelectorAll('[data-report-control]').forEach(control=>control.classList.toggle('hidden',control.dataset.reportControl!==reportType));
    document.querySelectorAll('[data-report-type]').forEach(button=>{const active=button.dataset.reportType===reportType;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    if(readiness.state!=='ready'){
      el('report-preview').innerHTML=`<div class="report-empty">${esc(readiness.message)}</div>`;return;
    }
    const report=reportType==='daily'?renderDailyReport():reportType==='cycle'?renderCycleReport():reportType==='monthly'?renderMonthlyReport():renderCattleReport();
    el('report-preview').innerHTML=report;
  }
  function render(){renderToday();renderComparison();renderRecords();renderCattle();renderReports();}
  function syncDateInputs(value){el('compare-date').value=value;el('compare-date-large').value=value;renderComparison();}
  function setNav(){
    const links=[...document.querySelectorAll('.nav-link')],sections=links.map(a=>document.getElementById(a.dataset.nav));
    const update=()=>{
      const marker=window.innerHeight*.4;
      let active=sections[0];
      sections.forEach(section=>{if(section.getBoundingClientRect().top<=marker)active=section;});
      links.forEach(link=>link.classList.toggle('active',link.dataset.nav===active.id));
    };
    window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);update();
  }
  const backupDateInFarmTz=timezone=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(new Date());
  const backupTimestamp=(value,timezone)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(value));
  function setBackupStatus(message,kind=''){const node=el('backup-status');node.textContent=message;node.className=`connection-status ${kind}`;}
  function setRestoreStatus(message,kind=''){const node=el('restore-status');node.textContent=message;node.className=`connection-status ${kind}`;}
  function resetRestorePreview(){selectedRestore=null;el('restore-preview').hidden=true;el('restore-preview').innerHTML='';el('restore-confirm').hidden=true;el('restore-confirm').disabled=true;}
  function restoreCountsMarkup(preview){
    const labels={farm_settings:'Farm settings',milk_records:'Milk records',billing_cycles:'Billing cycles',payments:'Payments',cattle:'Cattle'};
    const rows=Object.entries(labels).map(([key,label])=>{const c=preview.categories[key];return `<tr><th>${label}</th><td>${c.new}</td><td>${c.skipped}</td><td>${c.conflicts}</td><td>${c.unrestorable}</td></tr>`;}).join('');
    const details=preview.details.slice(0,50).map(item=>`<li><b>${esc(item.type.replaceAll('_',' '))}:</b> ${esc(item.reason)}</li>`).join('');
    return `<h4>${esc(selectedRestore.farm.name)}</h4><p>Backup created ${esc(backupTimestamp(selectedRestore.created_at,selectedRestore.farm.timezone))} · Import target: the currently connected farm database.</p><div class="table-wrap"><table class="restore-counts"><thead><tr><th>Records</th><th>New</th><th>Skip</th><th>Conflict</th><th>Blocked</th></tr></thead><tbody>${rows}</tbody></table></div><p class="connection-status">${preview.total} new records can be added. Existing rows will be preserved. The database rechecks conflicts when you confirm.</p>${details?`<ul class="restore-conflicts">${details}</ul>`:''}`;
  }
  async function createBackup(){
    if(!authSession){setBackupStatus('Sign in to the farm database before creating a backup.','error');return;}
    const button=el('create-backup');button.disabled=true;setBackupStatus('Fetching all five farm data groups…');
    try{
      const dataRows=await window.DairyMilkRepository.fetchBackupSnapshot();
      const settings=dataRows.farm_settings[0];
      const timezone=settings?.timezone||data.farmSettings?.timezone||'Asia/Kolkata';
      const name=settings?.farm_name||data.farmSettings?.farmName||'Our Dairy Farm';
      const backup={format:window.DairyBackupRestore.format,version:window.DairyBackupRestore.version,created_at:new Date().toISOString(),farm:{name,timezone},data:dataRows};
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`our-dairy-farm-backup-${backupDateInFarmTz(timezone)}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      const total=Object.values(dataRows).reduce((n,rows)=>n+rows.length,0);
      setBackupStatus(`Backup downloaded · ${total} records across all five data groups.`,'success');
    }catch(error){setBackupStatus(error.message||'Could not create the backup. Check your connection and try again.','error');}
    finally{button.disabled=false;}
  }
  async function prepareRestore(file){
    resetRestorePreview();if(!file)return;
    if(!authSession){setRestoreStatus('Sign in to the farm database before preparing a restore.','error');return;}
    setRestoreStatus('Reading and validating the selected file…');
    try{
      if(file.size>100*1024*1024)throw new Error('This backup is larger than 100 MB and cannot be opened in the browser.');
      const parsed=JSON.parse(await file.text());window.DairyBackupRestore.validate(parsed);
      setRestoreStatus('Checking existing records and relationships…');
      const current=await window.DairyMilkRepository.fetchBackupSnapshot();
      const preview=window.DairyBackupRestore.preview(parsed,current);
      selectedRestore=parsed;el('restore-preview').innerHTML=restoreCountsMarkup(preview);el('restore-preview').hidden=false;
      el('restore-confirm').hidden=false;el('restore-confirm').disabled=preview.total===0;
      setRestoreStatus(preview.total?'Review the counts and conflict list, then confirm to add safe records.':'Nothing new can be added from this backup.','success');
    }catch(error){resetRestorePreview();setRestoreStatus(error.message||'This backup could not be validated.','error');}
  }
  async function confirmRestore(){
    if(!authSession||!selectedRestore){setRestoreStatus('Select and review a valid backup while signed in.','error');return;}
    if(!window.confirm('Add the safe records from this backup to the currently connected farm? Existing records will never be deleted or overwritten.'))return;
    const button=el('restore-confirm');button.disabled=true;setRestoreStatus('Importing safe records in one database transaction…');
    try{
      const result=await window.DairyMilkRepository.restoreBackup(selectedRestore);
      await refreshMilkRecords();
      const resultDetails=Array.isArray(result.conflict_details)?result.conflict_details.map(item=>`<li><b>${esc(item.type||'record')}:</b> ${esc(item.reason||'Skipped safely.')}</li>`).join(''):'';
      el('restore-preview').innerHTML=`<h4>Restore results</h4><p>${Number(result.inserted||0)} inserted · ${Number(result.skipped||0)} skipped · ${Number(result.conflicts||0)} conflicts. Existing data was preserved.</p>${resultDetails?`<ul class="restore-conflicts">${resultDetails}</ul>`:''}`;
      el('restore-preview').hidden=false;el('restore-confirm').hidden=true;el('restore-confirm').disabled=true;
      setRestoreStatus('Restore completed. Review the results and any skipped conflicts below.','success');
      el('restore-file').value='';selectedRestore=null;toast('Backup restore completed.');
    }catch(error){setRestoreStatus(error.message||'Restore failed. No records were committed. Check the connection and try again.','error');button.disabled=false;}
  }
  function openMilk(session,date=TODAY){if(!authSession){el('access-dialog').showModal();el('access-error').textContent='Sign in to the local development account before entering milk.';return;}const found=recordBy(date,session);el('milk-record-id').value=found?.id||'';el('milk-session').value=session;el('milk-date').value=date;el('milk-litres').value=found?.litres??'';el('milk-fat').value=found?.fat??'';el('milk-snf').value=found?.snf??'';el('milk-rate').value=found?.rate??'';el('milk-amount').value=found?.amount??'';el('milk-notes').value=found?.notes??'';el('milk-form-title').textContent=`${found?'Edit':'Add'} ${session==='MORNING'?'morning':'evening'} milk`;el('milk-form-kicker').textContent=found?'UPDATE THE MILK BOOK':'ADD TO THE MILK BOOK';el('milk-error').textContent='';el('entry-dialog').showModal();setTimeout(()=>el('milk-litres').focus(),50);}
  document.addEventListener('click',e=>{
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action==='add-morning')openMilk('MORNING');if(action==='add-evening')openMilk('EVENING');
    const edit=e.target.closest('[data-edit-session]');if(edit)openMilk(edit.dataset.editSession,edit.dataset.editDate);
    const animal=e.target.closest('[data-animal-id]');if(animal)openCattle(animal.dataset.animalId);
    const close=e.target.closest('[data-close]');if(close)close.closest('dialog').close();
    const filter=e.target.closest('[data-filter]');if(filter){activeFilter=filter.dataset.filter;document.querySelectorAll('.filters .filter-chip').forEach(b=>b.classList.toggle('active',b===filter));el('range-controls').classList.toggle('hidden',activeFilter!=='custom');renderRecords();document.querySelector('.records-toolbar').scrollIntoView({behavior:'smooth',block:'start'});}
    const cf=e.target.closest('[data-cattle-filter]');if(cf){cattleFilter=cf.dataset.cattleFilter;document.querySelectorAll('[data-cattle-filter]').forEach(b=>b.classList.toggle('active',b===cf));renderCattle();}
    const reportButton=e.target.closest('[data-report-type]');if(reportButton){reportType=reportButton.dataset.reportType;renderReports();}
    if(e.target.closest('#add-cattle'))openCattle();
    if(e.target.closest('#add-payment'))openPayment();
    if(e.target.closest('#demo-access'))el('access-dialog').showModal();
    if(e.target.closest('[data-report-print]'))window.print();
  });
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-animal-id]')){e.preventDefault();openCattle(e.target.closest('[data-animal-id]').dataset.animalId);}});
  el('create-backup').addEventListener('click',createBackup);
  el('restore-file').addEventListener('change',e=>prepareRestore(e.target.files?.[0]));
  el('restore-confirm').addEventListener('click',confirmRestore);
  el('milk-form').addEventListener('submit',async e=>{
    e.preventDefault();const date=el('milk-date').value,session=el('milk-session').value,litre=Number(el('milk-litres').value);
    if(!date||date>TODAY){el('milk-error').textContent='Choose today or an earlier date.';return;}
    if(!Number.isFinite(litre)||litre<=0){el('milk-error').textContent='Enter milk supplied as a positive number.';return;}
    const optional=id=>el(id).value===''?null:Number(el(id).value);
    if(!authSession){el('milk-error').textContent='Your local session has expired. Sign in again and retry.';return;}
    const id=el('milk-record-id').value;
    const record={id:id||undefined,date,session,litres:litre,fat:optional('milk-fat'),snf:optional('milk-snf'),rate:optional('milk-rate'),amount:optional('milk-amount'),notes:el('milk-notes').value.trim()};
    const button=el('milk-submit');button.disabled=true;button.textContent='Saving…';el('milk-error').textContent='';
    try{
      await window.DairyMilkRepository.save(record);
      await refreshMilkRecords();
      el('entry-dialog').close();toast(id?'Milk entry updated in the farm record.':'Milk entry saved to the farm record.');
    }catch(error){
      el('milk-error').textContent=error.code==='23505'?'A record already exists for this date and session. Refresh the list before editing.':error instanceof TypeError?'Could not reach the local database. Check that Supabase is running. Your form values are still here; try again.':error.message||'Could not save this entry. Your form values are still here; try again.';
      setMilkStatus('A milk entry could not be saved. Your form values are preserved.','error');
    }finally{button.disabled=false;button.textContent='Save entry';}
  });
  el('compare-date').addEventListener('change',e=>syncDateInputs(e.target.value));el('compare-date-large').addEventListener('change',e=>syncDateInputs(e.target.value));
  el('apply-range').addEventListener('click',()=>{if(el('range-start').value>el('range-end').value){toast('The start date must be before the end date.');return;}renderRecords();});
  function openCattle(id=''){
    if(!authSession){el('access-dialog').showModal();el('access-error').textContent='Sign in to the local development account before managing cattle.';return;}
    const c=data.cattle.find(item=>item.id===id);el('cattle-id').value=c?.id||'';el('cattle-name').value=c?.name||'';el('cattle-status').value=c?.status||'ACTIVE';el('cattle-dob').value=c?.dob||'';el('cattle-notes').value=c?.notes||'';el('cattle-form-title').textContent=c?'Update cattle':'Add cattle';el('cattle-error').textContent='';el('cattle-dialog').showModal();
  }
  el('cattle-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=el('cattle-name').value.trim(),status=el('cattle-status').value,dob=el('cattle-dob').value||null;
    if(!name){el('cattle-error').textContent='Enter an animal name or ID.';return;}
    if(!['ACTIVE','INACTIVE'].includes(status)){el('cattle-error').textContent='Choose Active or Inactive status.';return;}
    if(dob&&dob>TODAY){el('cattle-error').textContent='Choose today or an earlier birth date.';return;}
    if(!authSession){el('cattle-error').textContent='Your local session has expired. Sign in again and retry.';return;}
    const id=el('cattle-id').value;
    const record={id:id||undefined,name,status,dob,notes:el('cattle-notes').value.trim()};
    const button=el('cattle-submit');button.disabled=true;button.textContent='Saving…';el('cattle-error').textContent='';
    try{
      const saved=await window.DairyMilkRepository.saveCattle(record);
      const index=data.cattle.findIndex(c=>c.id===saved.id);
      if(index>=0)data.cattle[index]=saved;else data.cattle.push(saved);
      renderCattle();setCattleStatus('Cattle details saved to local Supabase.','success');
      el('cattle-dialog').close();toast(id?'Cattle details updated.':'Cattle added.');
      await refreshCattleData();
    }catch(error){
      el('cattle-error').textContent=error instanceof TypeError?'Could not reach the local database. Your form values are still here; try again.':error.message||'Could not save cattle details. Your form values are still here; try again.';
      setCattleStatus('A cattle record could not be saved. The form values are preserved.','error');
    }finally{button.disabled=false;button.textContent='Save cattle';}
  });
  function openPayment(){
    if(!authSession){el('access-dialog').showModal();el('access-error').textContent='Sign in to the local development account before recording a payment.';return;}
    const select=el('payment-cycle'),cycles=[...data.cycles].sort((a,b)=>b.start.localeCompare(a.start));
    if(!cycles.length){toast('Initialize a billing cycle before recording payments.');return;}
    select.innerHTML=cycles.map(c=>`<option value="${esc(c.id)}">${esc(c.label)} · ${esc(dateLabel(c.start,{day:'numeric',month:'short'}))}–${esc(dateLabel(c.end,{day:'numeric',month:'short'}))}</option>`).join('');
    const current=currentCycle();select.value=(current||cycles[0]).id;el('payment-date').value=TODAY;el('payment-amount').value='';el('payment-notes').value='';el('payment-error').textContent='';el('payment-dialog').showModal();
  }
  el('payment-form').addEventListener('submit',async e=>{
    e.preventDefault();const amount=Number(el('payment-amount').value),date=el('payment-date').value;
    if(!Number.isFinite(amount)||amount<=0){el('payment-error').textContent='Enter a payment amount greater than zero.';return;}
    if(!date){el('payment-error').textContent='Choose the date the payment was received.';return;}
    if(date>TODAY){el('payment-error').textContent='Choose today or an earlier payment date.';return;}
    if(!authSession){el('payment-error').textContent='Your local session has expired. Sign in again.';return;}
    const button=el('payment-submit');button.disabled=true;button.textContent='Saving…';el('payment-error').textContent='';
    try{
      await window.DairyMilkRepository.savePayment({cycleId:el('payment-cycle').value,amount,paymentDate:date,notes:el('payment-notes').value.trim()});
      await refreshBillingData();el('payment-dialog').close();toast('Payment added to the cycle history.');
    }catch(error){el('payment-error').textContent=error instanceof TypeError?'Could not reach the local database. Your payment details are still here; try again.':error.message||'Could not save this payment. Your details are still here; try again.';setBillingStatus('A payment could not be saved. The form values are preserved.','error');}
    finally{button.disabled=false;button.textContent='Save payment';}
  });
  el('reset-cycle').addEventListener('click',async()=>{
    if(!authSession){el('access-dialog').showModal();el('access-error').textContent='Sign in to the local development account before resetting a cycle.';return;}
    const latestCycle=data.cycles.at(-1);
    if(!currentCycle()&&latestCycle?.end!==milkMath.matchingDate(TODAY,'day',-1)){toast('Reset is available only during an active cycle or the day after it ends.');return;}
    if(!window.confirm('Reset the current billing cycle? It will close yesterday and a new 10-day cycle will start today. Milk records and payments will be preserved.'))return;
    const button=el('reset-cycle');button.disabled=true;button.textContent='Resetting…';setBillingStatus('Resetting the billing cycle…');
    try{
      const alreadyStartedToday=data.cycles.some(c=>c.start===TODAY);
      await window.DairyMilkRepository.resetCycle();await refreshBillingData();
      toast(alreadyStartedToday?'A cycle already starts today; its history was kept.':'New 10-day billing cycle started.');
    }
    catch(error){setBillingStatus(error.message||'Could not reset the billing cycle.','error');toast(error.message||'Could not reset the billing cycle.');}
    finally{button.disabled=false;button.textContent='Reset cycle';}
  });
  el('access-form').addEventListener('submit',async e=>{
    e.preventDefault();
    el('access-error').textContent='';
    if(localDatabase){
      const pin=el('demo-pin').value.trim();
      if(!/^\d{6}$/.test(pin)){el('access-error').textContent='Enter the six-digit local PIN.';return;}
      const submit=el('access-submit');submit.disabled=true;submit.textContent='Checking PIN…';
      try{
        const {data:result,error}=await window.DairyDatabase.signInWithLocalPin(pin);
        if(error)throw error;
        authSession=result.session;
        el('local-auth-state').textContent='Signed in to the local farm database.';
        el('local-signout').hidden=false;
        el('access-dialog').close();el('demo-pin').value='';
        await refreshMilkRecords();toast('Connected to the local farm record.');
      }catch(error){el('access-error').textContent=error.message||'Local PIN sign-in failed. Check the PIN and local server.';}
      finally{submit.disabled=false;submit.textContent='Continue';}
      return;
    }
    if(el('demo-pin').value!=='246810'){el('access-error').textContent='That is not the demo PIN. Use 246810.';return;}
    el('access-dialog').close();el('demo-pin').value='';toast('You are viewing development sample data.');
  });
  el('local-signout').addEventListener('click',async()=>{
    try{await window.DairyDatabase.signOut();authSession=null;el('local-auth-state').textContent='Signed out of the local database.';el('local-signout').hidden=true;await refreshMilkRecords();}
    catch(error){el('access-error').textContent=error.message||'Could not sign out of the local database.';}
  });
  el('test-supabase-connection').addEventListener('click',async()=>{
    const button=el('test-supabase-connection'),status=el('supabase-connection-status');
    button.disabled=true;button.textContent='Testing connection…';status.className='connection-status';status.textContent='Contacting the Supabase project…';
    try{
      const result=await window.DairyDatabase.testConnection();
      status.classList.add('success');status.textContent=`Connected successfully (HTTP ${result.status}). No tables or records were queried.`;
    }catch(error){
      status.classList.add('error');status.textContent=error.message||'Connection test failed.';
    }finally{
      button.disabled=false;button.textContent='Test Supabase connection';
    }
  });
  ['report-date','report-cycle','report-month','report-cattle-filter'].forEach(id=>el(id).addEventListener('change',renderReports));
  document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',()=>{if(a.dataset.filter){activeFilter=a.dataset.filter;document.querySelectorAll('.filters .filter-chip').forEach(b=>b.classList.toggle('active',b.dataset.filter===activeFilter));renderRecords();}}));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();}));
  el('report-date').value=TODAY;
  el('report-month').value=TODAY.slice(0,7);
  setNav();render();
  document.querySelectorAll('#milk-date,#payment-date,#cattle-dob').forEach(input=>input.max=TODAY);
  el('hero-date-label').textContent=new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(`${TODAY}T12:00:00`)).toUpperCase();
  const todayParts=new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Kolkata'}).format(new Date(`${TODAY}T12:00:00`)).split(' ');
  el('today-date-label').innerHTML=`${esc(todayParts[0])}<br><b>${esc(todayParts.slice(1).join(' '))}</b>`;
  if(localDatabase){
    el('demo-pin-label').textContent='Local development PIN';
    el('demo-pin-help').textContent='enter 246810';
    el('access-submit').textContent='Continue';
    el('access-description').textContent='Enter the local development PIN to sign in to the isolated Supabase database.';
    window.DairyDatabase.getSession().then(({data,error})=>{
      if(error)throw error;
      authSession=data.session;
      if(authSession){el('local-auth-state').textContent='Signed in to the local farm database.';el('local-signout').hidden=false;}
      return refreshMilkRecords();
    }).catch(error=>setMilkStatus(error.message||'Could not restore the local session. Sign in again.','error'));
  }else{
    setMilkStatus('Milk database integration is available only from the isolated local development server.','error');
  }
})();
