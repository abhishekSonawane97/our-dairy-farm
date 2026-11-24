/* Development-only seed data. No production database is connected in Phase 1. */
(() => {
  const target = '2026-11-23';
  const makeRecord = (date, session, litres, amount, fat, snf, time) => ({
    id: `sample-${date}-${session.toLowerCase()}`, date, session, litres, amount,
    fat, snf, rate: amount == null ? null : +(amount / litres).toFixed(2),
    notes: '', time, sample: true
  });
  const milkRecords = [];
  const addDay = (date, morning, evening, options = {}) => {
    if (morning) milkRecords.push(makeRecord(date, 'MORNING', morning.l, morning.a ?? +(morning.l * (options.rate || 44.5)).toFixed(2), morning.f ?? 4.1, morning.s ?? 8.5, morning.t || '7:10 am'));
    if (evening) milkRecords.push(makeRecord(date, 'EVENING', evening.l, evening.a ?? +(evening.l * (options.rate || 44.5)).toFixed(2), evening.f ?? 4.0, evening.s ?? 8.4, evening.t || '5:40 pm'));
  };
  // Current 10-day cycle: 14–23 November 2026.
  const daily = [[12.6,8.4],[13.1,8.7],[13,9],[13.4,8.8],[13.2,9.1],[13.8,9.2],[13.7,9.5],[14.1,9.4],[14,9.6],[14.5,10]];
  daily.forEach(([m,e], i) => {
    const day = String(14 + i).padStart(2, '0');
    const date = `2026-11-${day}`;
    addDay(date, {l:m}, {l:e}, {rate:44.9});
  });
  // Earlier cycle, 4–13 November, with a deliberately incomplete day.
  for (let i = 0; i < 10; i++) {
    const day = String(4 + i).padStart(2, '0');
    const date = `2026-11-${day}`;
    const m = +(11.9 + (i % 4) * .35).toFixed(1), e = +(8.1 + (i % 3) * .4).toFixed(1);
    addDay(date, {l:m}, i === 6 ? null : {l:e}, {rate:44.6});
  }
  // Oldest complete cycle, 25 October–3 November.
  for (let i = 0; i < 10; i++) {
    const d = new Date(Date.UTC(2026, 9, 25 + i));
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const m = +(12.3 + (i % 4) * .32).toFixed(1), e = +(8.1 + (i % 3) * .3).toFixed(1);
    addDay(date, {l:m}, {l:e}, {rate:44.2});
  }
  // Previous-month and previous-year reference dates, plus several older dates.
  addDay('2026-10-23', {l:11.8}, {l:8.2}, {rate:44.2});
  addDay('2025-11-23', {l:10.0}, {l:8.0}, {rate:42.5});
  addDay('2026-10-13', {l:12.4}, {l:8.5}, {rate:44.1});
  addDay('2026-10-03', {l:12.1}, {l:8.1}, {rate:44.0});

  const cycles = [
    {id:'cycle-1',start:'2026-10-25',end:'2026-11-03',type:'AUTOMATIC',label:'Cycle 01',sample:true},
    {id:'cycle-2',start:'2026-11-04',end:'2026-11-13',type:'AUTOMATIC',label:'Cycle 02',sample:true},
    {id:'cycle-3',start:'2026-11-14',end:'2026-11-23',type:'AUTOMATIC',label:'Cycle 03',sample:true}
  ];
  const payments = [
    {id:'pay-1',cycleId:'cycle-1',amount:9317.36,paymentDate:'2026-11-05',notes:'Settlement received',sample:true},
    {id:'pay-2',cycleId:'cycle-2',amount:7800,paymentDate:'2026-11-16',notes:'First instalment',sample:true}
  ];
  window.DairySampleData = {target, milkRecords, cycles, payments};
})();
