/* Supabase data operations for the farm's milk, billing and cattle records. */
(() => {
  const client = () => {
    const database = window.DairyDatabase;
    if (!database?.client) throw new Error(database?.initializationError || 'Supabase is unavailable.');
    return database.client;
  };
  const table = () => {
    return client().from('milk_records');
  };
  const fromRow = row => ({
    id: row.id,
    date: row.record_date,
    session: row.session,
    litres: Number(row.litres),
    fat: row.fat_percent == null ? null : Number(row.fat_percent),
    snf: row.snf_percent == null ? null : Number(row.snf_percent),
    rate: row.rate_per_litre == null ? null : Number(row.rate_per_litre),
    amount: row.amount == null ? null : Number(row.amount),
    notes: row.notes || '',
    time: row.created_at ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(row.created_at)) : 'recorded'
  });
  const toRow = record => ({
    record_date: record.date,
    session: record.session,
    litres: record.litres,
    fat_percent: record.fat,
    snf_percent: record.snf,
    rate_per_litre: record.rate,
    amount: record.amount,
    notes: record.notes || null
  });
  const cycleFromRow = row => ({
    id:row.id,start:row.start_date,end:row.end_date,type:row.cycle_type,
    label:row.cycle_type==='MANUAL_RESET'?'Manual reset':`Cycle ${row.start_date}`
  });
  const paymentFromRow = row => ({
    id:row.id,cycleId:row.billing_cycle_id,paymentDate:row.payment_date,
    amount:Number(row.amount_received),notes:row.notes||''
  });
  const cattleFromRow = row => ({
    id:row.id,name:row.name,status:row.status,dob:row.date_of_birth,notes:row.notes||''
  });
  async function list() {
    const pageSize=1000, rows=[];
    for(let offset=0;;offset+=pageSize){
      const { data, error } = await table()
        .select('id,record_date,session,litres,fat_percent,snf_percent,rate_per_litre,amount,notes,created_at')
        .order('record_date', { ascending: false })
        .order('session', { ascending: true })
        .range(offset,offset+pageSize-1);
      if (error) throw error;
      rows.push(...(data||[]));
      if(!data||data.length<pageSize)break;
    }
    return rows.map(fromRow);
  }
  async function save(record) {
    const payload = toRow(record);
    const query = record.id
      ? table().update(payload).eq('id', record.id)
      : table().insert(payload);
    const { data, error } = await query
      .select('id,record_date,session,litres,fat_percent,snf_percent,rate_per_litre,amount,notes,created_at')
      .single();
    if (error) throw error;
    return fromRow(data);
  }
  async function listCycles() {
    const pageSize=1000,rows=[];
    for(let offset=0;;offset+=pageSize){
      const {data,error}=await client().from('billing_cycles').select('*')
        .order('start_date',{ascending:false}).order('id',{ascending:true}).range(offset,offset+pageSize-1);
      if(error)throw error;
      rows.push(...(data||[]));if(!data||data.length<pageSize)break;
    }
    return rows.map(cycleFromRow);
  }
  async function listPayments() {
    const pageSize=1000,rows=[];
    for(let offset=0;;offset+=pageSize){
      const {data,error}=await client().from('payments').select('*')
        .order('payment_date',{ascending:false}).order('id',{ascending:true}).range(offset,offset+pageSize-1);
      if(error)throw error;
      rows.push(...(data||[]));if(!data||data.length<pageSize)break;
    }
    return rows.map(paymentFromRow);
  }
  async function savePayment(payment) {
    const {data,error}=await window.DairyDatabase.client.from('payments').insert({
      billing_cycle_id:payment.cycleId,payment_date:payment.paymentDate,
      amount_received:payment.amount,notes:payment.notes||null
    }).select('id,billing_cycle_id,payment_date,amount_received,notes').single();
    if(error)throw error;
    return paymentFromRow(data);
  }
  async function resetCycle() {
    const {data,error}=await window.DairyDatabase.client.rpc('reset_billing_cycle');
    if(error)throw error;
    return data;
  }
  async function listCattle() {
    const pageSize=1000,rows=[];
    for(let offset=0;;offset+=pageSize){
      const {data,error}=await client().from('cattle')
        .select('id,name,status,date_of_birth,notes').order('name',{ascending:true})
        .range(offset,offset+pageSize-1);
      if(error)throw error;
      rows.push(...(data||[]));
      if(!data||data.length<pageSize)break;
    }
    return rows.map(cattleFromRow);
  }
  async function getFarmSettings() {
    const {data,error}=await client().from('farm_settings')
      .select('farm_name,timezone').limit(1).maybeSingle();
    if(error)throw error;
    return data?{farmName:data.farm_name,timezone:data.timezone||'Asia/Kolkata'}:null;
  }
  async function fetchBackupSnapshot() {
    const db=client(),pageSize=1000;
    const [settingsResult,milkRecords,billingCycles,payments,cattle]=await Promise.all([
      db.from('farm_settings').select('*').order('id',{ascending:true}).limit(2),
      allRows('milk_records','record_date'),
      allRows('billing_cycles','start_date'),
      allRows('payments','payment_date'),
      allRows('cattle','name')
    ]);
    if(settingsResult.error)throw settingsResult.error;
    if((settingsResult.data||[]).length>1)throw new Error('The farm settings table returned more than one row. Backup stopped.');
    return {farm_settings:settingsResult.data||[],milk_records:milkRecords,billing_cycles:billingCycles,payments,cattle};
    async function allRows(tableName,orderColumn){
      const rows=[];
      for(let offset=0;;offset+=pageSize){
        const {data,error}=await db.from(tableName).select('*').order(orderColumn,{ascending:true}).order('id',{ascending:true}).range(offset,offset+pageSize-1);
        if(error)throw error;
        rows.push(...(data||[]));if(!data||data.length<pageSize)break;
      }
      return rows;
    }
  }
  async function restoreBackup(backup){
    const {data,error}=await client().rpc('restore_farm_backup',{p_backup:backup});
    if(error)throw error;
    return data;
  }
  async function saveCattle(cattle) {
    const payload={name:cattle.name,status:cattle.status,date_of_birth:cattle.dob,notes:cattle.notes||null};
    const query=cattle.id
      ? client().from('cattle').update(payload).eq('id',cattle.id)
      : client().from('cattle').insert(payload);
    const {data,error}=await query.select('id,name,status,date_of_birth,notes').single();
    if(error)throw error;
    return cattleFromRow(data);
  }
  window.DairyMilkRepository = Object.freeze({ list, save, listCycles, listPayments, savePayment, resetCycle, listCattle, saveCattle, getFarmSettings, fetchBackupSnapshot, restoreBackup });
})();
