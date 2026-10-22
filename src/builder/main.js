import {loadProject,saveProject,clearProject} from './project-store.js';
import {parseCSV,guessMapping,rowsFromMapping,importXlsx,listXlsxSheets,importPdf,heuristicRowsFromPdf,rowsFromStructuredPackage} from './importers.js';
import {buildPackage,packageZip} from './package.js';
import {createBuilderProjectFile,readBuilderProjectFile} from './project-file.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const FIELDS=['date','start','end','type','session','title','speaker','chair','affiliation','location','track','posterNumber','abstract','doi'];
const LABELS={date:'Date',start:'Start',end:'End',type:'Type',session:'Session',title:'Title',speaker:'Speaker / author',chair:'Chair',affiliation:'Affiliation',location:'Location',track:'Track',posterNumber:'Poster #',abstract:'Abstract',doi:'DOI / link'};
const defaults={
  conference:{name:'',shortName:'',startDate:'',endDate:'',timezone:'Europe/Helsinki',city:'',country:'',officialWebsite:'',contactEmail:'',venueName:'',venueAddress:''},
  rows:[],features:{photos:true,notes:true,pptxExport:true,friendBook:true,calendarExport:true,announcements:true},policy:{requireAffiliation:false,requireAbstract:false,requireChair:false},branding:{primary:'#5b4b9a',secondary:'#2f7d68',accent:'#5b4b9a',trackColors:{},locationColors:{},headerStyle:'text',darkMode:true},peopleOverrides:{},locationOverrides:{},sessionOverrides:{},peoplePhotos:{},extraPeople:[],extraLocations:[],announcements:[],deletedSourceIds:[],sourceFiles:[],dataVersion:1,lastPublishedVersion:0,changelog:[],releaseMessage:'Initial Builder release',sourceState:[],mapping:{},identityRegistry:{people:{},locations:{},tracks:{}},logo:null,appIcon:null,sponsorFiles:[]
};
let project=structuredClone(defaults),rawRows=[],rawHeaders=[],saveTimer=null,pdfPages=[],pendingXlsxFile=null,pendingXlsxSourceId='',selectedRows=new Set();

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800);}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveProject(project),200);}
function bindConfig(){
  $$('[data-config]').forEach(input=>{input.value=project.conference[input.dataset.config]||'';input.addEventListener('input',()=>{project.conference[input.dataset.config]=input.value;scheduleSave();renderDerived();});});
  $$('[data-feature]').forEach(input=>{input.checked=project.features[input.dataset.feature]!==false;input.addEventListener('change',()=>{project.features[input.dataset.feature]=input.checked;scheduleSave();});});
  $$('[data-policy]').forEach(input=>{input.checked=!!project.policy?.[input.dataset.policy];input.addEventListener('change',()=>{project.policy={...(project.policy||{}),[input.dataset.policy]:input.checked};scheduleSave();renderDerived();});});
  $('#primaryColor').value=project.branding.primary;$('#secondaryColor').value=project.branding.secondary;$('#accentColor').value=project.branding.accent;
  ['primaryColor','secondaryColor','accentColor'].forEach(id=>$('#'+id).addEventListener('input',e=>{project.branding[id.replace('Color','')]=e.target.value;scheduleSave();renderDerived();}));
  $('#headerStyle').value=project.branding.headerStyle||'text';$('#typography').value=project.branding.typography||'system';$('#brandingDarkMode').checked=project.branding.darkMode!==false;
  $('#headerStyle').addEventListener('change',e=>{project.branding.headerStyle=e.target.value;scheduleSave();});
  $('#typography').addEventListener('change',e=>{project.branding.typography=e.target.value;scheduleSave();});
  $('#brandingDarkMode').addEventListener('change',e=>{project.branding.darkMode=e.target.checked;scheduleSave();});
  $('#dataVersion').value=project.dataVersion||1;$('#releaseMessage').value=project.releaseMessage||'';
  $('#dataVersion').addEventListener('input',e=>{project.dataVersion=Number(e.target.value)||1;scheduleSave();});
  $('#releaseMessage').addEventListener('input',e=>{project.releaseMessage=e.target.value;scheduleSave();});
}

function mappingOptions(selected=''){return `<option value="">— not mapped —</option>${rawHeaders.map(h=>`<option ${h===selected?'selected':''}>${escapeHtml(h)}</option>`).join('')}`;}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

