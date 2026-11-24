/* Pure milk calculations: no DOM, storage or Supabase access. */
(() => {
  const recordBy = (records, date, session) => records.find(r => r.date === date && r.session === session);
  function dayState(records, date) {
    const morning = recordBy(records, date, 'MORNING');
    const evening = recordBy(records, date, 'EVENING');
    return {
      morning,
      evening,
      total: Number(morning?.litres || 0) + Number(evening?.litres || 0),
      complete: Boolean(morning && evening),
      has: Boolean(morning || evening)
    };
  }
  function matchingDate(date, unit, amount) {
    if (!date) return null;
    const [year, month, day] = date.split('-').map(Number);
    if (unit === 'day') {
      const target = new Date(Date.UTC(year, month - 1, day + amount));
      return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
    }
    const targetMonth = unit === 'month' ? month - 1 + amount : month - 1 + amount * 12;
    const targetYear = year + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    if (day > lastDay) return null;
    return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function comparisonRows(records, selected) {
    const periods = [
      ['Selected day', selected],
      ['Same weekday last week', matchingDate(selected, 'day', -7)],
      ['Same date last month', matchingDate(selected, 'month', -1)],
      ['Same date last year', matchingDate(selected, 'year', -1)]
    ];
    const current = periods[0][1] ? dayState(records, periods[0][1]) : { has: false, total: 0 };
    return periods.map(([label, date], index) => {
      if (!date) return { label, date: null, state: null, diff: null };
      const state = dayState(records, date);
      return { label, date, state, diff: index === 0 || !current.has || !state.has ? null : current.total - state.total };
    });
  }
  function cycleTotals(cycle, records, payments) {
    const rows=records.filter(record=>record.date>=cycle.start&&record.date<=cycle.end);
    const sumLitres=arr=>arr.reduce((total,record)=>total+Number(record.litres||0),0);
    const roundCents=value=>Math.round((Number(value)||0)*100)/100;
    const weighted=(key)=>{
      const available=rows.filter(record=>record[key]!=null);
      const litres=available.reduce((total,record)=>total+Number(record.litres||0),0);
      return litres?available.reduce((total,record)=>total+Number(record.litres)*Number(record[key]),0)/litres:null;
    };
    const recordedAmount=roundCents(rows.reduce((total,record)=>total+(record.amount==null?0:Number(record.amount)),0));
    const estimatedAmount=roundCents(rows.reduce((total,record)=>total+(record.amount==null&&record.rate!=null?Math.round(Number(record.litres)*Number(record.rate)*100)/100:0),0));
    const cyclePayments=payments.filter(payment=>payment.cycleId===cycle.id);
    const actualPayments=roundCents(cyclePayments.reduce((total,payment)=>total+Number(payment.amount||0),0));
    const totalLitres=sumLitres(rows);
    const days=Math.max(1,Math.round((new Date(`${cycle.end}T00:00:00Z`)-new Date(`${cycle.start}T00:00:00Z`))/86400000)+1);
    return {
      records:rows,payments:cyclePayments,totalLitres,averageDailyMilk:totalLitres/days,
      recordedAmount,estimatedAmount,weightedFat:weighted('fat'),weightedSnf:weighted('snf'),weightedRate:weighted('rate'),
      actualPayments,paymentDifference:roundCents(actualPayments-recordedAmount-estimatedAmount)
    };
  }
  function monthRows(records, month) {
    const monthRecords=records.filter(record=>record.date.slice(0,7)===month);
    const dates=[...new Set(monthRecords.map(record=>record.date))].sort();
    const rows=dates.map(date=>{
      const state=dayState(monthRecords,date);
      const entries=monthRecords.filter(record=>record.date===date);
      const recordedAmount=entries.reduce((sum,record)=>sum+(record.amount==null?0:Number(record.amount)),0);
      const estimatedAmount=entries.reduce((sum,record)=>sum+(record.amount==null&&record.rate!=null?Math.round(Number(record.litres)*Number(record.rate)*100)/100:0),0);
      return {date,state,records:entries,recordedAmount,estimatedAmount};
    });
    const totalLitres=monthRecords.reduce((sum,record)=>sum+Number(record.litres||0),0);
    return {
      rows,totalLitres,
      averageDailyMilk:dates.length?totalLitres/dates.length:null,
      recordedAmount:monthRecords.reduce((sum,record)=>sum+(record.amount==null?0:Number(record.amount)),0),
      estimatedAmount:monthRecords.reduce((sum,record)=>sum+(record.amount==null&&record.rate!=null?Math.round(Number(record.litres)*Number(record.rate)*100)/100:0),0),
      daysWithRecords:dates.length,
      incompleteDays:rows.filter(row=>row.state.has&&!row.state.complete).length
    };
  }
  function cycleDates(cycle) {
    const dates=[];
    const [year,month,day]=cycle.start.split('-').map(Number);
    const end=`${cycle.end}T00:00:00Z`;
    for(let cursor=new Date(Date.UTC(year,month-1,day));cursor.toISOString().slice(0,10)<=end.slice(0,10);cursor.setUTCDate(cursor.getUTCDate()+1)){
      dates.push(cursor.toISOString().slice(0,10));
    }
    return dates;
  }
  window.DairyMilkCalculations = Object.freeze({ dayState, matchingDate, comparisonRows, cycleTotals, monthRows, cycleDates });
})();
