/* Versioned JSON validation and additive restore preview. No localStorage or remote upload. */
(() => {
  const FORMAT='our-dairy-farm-backup',VERSION=1;
  const TABLES=['farm_settings','milk_records','billing_cycles','payments','cattle'];
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ISO_TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
  const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
  const fail=message=>{throw new Error(message);};
  const required=(row,fields,type,index)=>fields.forEach(field=>{if(!own(row,field))fail(`${type}[${index}] is missing “${field}”.`);});
  function validate(backup){
    if(!isObject(backup))fail('The selected file must contain a JSON object.');
    if(backup.format!==FORMAT)fail('This is not an Our Dairy Farm backup file.');
    if(backup.version!==VERSION)fail(`Unsupported backup version “${String(backup.version)}”. This app supports version ${VERSION}.`);
    if(typeof backup.created_at!=='string'||!ISO_TIMESTAMP.test(backup.created_at)||Number.isNaN(Date.parse(backup.created_at)))fail('Backup creation time is invalid.');
    if(!isObject(backup.farm)||typeof backup.farm.name!=='string'||!backup.farm.name.trim()||typeof backup.farm.timezone!=='string')fail('Farm name or timezone is missing.');
    try{new Intl.DateTimeFormat('en',{timeZone:backup.farm.timezone});}catch{fail('The backup contains an invalid farm timezone.');}
    if(!isObject(backup.data))fail('Backup data is missing.');
    for(const table of TABLES)if(!Array.isArray(backup.data[table]))fail(`Backup data must include the “${table}” array.`);
    const d=backup.data;
    if(d.farm_settings.length>1)fail('A backup can contain at most one farm settings row.');
    const ids=new Map();
    const checkId=(row,type,index)=>{
      if(!isObject(row))fail(`${type}[${index}] must be an object.`);
      required(row,['id','created_at'],type,index);
      if(typeof row.id!=='string'||!UUID.test(row.id))fail(`${type}[${index}] has an invalid UUID.`);
      if(typeof row.created_at!=='string'||!ISO_TIMESTAMP.test(row.created_at)||Number.isNaN(Date.parse(row.created_at)))fail(`${type}[${index}] has an invalid created_at timestamp.`);
      const key=`${type}:${row.id}`;if(ids.has(key))fail(`${type} contains duplicate UUID ${row.id}.`);ids.set(key,true);
      if(own(row,'updated_at')&&(typeof row.updated_at!=='string'||!ISO_TIMESTAMP.test(row.updated_at)||Number.isNaN(Date.parse(row.updated_at))))fail(`${type}[${index}] has an invalid updated_at timestamp.`);
    };
    d.farm_settings.forEach((r,i)=>{
      checkId(r,'farm_settings',i);required(r,['singleton','farm_name','timezone','initial_setup_date','updated_at'],'farm_settings',i);
      if(r.singleton!==true||typeof r.farm_name!=='string'||!r.farm_name.trim()||r.farm_name.length>120||typeof r.timezone!=='string'||!validDate(r.initial_setup_date))fail(`farm_settings[${i}] has invalid values.`);
      try{new Intl.DateTimeFormat('en',{timeZone:r.timezone});}catch{fail(`farm_settings[${i}] has an invalid timezone.`);}
    });
    const milkKeys=new Set();
    d.milk_records.forEach((r,i)=>{
      checkId(r,'milk_records',i);required(r,['record_date','session','litres','fat_percent','snf_percent','rate_per_litre','amount','notes','updated_at'],'milk_records',i);
      if(!validDate(r.record_date)||!['MORNING','EVENING'].includes(r.session)||typeof r.litres!=='number'||!Number.isFinite(r.litres)||r.litres<=0||r.litres>9999999.999)fail(`milk_records[${i}] has an invalid date, session or milk amount.`);
      for(const [field,max] of [['fat_percent',999.99],['snf_percent',999.99],['rate_per_litre',99999999.99],['amount',9999999999.99]])if(r[field]!==null&&(typeof r[field]!=='number'||!Number.isFinite(r[field])||r[field]<0||r[field]>max))fail(`milk_records[${i}] has an invalid ${field}.`);
      if(r.notes!==null&&(typeof r.notes!=='string'||r.notes.length>2000))fail(`milk_records[${i}] notes must be text up to 2000 characters or null.`);
      const key=`${r.record_date}:${r.session}`;if(milkKeys.has(key))fail(`Backup contains more than one milk record for ${key}.`);milkKeys.add(key);
    });
    const cycleIds=new Set(),cycleRanges=[];
    d.billing_cycles.forEach((r,i)=>{
      checkId(r,'billing_cycles',i);required(r,['start_date','end_date','cycle_type'],'billing_cycles',i);
      if(!validDate(r.start_date)||!validDate(r.end_date)||!['AUTOMATIC','MANUAL_RESET'].includes(r.cycle_type))fail(`billing_cycles[${i}] has invalid values.`);
      const start=Date.parse(`${r.start_date}T00:00:00Z`),end=Date.parse(`${r.end_date}T00:00:00Z`),days=(end-start)/86400000+1;
      if(days<1||days>10||(r.cycle_type==='AUTOMATIC'&&days!==10))fail(`billing_cycles[${i}] has an invalid date range.`);
      if(cycleIds.has(r.id))fail(`Backup contains a duplicate billing cycle UUID ${r.id}.`);cycleIds.add(r.id);cycleRanges.push({start:r.start_date,end:r.end_date,id:r.id});
    });
    cycleRanges.sort((a,b)=>a.start.localeCompare(b.start));
    for(let i=1;i<cycleRanges.length;i++)if(cycleRanges[i].start<=cycleRanges[i-1].end)fail('Billing cycles in the backup overlap each other.');
    const cattleKeys=new Set();
    d.cattle.forEach((r,i)=>{
      checkId(r,'cattle',i);required(r,['name','status','date_of_birth','notes','updated_at'],'cattle',i);
      if(typeof r.name!=='string'||!r.name.trim()||r.name.trim().length>120||!['ACTIVE','INACTIVE'].includes(r.status)||(r.date_of_birth!==null&&!validDate(r.date_of_birth))||(r.notes!==null&&(typeof r.notes!=='string'||r.notes.length>2000)))fail(`cattle[${i}] has invalid values.`);
      const key=`${r.name.trim().toLocaleLowerCase()}:${r.date_of_birth||''}`;if(cattleKeys.has(key))fail('Backup contains duplicate cattle with the same name and date of birth.');cattleKeys.add(key);
    });
    d.payments.forEach((r,i)=>{
      checkId(r,'payments',i);required(r,['billing_cycle_id','payment_date','amount_received','notes','updated_at'],'payments',i);
      if(typeof r.billing_cycle_id!=='string'||!UUID.test(r.billing_cycle_id)||!cycleIds.has(r.billing_cycle_id))fail(`payments[${i}] refers to a billing cycle that is not included in this backup.`);
      if(!validDate(r.payment_date)||typeof r.amount_received!=='number'||!Number.isFinite(r.amount_received)||r.amount_received<=0||r.amount_received>9999999999.99||(r.notes!==null&&(typeof r.notes!=='string'||r.notes.length>2000)))fail(`payments[${i}] has invalid values.`);
    });
    const setting=d.farm_settings[0];
    if(setting&&(setting.farm_name!==backup.farm.name||setting.timezone!==backup.farm.timezone))fail('Backup farm metadata does not match the farm settings row.');
    return backup;
  }
  function preview(backup,current){
    validate(backup);
    const categories={};const details=[];let safeCycleIds=new Set();
    const classify=(type,source,existing,matchExact,conflictCheck)=>{
      const result={new:0,skipped:0,conflicts:0,unrestorable:0};
      for(const row of source){
        const byId=existing.find(item=>item.id===row.id);
        if(byId){if(matchExact(byId,row)){result.skipped++;if(type==='billing_cycles')safeCycleIds.add(row.id);}else{result.conflicts++;details.push({type,id:row.id,reason:'Matching UUID exists with different data.'});}continue;}
        const reason=conflictCheck?.(row,existing);
        if(reason){result.conflicts++;details.push({type,id:row.id,reason});continue;}
        if(type==='billing_cycles'){
          const overlaps=[...existing,...backup.data.billing_cycles.filter(c=>c.id!==row.id&&safeCycleIds.has(c.id))].some(c=>row.start_date<=c.end_date&&row.end_date>=c.start_date);
          if(overlaps){result.conflicts++;details.push({type,id:row.id,reason:'This cycle overlaps an existing or already accepted backup cycle.'});continue;}
          safeCycleIds.add(row.id);
        }
        if(type==='payments'&&!safeCycleIds.has(row.billing_cycle_id)){result.unrestorable++;details.push({type,id:row.id,reason:'The linked cycle has a conflict and cannot be restored safely.'});continue;}
        result.new++;
      }
      categories[type]=result;
    };
    const exact=(a,b)=>Object.keys(b).every(k=>a[k]===b[k]);
    classify('farm_settings',backup.data.farm_settings,current.farm_settings,exact,(row,existing)=>existing.length?'The connected farm already has different settings.':'');
    classify('billing_cycles',backup.data.billing_cycles,current.billing_cycles,exact,()=>null);
    classify('milk_records',backup.data.milk_records,current.milk_records,exact,(row,existing)=>existing.some(r=>r.record_date===row.record_date&&r.session===row.session)?'A different record already exists for this date and session.':null);
    classify('cattle',backup.data.cattle,current.cattle,exact,(row,existing)=>existing.some(r=>r.name.trim().toLocaleLowerCase()===row.name.trim().toLocaleLowerCase()&&r.date_of_birth===row.date_of_birth)?'A cattle record with the same name and birth date already exists.':null);
    classify('payments',backup.data.payments,current.payments,exact,(row,existing)=>existing.some(r=>r.billing_cycle_id===row.billing_cycle_id&&r.payment_date===row.payment_date&&Number(r.amount_received)===Number(row.amount_received)&&r.notes===row.notes)?'An identical payment already exists.':null);
    return {categories,details,total:Object.values(categories).reduce((sum,c)=>sum+c.new,0),conflicts:Object.values(categories).reduce((sum,c)=>sum+c.conflicts,0),skipped:Object.values(categories).reduce((sum,c)=>sum+c.skipped,0),unrestorable:Object.values(categories).reduce((sum,c)=>sum+c.unrestorable,0)};
  }
  window.DairyBackupRestore=Object.freeze({format:FORMAT,version:VERSION,validate,preview});
})();