function updateSelectedCount(){const el=$('#selectedRowCount');if(el)el.textContent=`${selectedRows.size} selected`;const all=$('#selectAllRows');if(all){const visible=project.rows.map(r=>r.id);all.checked=!!visible.length&&visible.every(id=>selectedRows.has(id));all.indeterminate=visible.some(id=>selectedRows.has(id))&&!all.checked;}}
function initBulkEditor(){const field=$('#bulkField');if(!field)return;field.innerHTML=FIELDS.map(f=>`<option value="${f}">${escapeHtml(LABELS[f])}</option>`).join('');$('#applyBulkEdit')?.addEventListener('click',()=>{if(!selectedRows.size)return toast('Select at least one row');const key=field.value,value=$('#bulkValue').value;const calendarFields=new Set(['date','start','end','title','location','session']);let changed=0;for(const row of project.rows){if(!selectedRows.has(row.id))continue;const before=String(row[key]??'');row[key]=value;row.manualFields={...(row.manualFields||{}),[key]:true};if(calendarFields.has(key)&&before!==String(value))row.sequence=Number(row.sequence||0)+1;changed++;}scheduleSave();renderRows();renderDerived();toast(`Updated ${changed} row${changed===1?'':'s'}`);});$('#selectAllRows')?.addEventListener('change',e=>{if(e.target.checked)project.rows.forEach(r=>selectedRows.add(r.id));else selectedRows.clear();renderRows();});}
function sessionFieldInput(session,field,locations,tracks){const value=session[field]??'';if(field==='locationId')return `<select data-session-field="locationId"><option value="">— none —</option>${locations.map(l=>`<option value="${escapeHtml(l.id)}" ${l.id===value?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select>`;if(field==='trackId')return `<select data-session-field="trackId"><option value="">— none —</option>${tracks.map(t=>`<option value="${escapeHtml(t.id)}" ${t.id===value?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select>`;const type=field==='date'?'date':(['start','end'].includes(field)?'time':'text');return `<input type="${type}" data-session-field="${field}" value="${escapeHtml(value)}">`;}
function renderSessionEditor(sessions,locations,tracks){const root=$('#sessionPreview');if(!root)return;const bySessionId=new Map((sessions||[]).map(s=>[s.id,s]));root.innerHTML=(sessions||[]).map(s=>`<div class="session-card" data-session-id="${escapeHtml(s.id)}"><div class="session-card-head"><strong>${escapeHtml(s.title||'Session')}</strong><code>${escapeHtml(s.id)}</code></div><div class="session-card-grid"><label>Title${sessionFieldInput(s,'title',locations,tracks)}</label><label>Date${sessionFieldInput(s,'date',locations,tracks)}</label><label>Start${sessionFieldInput(s,'start',locations,tracks)}</label><label>End${sessionFieldInput(s,'end',locations,tracks)}</label><label>Location${sessionFieldInput(s,'locationId',locations,tracks)}</label><label>Track${sessionFieldInput(s,'trackId',locations,tracks)}</label></div></div>`).join('')||'<span class="muted">No sessions yet.</span>';root.querySelectorAll('[data-session-field]').forEach(el=>el.addEventListener('change',()=>{const card=el.closest('[data-session-id]'),id=card.dataset.sessionId,field=el.dataset.sessionField;const current=project.sessionOverrides?.[id]||{};const before=String(bySessionId.get(id)?.[field]??'');const value=el.value;project.sessionOverrides={...(project.sessionOverrides||{}),[id]:{...current,[field]:value,sequenceBump:Number(current.sequenceBump||0)+(before!==String(value)?1:0)}};scheduleSave();renderDerivedDebounced();}));}

function showMapping(mapping){project.mapping=mapping;const grid=$('#mappingGrid');grid.innerHTML=FIELDS.map(f=>`<label>${LABELS[f]}<select data-map="${f}">${mappingOptions(mapping[f])}</select></label>`).join('');$('#mappingCard').hidden=false;}
function mergeImportedRows(nextRows){
  const oldBySource=new Map((project.rows||[]).filter(r=>r.source?.id).map(r=>[r.source.id,r]));
  const deleted=new Set(project.deletedSourceIds||[]), conflicts=[];
  const calendarFields=new Set(['date','start','end','title','location','session']);
  const mergedRows=nextRows.filter(r=>!deleted.has(r.source?.id)).map(r=>{
    const old=oldBySource.get(r.source?.id);if(!old)return r;
    const merged={...r,id:old.id||r.id,manualFields:{...(old.manualFields||{})},calendarUid:old.calendarUid||r.calendarUid,sequence:Number(old.sequence||0),entityId:old.entityId||r.entityId,sessionId:old.sessionId||r.sessionId,posterSessionId:old.posterSessionId||r.posterSessionId,posterSessionCalendarUid:old.posterSessionCalendarUid||r.posterSessionCalendarUid,locationEntityId:old.locationEntityId||r.locationEntityId,trackEntityId:old.trackEntityId||r.trackEntityId,speakerEntityIds:[...(old.speakerEntityIds||r.speakerEntityIds||[])],chairEntityIds:[...(old.chairEntityIds||r.chairEntityIds||[])]};
    let calendarChanged=false;
    for(const field of FIELDS){
      if(old.manualFields?.[field]){
        if(String(r[field]??'')!==String(old[field]??''))conflicts.push(`${r.source?.id}: source changed ${field}; preserved organizer edit`);
        merged[field]=old[field];
      } else if(calendarFields.has(field)&&String(r[field]??'')!==String(old[field]??'')) calendarChanged=true;
    }
    if(calendarChanged)merged.sequence=Number(old.sequence||0)+1;
    return merged;
  });
  project.reimportConflicts=conflicts;
  return mergedRows;
}
function applyMapping(){const mapping={};$$('[data-map]').forEach(s=>mapping[s.dataset.map]=s.value);project.mapping=mapping;project.rows=mergeImportedRows(rowsFromMapping(rawRows,mapping));project.sourceState=rawRows.map((row,i)=>({sourceId:`${row.__sourceFileId||'source'}:${row.__sheet||'source'}:${row.__sourceRow||i+1}`,raw:row,mapping}));scheduleSave();renderRows();renderDerived();toast('Mapping applied');}

function rowInput(row,index,field){const value=row[field]??'';if(field==='type'){return `<select data-row="${index}" data-field="type"><option ${value==='talk'?'selected':''}>talk</option><option ${value==='plenary'?'selected':''}>plenary</option><option ${value==='keynote'?'selected':''}>keynote</option><option ${value==='special'?'selected':''}>special</option><option ${value==='break'?'selected':''}>break</option><option ${value==='meal'?'selected':''}>meal</option><option ${value==='social'?'selected':''}>social</option><option ${value==='registration'?'selected':''}>registration</option><option ${value==='poster'?'selected':''}>poster</option></select>`;}if(field==='abstract')return `<textarea data-row="${index}" data-field="${field}" rows="2">${escapeHtml(value)}</textarea>`;const type=field==='date'?'date':(field==='start'||field==='end')?'time':'text';return `<input type="${type}" data-row="${index}" data-field="${field}" value="${escapeHtml(value)}">`;}
function renderRows(){
  const body=$('#reviewTable tbody');
  body.innerHTML=project.rows.map((r,i)=>`<tr><td><input type="checkbox" data-select-row="${escapeHtml(r.id)}" ${selectedRows.has(r.id)?'checked':''} aria-label="Select row ${i+1}"></td>${FIELDS.map(f=>`<td>${rowInput(r,i,f)}</td>`).join('')}<td><button class="row-delete" data-delete-row="${i}" title="Delete">×</button></td></tr>`).join('');
  $('#rowCount').textContent=`${project.rows.length} rows`;
  body.querySelectorAll('[data-select-row]').forEach(el=>el.addEventListener('change',()=>{if(el.checked)selectedRows.add(el.dataset.selectRow);else selectedRows.delete(el.dataset.selectRow);updateSelectedCount();}));
  body.querySelectorAll('[data-row]').forEach(el=>el.addEventListener('input',()=>{const r=project.rows[Number(el.dataset.row)],field=el.dataset.field,oldValue=r[field];r[field]=el.value;r.manualFields={...(r.manualFields||{}),[field]:true};if(['date','start','end','title','location','session'].includes(field)&&String(oldValue??'')!==String(el.value??''))r.sequence=Number(r.sequence||0)+1;scheduleSave();renderDerivedDebounced();}));
  body.querySelectorAll('[data-delete-row]').forEach(btn=>btn.addEventListener('click',()=>{const idx=Number(btn.dataset.deleteRow),row=project.rows[idx];if(row?.source?.id)project.deletedSourceIds=[...new Set([...(project.deletedSourceIds||[]),row.source.id])];if(row?.id)selectedRows.delete(row.id);project.rows.splice(idx,1);scheduleSave();renderRows();renderDerived();}));
  updateSelectedCount();
}

let deriveTimer=null;function renderDerivedDebounced(){clearTimeout(deriveTimer);deriveTimer=setTimeout(renderDerived,150);}

function renderAnnouncementsBuilder(){
  const root=$('#announcementRows');if(!root)return;
  root.innerHTML=(project.announcements||[]).map((a,i)=>`<div class="announcement-row"><input type="datetime-local" data-ann-index="${i}" data-ann-field="timestamp" value="${escapeHtml(a.timestamp?String(a.timestamp).slice(0,16):'')}"><input data-ann-index="${i}" data-ann-field="message" value="${escapeHtml(a.message||'')}" placeholder="Message"><input data-ann-index="${i}" data-ann-field="affected" value="${escapeHtml((a.affectedIds||[]).join(', '))}" placeholder="Affected entity IDs"><button type="button" data-ann-delete="${i}" aria-label="Delete">×</button></div>`).join('')||'<span class="muted">No announcements configured.</span>';
  root.querySelectorAll('[data-ann-index]').forEach(el=>el.addEventListener('input',()=>{const a=project.announcements[Number(el.dataset.annIndex)];if(el.dataset.annField==='affected')a.affectedIds=el.value.split(',').map(x=>x.trim()).filter(Boolean);else if(el.dataset.annField==='timestamp')a.timestamp=el.value?new Date(el.value).toISOString():'';else a[el.dataset.annField]=el.value;scheduleSave();renderDerivedDebounced();}));
  root.querySelectorAll('[data-ann-delete]').forEach(btn=>btn.addEventListener('click',()=>{project.announcements.splice(Number(btn.dataset.annDelete),1);scheduleSave();renderAnnouncementsBuilder();renderDerived();}));
}

function renderPeopleEditor(rows){
  const root=$('#peoplePreview');if(!root)return;
  const extraIds=new Set((project.extraPeople||[]).map(x=>x.id));
  root.innerHTML=(rows||[]).map(p=>{const asset=project.peoplePhotos?.[p.id];return `<div class="entity-editor" data-person-editor="${escapeHtml(p.id)}"><div class="entity-editor-head"><strong>${escapeHtml(p.name||'Person')}</strong><code>${escapeHtml(p.id)}</code>${extraIds.has(p.id)?`<button class="entity-remove" type="button" data-remove-person="${escapeHtml(p.id)}">×</button>`:''}</div><div class="entity-editor-grid"><label>Name<input data-person-field="name" value="${escapeHtml(p.name||'')}"></label><label>Position<input data-person-field="position" value="${escapeHtml(p.position||'')}"></label><label>Affiliation<input data-person-field="affiliation" value="${escapeHtml((p.affiliations||[]).join('; '))}"></label><label>Public email<input data-person-field="publicEmail" type="email" value="${escapeHtml(p.publicEmail||'')}"></label><label>ORCID<input data-person-field="orcid" value="${escapeHtml(p.orcid||'')}"></label><label>Website<input data-person-field="website" type="url" value="${escapeHtml((p.links||[]).find(x=>x.label==='Website')?.url||p.website||'')}"></label><label>Photo URL / asset path<input data-person-field="photoUrl" value="${escapeHtml(p.photoUrl||'')}" placeholder="https://… or assets/person.jpg"></label><label>Upload photo<input data-person-photo="${escapeHtml(p.id)}" type="file" accept="image/png,image/jpeg,image/webp"><span class="muted">${escapeHtml(asset?.name||'No uploaded photo')}</span></label></div></div>`;}).join('')||'<span class="muted">No people yet</span>';
  root.querySelectorAll('[data-person-field]').forEach(el=>el.addEventListener('change',()=>{const card=el.closest('[data-person-editor]'),id=card.dataset.personEditor,field=el.dataset.personField;const extra=(project.extraPeople||[]).find(x=>x.id===id);if(extra)extra[field]=el.value;else project.peopleOverrides[id]={...(project.peopleOverrides[id]||{}),[field]:el.value};scheduleSave();renderDerivedDebounced();}));
  root.querySelectorAll('[data-person-photo]').forEach(el=>el.addEventListener('change',async()=>{const file=el.files?.[0];if(!file)return;const id=el.dataset.personPhoto;project.peoplePhotos={...(project.peoplePhotos||{}),[id]:await assetFromFile(file)};scheduleSave();renderDerived();toast('Speaker photo stored in Builder project');}));
  root.querySelectorAll('[data-remove-person]').forEach(btn=>btn.addEventListener('click',()=>{project.extraPeople=(project.extraPeople||[]).filter(x=>x.id!==btn.dataset.removePerson);if(project.peoplePhotos)delete project.peoplePhotos[btn.dataset.removePerson];scheduleSave();renderDerived();}));
}

function renderLocationEditor(locations,tracks){
  const root=$('#locationsPreview');if(!root)return;
  const extraIds=new Set((project.extraLocations||[]).map(x=>x.id));
  const parentOptions=(locations||[]).filter(x=>x.type==='venue').map(v=>`<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('');
  const locationHtml=(locations||[]).map(l=>`<div class="entity-editor" data-location-editor="${escapeHtml(l.id)}"><div class="entity-editor-head"><strong>${escapeHtml(l.name||'Location')}</strong><code>${escapeHtml(l.id)}</code>${extraIds.has(l.id)?`<button class="entity-remove" type="button" data-remove-location="${escapeHtml(l.id)}">×</button>`:''}</div><div class="entity-editor-grid"><label>Name<input data-location-field="name" value="${escapeHtml(l.name||'')}"></label><label>Type<select data-location-field="type"><option value="venue" ${l.type==='venue'?'selected':''}>venue</option><option value="room" ${l.type==='room'?'selected':''}>room</option></select></label><label>Parent venue<select data-location-field="parentLocationId"><option value="">— none —</option>${parentOptions.replace(`value="${l.parentLocationId}"`,`value="${l.parentLocationId}" selected`)}</select></label><label>Address<input data-location-field="address" value="${escapeHtml(l.address||'')}"></label><label>Map URL<input data-location-field="mapUrl" type="url" value="${escapeHtml(l.mapUrl||'')}"></label><label>Latitude<input data-location-field="lat" type="number" step="any" value="${escapeHtml(l.lat??'')}"></label><label>Longitude<input data-location-field="lon" type="number" step="any" value="${escapeHtml(l.lon??'')}"></label><label>Display color<div class="color-row"><span>${escapeHtml(project.branding.locationColors?.[l.id]||'default')}</span><input type="color" data-location-color="${escapeHtml(l.id)}" value="${escapeHtml(project.branding.locationColors?.[l.id]||project.branding.primary||'#5b4b9a')}"></div></label></div></div>`).join('');
  const trackHtml=(tracks||[]).map(t=>`<div class="entity-editor"><div class="entity-editor-head"><strong>${escapeHtml(t.name)}</strong><code>track · ${escapeHtml(t.id)}</code></div><div class="entity-editor-grid"><label>Track color<div class="color-row"><span>${escapeHtml(project.branding.trackColors?.[t.id]||'default')}</span><input type="color" data-track-color="${escapeHtml(t.id)}" value="${escapeHtml(project.branding.trackColors?.[t.id]||project.branding.primary||'#5b4b9a')}"></div></label></div></div>`).join('');
  root.innerHTML=locationHtml+trackHtml||'<span class="muted">No locations/tracks yet</span>';
  root.querySelectorAll('[data-location-field]').forEach(el=>el.addEventListener('change',()=>{const card=el.closest('[data-location-editor]'),id=card.dataset.locationEditor,field=el.dataset.locationField;let value=el.value;if(['lat','lon'].includes(field))value=value===''?undefined:Number(value);const extra=(project.extraLocations||[]).find(x=>x.id===id);if(extra)extra[field]=value;else project.locationOverrides[id]={...(project.locationOverrides[id]||{}),[field]:value||value===0?value:undefined};scheduleSave();renderDerivedDebounced();}));
  root.querySelectorAll('[data-location-color]').forEach(el=>el.addEventListener('input',()=>{project.branding.locationColors={...(project.branding.locationColors||{}),[el.dataset.locationColor]:el.value};scheduleSave();}));
  root.querySelectorAll('[data-track-color]').forEach(el=>el.addEventListener('input',()=>{project.branding.trackColors={...(project.branding.trackColors||{}),[el.dataset.trackColor]:el.value};scheduleSave();}));
  root.querySelectorAll('[data-remove-location]').forEach(btn=>btn.addEventListener('click',()=>{project.extraLocations=(project.extraLocations||[]).filter(x=>x.id!==btn.dataset.removeLocation);scheduleSave();renderDerived();}));
}

async function renderDerived(){
  const result=await buildPackage(project);scheduleSave();const {pkg,report}=result;if(project.reimportConflicts?.length)report.warnings.push(...project.reimportConflicts);
  const conflictPanel=$('#conflictPanel'),conflictList=$('#conflictList'),conflicts=project.reimportConflicts||[];if(conflictPanel){conflictPanel.hidden=!conflicts.length;if(conflictList)conflictList.innerHTML=conflicts.map(x=>`<div class="conflict-item">${escapeHtml(x)}</div>`).join('');}
  $('#previewBrand').textContent=pkg.conference.shortName||pkg.conference.name||'Conference';
  renderPeopleEditor(pkg.people.people||[]);
  const trackNames=new Map((pkg.programme.tracks||[]).map(t=>[t.id,t.name]));
  renderLocationEditor(pkg.locations.locations||[],pkg.programme.tracks||[]);
  renderSessionEditor(pkg.programme.sessions||[],pkg.locations.locations||[],pkg.programme.tracks||[]);
  const sessionById=new Map(pkg.programme.sessions.map(s=>[s.id,s]));const locById=new Map(pkg.locations.locations.map(l=>[l.id,l]));
  const items=[];for(const s of pkg.programme.sessions){if(s.presentationIds?.length){for(const id of s.presentationIds){const p=pkg.programme.presentations.find(x=>x.id===id);if(p)items.push({date:s.date,start:p.start,end:p.end,title:p.title,loc:locById.get(s.locationId)?.name||'',track:trackNames.get(s.trackId)||''});}}else items.push({date:s.date,start:s.start,end:s.end,title:s.title,loc:locById.get(s.locationId)?.name||'',track:trackNames.get(s.trackId)||''});}
  $('#phoneSchedule').innerHTML=items.slice(0,16).map(x=>`<div class="mini-event"><b>${escapeHtml(x.title)}</b><span>${escapeHtml(`${x.date} · ${x.start}–${x.end}${x.loc?' · '+x.loc:''}${x.track?' · '+x.track:''}`)}</span></div>`).join('')||'<span class="muted">Import programme rows to preview the app.</span>';
  renderReport(report);
}
function renderReport(report){const el=$('#validationReport');if(!report.errors.length&&!report.warnings.length){el.innerHTML='<div class="validation-ok">Validation passed. Package is structurally ready to publish.</div>';return;}el.innerHTML=[...report.errors.map(x=>`<div class="validation-error">${escapeHtml(x)}</div>`),...report.warnings.map(x=>`<div class="validation-warning">${escapeHtml(x)}</div>`)].join('');}

async function loadXlsxWorksheet(sheetName){
  if(!pendingXlsxFile)return;
  const status=$('#importStatus');status.textContent=`Loading worksheet ${sheetName}…`;
  const rows=await importXlsx(pendingXlsxFile,sheetName);
  rawRows=rows.map(row=>({...row,__sourceFileId:pendingXlsxSourceId}));
  rawHeaders=Object.keys(rawRows[0]||{}).filter(x=>!x.startsWith('__'));
  project.lastWorksheet=sheetName;
  showMapping(guessMapping(rawHeaders));
  scheduleSave();
  status.textContent=`${rawRows.length} rows loaded from ${sheetName}`;
}

async function doImport(){
  const file=$('#programmeFile').files[0];if(!file)return toast('Choose a file first');const status=$('#importStatus');status.textContent='Importing…';
  try{
    const previousSource=(project.sourceFiles||[]).find(x=>x.name===file.name);
    const sourceFile={id:previousSource?.id||crypto.randomUUID(),name:file.name,type:file.type,lastModified:file.lastModified,blob:file};
    project.sourceFiles=[...(project.sourceFiles||[]).filter(x=>x.name!==file.name),sourceFile];
    scheduleSave();
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['xlsx','xls'].includes(ext)){pendingXlsxFile=null;pendingXlsxSourceId='';$('#sheetChooserWrap').hidden=true;}
    const tagSource=rows=>rows.map(row=>({...row,__sourceFileId:sourceFile.id}));
    if(ext==='csv'){rawRows=tagSource(parseCSV(await file.text()));rawHeaders=Object.keys(rawRows[0]||{}).filter(x=>!x.startsWith('__'));showMapping(guessMapping(rawHeaders));status.textContent=`${rawRows.length} CSV rows loaded`;}
    else if(ext==='xlsx'||ext==='xls'){const sheets=await listXlsxSheets(file);if(!sheets.length)throw new Error('Workbook has no sheets');pendingXlsxFile=file;pendingXlsxSourceId=sourceFile.id;const chooser=$('#xlsxSheet'),wrap=$('#sheetChooserWrap');chooser.innerHTML=sheets.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');const selected=sheets.includes(project.lastWorksheet)?project.lastWorksheet:sheets[0];chooser.value=selected;wrap.hidden=sheets.length<2;await loadXlsxWorksheet(selected);}
    else if(ext==='json'){
      const json=JSON.parse(await file.text());
      if(Array.isArray(json)){rawRows=tagSource(json);rawHeaders=Object.keys(rawRows[0]||{}).filter(x=>!x.startsWith('__'));showMapping(guessMapping(rawHeaders));status.textContent=`${rawRows.length} JSON rows loaded`;}
      else if(json.programme&&json.conference){
        project.conference={...project.conference,...json.conference};
        project.features={...project.features,...(json.conference.features||{})};
        project.branding={...project.branding,...(json.branding||{}),trackColors:{...(project.branding?.trackColors||{}),...(json.branding?.trackColors||{})},locationColors:{...(project.branding?.locationColors||{}),...(json.branding?.locationColors||{})}};
        for(const person of json.people?.people||[]){project.peopleOverrides[person.id]={name:person.name||'',position:person.position||'',affiliation:(person.affiliations||[]).join('; '),publicEmail:person.publicEmail||person.email||'',orcid:person.orcid||'',website:(person.links||[]).find(x=>x.label==='Website')?.url||'',photoUrl:person.photoUrl||'',papers:person.papers||[]};}
        for(const loc of json.locations?.locations||[]){project.locationOverrides[loc.id]={name:loc.name,type:loc.type,parentLocationId:loc.parentLocationId,address:loc.address,mapUrl:loc.mapUrl,lat:loc.lat,lon:loc.lon};}
        project.announcements=[...(json.programme.announcements||[])];
        project.rows=mergeImportedRows(rowsFromStructuredPackage(json,sourceFile.id));
        status.textContent=`Structured conference package loaded: ${project.rows.length} review rows`;scheduleSave();renderRows();renderAnnouncementsBuilder();renderDerived();
      }
      else if(Array.isArray(json.rows)){rawRows=tagSource(json.rows);rawHeaders=Object.keys(rawRows[0]||{}).filter(x=>!x.startsWith('__'));showMapping(guessMapping(rawHeaders));status.textContent=`${rawRows.length} JSON rows loaded`;}
      else throw new Error('JSON must be an array of rows or contain a rows array');
    }
    else if(ext==='pdf'){
      pdfPages=await importPdf(file,(p,n,mode)=>status.textContent=mode==='ocr'?`OCR for image-only PDF page ${p}/${n}…`:`Extracting PDF page ${p}/${n}…`);$('#pdfExtract').hidden=false;$('#pdfText').value=pdfPages.map(p=>`--- Page ${p.page} ---\n${p.lines.join('\n')}`).join('\n\n');project.rows=mergeImportedRows(heuristicRowsFromPdf(pdfPages,project.conference.startDate,sourceFile.id));project.sourceState=pdfPages;scheduleSave();renderRows();renderDerived();const ocrCount=pdfPages.filter(x=>x.ocr).length,ocrFailures=pdfPages.filter(x=>x.ocrError).length;status.textContent=`Extracted ${pdfPages.length} pages${ocrCount?` · OCR ${ocrCount}`:''}${ocrFailures?` · OCR failed ${ocrFailures}`:''}; ${project.rows.length} timed rows detected. Review them below.`;
    } else throw new Error('Unsupported file type');
  }catch(err){console.error(err);status.textContent='Import failed';toast(err.message||'Import failed');}
}

async function assetFromFile(file){if(!file)return null;const bytes=new Uint8Array(await file.arrayBuffer());const ext=file.type.includes('svg')?'.svg':file.type.includes('jpeg')?'.jpg':file.type.includes('webp')?'.webp':'.png';return{name:file.name,type:file.type,extension:ext,bytes};}
async function chooseLogo(file){project.logo=await assetFromFile(file);scheduleSave();toast(project.logo?'Logo stored in Builder project':'Logo cleared');}
async function chooseAppIcon(file){project.appIcon=await assetFromFile(file);scheduleSave();toast(project.appIcon?'App icon artwork stored':'App icon cleared');}
async function chooseSponsors(files){project.sponsorFiles=[];for(const file of files||[])project.sponsorFiles.push(await assetFromFile(file));scheduleSave();toast(`${project.sponsorFiles.length} sponsor asset${project.sponsorFiles.length===1?'':'s'} stored`);}
async function exportBuilderProject(){try{const blob=await createBuilderProjectFile(project),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(project.conference?.shortName||project.conference?.name||'conference').replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-builder-project.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Builder project exported');}catch(err){console.error(err);toast('Could not export Builder project');}}
async function importBuilderProject(file){try{const incoming=await readBuilderProjectFile(file);project={...structuredClone(defaults),...incoming,conference:{...defaults.conference,...incoming.conference},features:{...defaults.features,...incoming.features},policy:{...defaults.policy,...incoming.policy},branding:{...defaults.branding,...incoming.branding,trackColors:{...(incoming.branding?.trackColors||{})},locationColors:{...(incoming.branding?.locationColors||{})}}};await saveProject(project);location.reload();}catch(err){console.error(err);toast(err?.message||'Could not import Builder project');}}

async function download(){try{const {blob,report,pkg}=await packageZip(project);renderReport(report);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${pkg.conference.id||'conference'}-data-package-v${pkg.manifest.dataVersion}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);project.changelog=pkg.manifest.changelog||[];project.lastPublishedVersion=Number(pkg.manifest.dataVersion||project.dataVersion||1);project.lastPublishedAt=pkg.manifest.publishedAt;project.dataVersion=project.lastPublishedVersion+1;project.releaseMessage='Programme update';$('#dataVersion').value=project.dataVersion;$('#releaseMessage').value=project.releaseMessage;scheduleSave();toast('Validated repository package downloaded');}catch(err){console.error(err);toast(err?.message||'Fix validation errors before publishing');const result=await buildPackage(project);renderReport(result.report);}}

async function init(){const saved=await loadProject();if(saved)project={...structuredClone(defaults),...saved,conference:{...defaults.conference,...saved.conference},features:{...defaults.features,...saved.features},policy:{...defaults.policy,...saved.policy},branding:{...defaults.branding,...saved.branding,trackColors:{...defaults.branding.trackColors,...saved.branding?.trackColors},locationColors:{...defaults.branding.locationColors,...saved.branding?.locationColors}},peopleOverrides:{...(saved.peopleOverrides||{})},locationOverrides:{...(saved.locationOverrides||{})},sessionOverrides:{...(saved.sessionOverrides||{})},peoplePhotos:{...(saved.peoplePhotos||{})},extraPeople:Array.isArray(saved.extraPeople)?saved.extraPeople:[],extraLocations:Array.isArray(saved.extraLocations)?saved.extraLocations:[],announcements:Array.isArray(saved.announcements)?saved.announcements:[],deletedSourceIds:Array.isArray(saved.deletedSourceIds)?saved.deletedSourceIds:[],changelog:Array.isArray(saved.changelog)?saved.changelog:[],lastPublishedVersion:Number(saved.lastPublishedVersion||0),identityRegistry:{people:{...(saved.identityRegistry?.people||{})},locations:{...(saved.identityRegistry?.locations||{})},tracks:{...(saved.identityRegistry?.tracks||{})}},logo:saved.logo||null,appIcon:saved.appIcon||null,sponsorFiles:Array.isArray(saved.sponsorFiles)?saved.sponsorFiles:[],sourceFiles:Array.isArray(saved.sourceFiles)?saved.sourceFiles:[]};bindConfig();initBulkEditor();renderRows();renderAnnouncementsBuilder();renderDerived();
  $('#importProgramme').addEventListener('click',doImport);$('#xlsxSheet').addEventListener('change',e=>loadXlsxWorksheet(e.target.value).catch(err=>{console.error(err);toast(err.message||'Could not load worksheet');}));$('#applyMapping').addEventListener('click',applyMapping);$('#addRow').addEventListener('click',()=>{project.rows.push({id:crypto.randomUUID(),date:project.conference.startDate||'',start:'',end:'',type:'talk',session:'',title:'',speaker:'',chair:'',affiliation:'',location:'',track:'',posterNumber:'',abstract:'',doi:'',manualEdited:true});scheduleSave();renderRows();renderDerived();});$('#logoFile').addEventListener('change',e=>chooseLogo(e.target.files[0]));$('#appIconFile').addEventListener('change',e=>chooseAppIcon(e.target.files[0]));$('#sponsorFiles').addEventListener('change',e=>chooseSponsors([...e.target.files]));$('#exportBuilderProject').addEventListener('click',exportBuilderProject);$('#importBuilderProject').addEventListener('click',()=>$('#builderProjectInput').click());$('#builderProjectInput').addEventListener('change',e=>{if(e.target.files[0])importBuilderProject(e.target.files[0]);e.target.value='';});$('#addPerson').addEventListener('click',()=>{project.extraPeople=[...(project.extraPeople||[]),{id:`person-extra-${crypto.randomUUID()}`,name:'New person',position:'',affiliation:'',publicEmail:'',orcid:'',website:'',photoUrl:''}];scheduleSave();renderDerived();});$('#addLocation').addEventListener('click',()=>{project.extraLocations=[...(project.extraLocations||[]),{id:`loc-extra-${crypto.randomUUID()}`,type:'venue',name:'New location',parentLocationId:'',address:'',mapUrl:'',lat:'',lon:''}];scheduleSave();renderDerived();});$('#addAnnouncement').addEventListener('click',()=>{project.announcements.push({id:crypto.randomUUID(),timestamp:new Date().toISOString(),message:'',affectedIds:[]});scheduleSave();renderAnnouncementsBuilder();});$('#validateProject').addEventListener('click',renderDerived);$('#downloadPackage').addEventListener('click',download);$('#resetProject').addEventListener('click',async()=>{if(!confirm('Reset the entire Builder project?'))return;await clearProject();location.reload();});
}
init();
