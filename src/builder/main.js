import {loadProject,saveProject,clearProject} from './project-store.js';
import {parseCSV,guessMapping,rowsFromMapping,importXlsx,listXlsxSheets,importPdf,heuristicRowsFromPdf,rowsFromStructuredPackage} from './importers.js';
import {buildPackage,packageZip,packageContentFingerprint,confirmProjectPublication} from './package.js';
import {createBuilderProjectFile,readBuilderProjectFile} from './project-file.js';
import {mergeImportedRows as mergeProgrammeRows} from './merge.js';
import {possiblePersonDuplicates,mergePersonProfiles} from './people.js';
import {describeValidationMessage} from './validation-ui.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const FIELDS=['date','start','end','type','session','title','speaker','chair','affiliation','location','track','posterNumber','abstract','doi'];
const MAPPING_FIELDS=[...FIELDS,'speakerId','chairId'];
const LABELS={date:'Date',start:'Start',end:'End',type:'Type',session:'Session',title:'Title',speaker:'Speaker / author',chair:'Chair',affiliation:'Affiliation',location:'Location',track:'Track',posterNumber:'Poster #',abstract:'Abstract',doi:'DOI / link',speakerId:'Speaker / author ID (optional)',chairId:'Chair ID (optional)'};
const defaults={
  conference:{name:'',shortName:'',startDate:'',endDate:'',timezone:'Europe/Helsinki',city:'',country:'',officialWebsite:'',contactEmail:'',venueName:'',venueAddress:''},
  rows:[],features:{photos:true,notes:true,pptxExport:true,friendBook:true,calendarExport:true,announcements:true},policy:{requireAffiliation:false,requireAbstract:false,requireChair:false},branding:{primary:'#5b4b9a',secondary:'#2f7d68',accent:'#5b4b9a',trackColors:{},locationColors:{},headerStyle:'text',darkMode:true},peopleOverrides:{},locationOverrides:{},sessionOverrides:{},peoplePhotos:{},extraPeople:[],extraLocations:[],announcements:[],deletedSourceIds:[],sourceFiles:[],dataVersion:1,lastPublishedVersion:0,lastExportedVersion:0,confirmedPublications:[],changelog:[],releaseMessage:'Initial Builder release',sourceState:[],mapping:{},identityRegistry:{people:{},locations:{},tracks:{}},logo:null,appIcon:null,sponsorFiles:[]
};
let project=structuredClone(defaults),rawRows=[],rawHeaders=[],saveTimer=null,pdfPages=[],pendingXlsxFile=null,pendingXlsxSourceId='',selectedRows=new Set();
const STEP_NAMES=['Conference details','Programme import','Review & fix','People','Locations & tracks','Branding','Features & announcements','Preview, validate & publish'];
let activeStep=1,latestPackage=null,pendingSave=Promise.resolve(),saveRevision=0,openPersonId='',peopleListSignature='',previewTimer=null,previewAssets=[],pendingPreviewAssets=0,renderRevision=0,appliedRevision=0;
const previewIdentity=`builder-preview-${crypto.randomUUID()}`;

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800);}
function setSaveStatus(message,error=false){const el=$('#builderSaveStatus');if(!el)return;el.textContent=message;el.classList.toggle('error',error);}
function scheduleSave(){const revision=++saveRevision;setSaveStatus('Saving project…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>{const snapshot=structuredClone(project);pendingSave=pendingSave.catch(()=>{}).then(()=>saveProject(snapshot)).then(()=>{if(revision===saveRevision)setSaveStatus('Project saved locally');}).catch(error=>{console.error(error);setSaveStatus('Autosave failed. Your changes are still open; export a project backup.',true);});},200);}
function setStep(step,{focus=false}={}){
  activeStep=Math.max(1,Math.min(8,Number(step)||1));project.activeStep=activeStep;
  $$('[data-step]').forEach(panel=>{panel.hidden=Number(panel.dataset.step)!==activeStep;});
  $$('#wizardSteps button').forEach(button=>{if(Number(button.dataset.gotoStep)===activeStep)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
  const progress=`Step ${activeStep} of 8 · ${STEP_NAMES[activeStep-1]}`;
  $('#wizardProgress').textContent=progress;$('#wizardFooterProgress').textContent=progress;
  $('#previousStep').disabled=activeStep===1;$('#nextStep').disabled=activeStep===8;
  if(latestPackage){if(activeStep===4)renderPeopleDirectory(latestPackage);if(activeStep===5)renderLocationEditor(latestPackage.locations.locations||[],latestPackage.programme.tracks||[]);if(activeStep===3){renderRows();renderSessionEditor(latestPackage.programme.sessions||[],latestPackage.locations.locations||[],latestPackage.programme.tracks||[]);}if(activeStep===8&&pendingPreviewAssets===0&&renderRevision===appliedRevision)queuePreview();}
  if(focus){const title=$(`[data-step="${activeStep}"] h2`);title.setAttribute('tabindex','-1');title.focus();window.scrollTo({top:0,behavior:'instant'});}
  scheduleSave();
}
function initWizard(){
  $('#wizardSteps').innerHTML=STEP_NAMES.map((name,i)=>`<button class="wizard-step" type="button" data-goto-step="${i+1}"><span class="wizard-step-number">${i+1} / 8</span><span class="wizard-step-label">${escapeHtml(name)}</span></button>`).join('');
  $('#wizardSteps').addEventListener('click',event=>{const button=event.target.closest('[data-goto-step]');if(button)setStep(button.dataset.gotoStep,{focus:true});});
  $('#previousStep').addEventListener('click',()=>setStep(activeStep-1,{focus:true}));$('#nextStep').addEventListener('click',()=>setStep(activeStep+1,{focus:true}));
  setStep(project.activeStep||1);
}
function bindConfig(){
  $$('[data-config]').forEach(input=>{input.value=project.conference[input.dataset.config]||'';input.addEventListener('input',()=>{project.conference[input.dataset.config]=input.value;scheduleSave();renderDerived();});});
  $$('[data-feature]').forEach(input=>{input.checked=project.features[input.dataset.feature]!==false;input.addEventListener('change',()=>{project.features[input.dataset.feature]=input.checked;scheduleSave();});});
  $$('[data-policy]').forEach(input=>{input.checked=!!project.policy?.[input.dataset.policy];input.addEventListener('change',()=>{project.policy={...(project.policy||{}),[input.dataset.policy]:input.checked};scheduleSave();renderDerived();});});
  $('#primaryColor').value=project.branding.primary;$('#secondaryColor').value=project.branding.secondary;$('#accentColor').value=project.branding.accent;
  ['primaryColor','secondaryColor','accentColor'].forEach(id=>$('#'+id).addEventListener('input',e=>{project.branding[id.replace('Color','')]=e.target.value;scheduleSave();renderDerived();}));
  $('#headerStyle').value=project.branding.headerStyle||'text';$('#typography').value=project.branding.typography||'system';$('#brandingDarkMode').checked=project.branding.darkMode!==false;
  $('#headerStyle').addEventListener('change',e=>{project.branding.headerStyle=e.target.value;scheduleSave();renderDerived();});
  $('#typography').addEventListener('change',e=>{project.branding.typography=e.target.value;scheduleSave();renderDerived();});
  $('#brandingDarkMode').addEventListener('change',e=>{project.branding.darkMode=e.target.checked;scheduleSave();renderDerived();});
  $('#dataVersion').value=project.dataVersion||1;$('#releaseMessage').value=project.releaseMessage||'';
  updateReleaseStatus();
  $('#dataVersion').addEventListener('input',e=>{project.dataVersion=Number(e.target.value)||1;scheduleSave();});
  $('#releaseMessage').addEventListener('input',e=>{project.releaseMessage=e.target.value;scheduleSave();});
}

function updateReleaseStatus(){const el=$('#releaseStatus');if(!el)return;const published=project.lastPublishedVersion?`Last confirmed published: v${project.lastPublishedVersion}${project.lastPublishedAt?` · ${new Date(project.lastPublishedAt).toLocaleString()}`:''}`:'No release confirmed as published';const exported=project.lastExportedVersion?`Last exported: v${project.lastExportedVersion}${project.lastExportedAt?` · ${new Date(project.lastExportedAt).toLocaleString()}`:''}`:'No package exported yet';el.textContent=`${published}. ${exported}. Downloading a ZIP does not confirm deployment.`;}

function mappingOptions(selected=''){return `<option value="">— not mapped —</option>${rawHeaders.map(h=>`<option ${h===selected?'selected':''}>${escapeHtml(h)}</option>`).join('')}`;}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

function updateSelectedCount(){const el=$('#selectedRowCount');if(el)el.textContent=`${selectedRows.size} selected`;const all=$('#selectAllRows');if(all){const visible=project.rows.map(r=>r.id);all.checked=!!visible.length&&visible.every(id=>selectedRows.has(id));all.indeterminate=visible.some(id=>selectedRows.has(id))&&!all.checked;}}
function initBulkEditor(){const field=$('#bulkField');if(!field)return;field.innerHTML=FIELDS.map(f=>`<option value="${f}">${escapeHtml(LABELS[f])}</option>`).join('');$('#applyBulkEdit')?.addEventListener('click',()=>{if(!selectedRows.size)return toast('Select at least one row');const key=field.value,value=$('#bulkValue').value;const calendarFields=new Set(['date','start','end','title','location','session']);let changed=0;for(const row of project.rows){if(!selectedRows.has(row.id))continue;const before=String(row[key]??'');row[key]=value;row.manualFields={...(row.manualFields||{}),[key]:true};if(calendarFields.has(key)&&before!==String(value))row.sequence=Number(row.sequence||0)+1;changed++;}scheduleSave();renderRows();renderDerived();toast(`Updated ${changed} row${changed===1?'':'s'}`);});$('#selectAllRows')?.addEventListener('change',e=>{if(e.target.checked)project.rows.forEach(r=>selectedRows.add(r.id));else selectedRows.clear();renderRows();});}
function sessionFieldInput(session,field,locations,tracks){const value=session[field]??'';if(field==='locationId')return `<select data-session-field="locationId"><option value="">— none —</option>${locations.map(l=>`<option value="${escapeHtml(l.id)}" ${l.id===value?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select>`;if(field==='trackId')return `<select data-session-field="trackId"><option value="">— none —</option>${tracks.map(t=>`<option value="${escapeHtml(t.id)}" ${t.id===value?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select>`;const type=field==='date'?'date':(['start','end'].includes(field)?'time':'text');return `<input type="${type}" data-session-field="${field}" value="${escapeHtml(value)}">`;}
function renderSessionEditor(sessions,locations,tracks){const root=$('#sessionPreview');if(!root)return;const bySessionId=new Map((sessions||[]).map(s=>[s.id,s]));root.innerHTML=(sessions||[]).map(s=>`<div class="session-card" data-session-id="${escapeHtml(s.id)}"><div class="session-card-head"><strong>${escapeHtml(s.title||'Session')}</strong><code>${escapeHtml(s.id)}</code></div><div class="session-card-grid"><label>Title${sessionFieldInput(s,'title',locations,tracks)}</label><label>Date${sessionFieldInput(s,'date',locations,tracks)}</label><label>Start${sessionFieldInput(s,'start',locations,tracks)}</label><label>End${sessionFieldInput(s,'end',locations,tracks)}</label><label>Location${sessionFieldInput(s,'locationId',locations,tracks)}</label><label>Track${sessionFieldInput(s,'trackId',locations,tracks)}</label></div></div>`).join('')||'<span class="muted">No sessions yet.</span>';root.querySelectorAll('[data-session-field]').forEach(el=>el.addEventListener('change',()=>{const card=el.closest('[data-session-id]'),id=card.dataset.sessionId,field=el.dataset.sessionField;const current=project.sessionOverrides?.[id]||{};const before=String(bySessionId.get(id)?.[field]??'');const value=el.value;project.sessionOverrides={...(project.sessionOverrides||{}),[id]:{...current,[field]:value,sequenceBump:Number(current.sequenceBump||0)+(before!==String(value)?1:0)}};scheduleSave();renderDerivedDebounced();}));}

function showMapping(mapping){project.mapping=mapping;const grid=$('#mappingGrid');grid.innerHTML=MAPPING_FIELDS.map(f=>`<label>${LABELS[f]}<select data-map="${f}">${mappingOptions(mapping[f])}</select></label>`).join('');$('#mappingCard').hidden=false;}
function mergeImportedRows(nextRows){
  const {rows,conflicts}=mergeProgrammeRows(project.rows,nextRows,project.deletedSourceIds);
  project.reimportConflicts=conflicts;
  return rows;
}
function applyMapping(){const mapping={};$$('[data-map]').forEach(s=>mapping[s.dataset.map]=s.value);project.mapping=mapping;project.rows=mergeImportedRows(rowsFromMapping(rawRows,mapping));project.sourceState=rawRows.map((row,i)=>({sourceId:`${row.__sourceFileId||'source'}:${row.__sheet||'source'}:${row.__sourceRow||i+1}`,raw:row,mapping}));scheduleSave();renderRows();renderDerived();toast('Mapping applied');}

function rowInput(row,index,field){
  const value=row[field]??'';
  if(field==='type')return `<select data-row="${index}" data-field="type">${['talk','plenary','keynote','special','break','meal','social','registration','poster'].map(type=>`<option ${value===type?'selected':''}>${type}</option>`).join('')}</select>`;
  if(field==='abstract')return `<textarea data-row="${index}" data-field="${field}" rows="2">${escapeHtml(value)}</textarea>`;
  const type=field==='date'?'date':(field==='start'||field==='end')?'time':'text';
  const color=field==='location'?project.branding.locationColors?.[row.locationEntityId]:field==='track'?project.branding.trackColors?.[row.trackEntityId]:'';
  const input=`<input type="${type}" data-row="${index}" data-field="${field}" value="${escapeHtml(value)}" ${color?`style="border-left:4px solid ${escapeHtml(color)}"`:''}>`;
  if(!['speaker','chair'].includes(field)||!row.personIdentityConflict||row.personIdentityResolved)return input;
  const names=String(value).split(/\s*(?:;|\band\b)\s*/i).filter(Boolean),idField=field==='speaker'?'speakerEntityIds':'chairEntityIds';
  const selectors=names.map((name,i)=>{
    const nameKey=name.toLowerCase();if(row.personIdentityResolvedNames?.[nameKey])return '';
    const choices=row.personIdentityCandidatesByName?.[nameKey]||(!row.personIdentityCandidatesByName?row.personIdentityCandidates:[])||[];
    if(!choices.length)return '';
    return `<label class="identity-choice">Person ID for ${escapeHtml(name)}<select data-person-identity data-row="${index}" data-person-role="${field}" data-person-name="${escapeHtml(nameKey)}" data-speaker-index="${i}" aria-label="Choose identity for ${escapeHtml(name)}"><option value="">Choose a person…</option>${choices.map(id=>`<option value="${escapeHtml(id)}" ${row[idField]?.[i]===id?'selected':''}>${escapeHtml(id)}</option>`).join('')}</select></label>`;
  }).join('');
  return `${input}${selectors}`;
}
function renderRows(){
  const body=$('#reviewTable tbody');
  body.innerHTML=project.rows.map((r,i)=>`<tr><td><input type="checkbox" data-select-row="${escapeHtml(r.id)}" ${selectedRows.has(r.id)?'checked':''} aria-label="Select row ${i+1}"></td>${FIELDS.map(f=>`<td>${rowInput(r,i,f)}</td>`).join('')}<td><button class="row-delete" data-delete-row="${i}" title="Delete">×</button></td></tr>`).join('');
  $('#rowCount').textContent=`${project.rows.length} rows`;
  body.querySelectorAll('[data-select-row]').forEach(el=>el.addEventListener('change',()=>{if(el.checked)selectedRows.add(el.dataset.selectRow);else selectedRows.delete(el.dataset.selectRow);updateSelectedCount();}));
  body.querySelectorAll('[data-row]').forEach(el=>el.addEventListener('input',()=>{const r=project.rows[Number(el.dataset.row)],field=el.dataset.field,oldValue=r[field];r[field]=el.value;r.manualFields={...(r.manualFields||{}),[field]:true};if(['date','start','end','title','location','session'].includes(field)&&String(oldValue??'')!==String(el.value??''))r.sequence=Number(r.sequence||0)+1;scheduleSave();renderDerivedDebounced();}));
  body.querySelectorAll('[data-person-identity]').forEach(el=>el.addEventListener('change',()=>{const row=project.rows[Number(el.dataset.row)],i=Number(el.dataset.speakerIndex),field=el.dataset.personRole==='chair'?'chairEntityIds':'speakerEntityIds';if(!el.value)return;row[field]=[...(row[field]||[])];row[field][i]=el.value;const name=el.dataset.personName;row.personIdentityResolvedNames={...(row.personIdentityResolvedNames||{}),[name]:true};row.personIdentityCandidatesByName={...(row.personIdentityCandidatesByName||{})};delete row.personIdentityCandidatesByName[name];row.personIdentityCandidates=[...new Set(Object.values(row.personIdentityCandidatesByName).flat())];row.personIdentityConflict=Object.keys(row.personIdentityCandidatesByName).length>0;row.personIdentityResolved=!row.personIdentityConflict;scheduleSave();renderRows();renderDerived();}));
  body.querySelectorAll('[data-delete-row]').forEach(btn=>btn.addEventListener('click',()=>{const idx=Number(btn.dataset.deleteRow),row=project.rows[idx];if(row?.source?.id)project.deletedSourceIds=[...new Set([...(project.deletedSourceIds||[]),row.source.id])];if(row?.id)selectedRows.delete(row.id);project.rows.splice(idx,1);scheduleSave();renderRows();renderDerived();}));
  updateSelectedCount();
}

let deriveTimer=null;function renderDerivedDebounced(){clearTimeout(deriveTimer);deriveTimer=setTimeout(renderDerived,150);}
let previewPayload=null,previewSignature='';
function previewAsset(asset){if(!asset?.bytes)return '';const url=URL.createObjectURL(new Blob([asset.bytes],{type:asset.type||'image/png'}));previewAssets.push(url);return url;}
function queuePreview(){
  clearTimeout(previewTimer);
  if(activeStep!==8||!latestPackage||pendingPreviewAssets||renderRevision!==appliedRevision)return;
  previewTimer=setTimeout(()=>{
    if(pendingPreviewAssets||renderRevision!==appliedRevision)return;
    const signature=JSON.stringify([latestPackage.conference,latestPackage.programme,latestPackage.people,latestPackage.locations,latestPackage.branding,(project.logo?.bytes||[]).length,(project.sponsorFiles||[]).map(x=>[x.name,x.bytes?.length]),(project.peoplePhotos&&Object.keys(project.peoplePhotos).length)||0]);
    if(signature===previewSignature&&$('#attendeePreview').src)return;
    previewSignature=signature;
    for(const url of previewAssets)URL.revokeObjectURL(url);previewAssets=[];
    const pkg=structuredClone(latestPackage);
    // The real attendee runtime is used, but all its personal storage keys
    // belong to this disposable Builder preview identity.
    pkg.conference.id=previewIdentity;
    if(project.logo?.bytes)pkg.branding.logo=previewAsset(project.logo);
    pkg.branding.sponsorAssets=(project.sponsorFiles||[]).map(previewAsset).filter(Boolean);
    for(const person of pkg.people.people||[])if(project.peoplePhotos?.[person.id])person.photoUrl=previewAsset(project.peoplePhotos[person.id]);
    previewPayload=pkg;
    const frame=$('#attendeePreview');frame.src=`./index.html?builderPreview=1&revision=${Date.now()}`;
  },120);
}
function applyPreviewNavigation(){
  const doc=$('#attendeePreview').contentDocument;if(!doc)return;
  const date=$('#previewDate').value,room=$('#previewRoom').value;
  if(date){const dates=[...new Set((latestPackage?.programme.sessions||[]).map(s=>s.date).filter(Boolean))].sort();const day=dates.indexOf(date)+1;doc.querySelector(`.day-tab[data-day="${day}"]`)?.click();}
  doc.querySelector(`[data-view="program"]`)?.click();
  if(room)doc.querySelector(`#roomFilters [data-room="${CSS.escape(room)}"]`)?.click();
}
function setupPreview(){
  $('#previewSize').addEventListener('change',event=>{$('#attendeePreview').style.width=`${event.target.value}px`;});
  for(const id of ['previewDate','previewRoom'])$('#'+id).addEventListener('change',applyPreviewNavigation);
  window.addEventListener('message',event=>{
    if(event.source!==$('#attendeePreview').contentWindow||event.origin!==location.origin||event.data?.type!=='conference-builder-preview-ready'||!previewPayload)return;
    event.source.postMessage({type:'conference-builder-preview',pkg:previewPayload},location.origin);
    const check=()=>{if(!$('#attendeePreview').contentDocument?.querySelector('.day-tab'))return setTimeout(check,80);applyPreviewNavigation();};check();
  });
}
function updatePreviewControls(pkg){
  const dates=[...new Set((pkg.programme.sessions||[]).map(s=>s.date).filter(Boolean))].sort(),rooms=pkg.locations.locations.filter(l=>l.type==='room');
  const date=$('#previewDate'),room=$('#previewRoom'),selectedDate=date.value,selectedRoom=room.value;
  date.innerHTML=dates.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');if(dates.includes(selectedDate))date.value=selectedDate;
  room.innerHTML='<option value="">All rooms</option>'+rooms.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');if(rooms.some(l=>l.id===selectedRoom))room.value=selectedRoom;
}
function renderBrandingSample(pkg){
  const el=$('#brandingSample');if(!el)return;
  const b=pkg.branding||{},dark=b.darkMode!==false;
  el.style.background=dark?'#101011':'#fff';el.style.color=dark?'#fff':'#111';
  el.style.fontFamily=b.typography==='serif'?'Georgia,serif':b.typography==='condensed'?'Arial Narrow,Arial,sans-serif':'system-ui,sans-serif';
  el.innerHTML=`<div class="branding-sample-header" style="border-color:${escapeHtml(b.primary||'#5b4b9a')}"><strong>${escapeHtml(pkg.conference.shortName||pkg.conference.name||'Conference')}</strong><span style="color:${escapeHtml(b.secondary||'#2f7d68')}">${escapeHtml(pkg.conference.city||'Programme preview')}</span></div><div class="branding-sample-body"><span>Programme</span><span>Posters</span><span>Friend Book</span><button type="button" style="background:${escapeHtml(b.accent||b.primary||'#5b4b9a')}">Accent action</button></div>`;
}

function renderAnnouncementsBuilder(){
  const root=$('#announcementRows');if(!root)return;
  root.innerHTML=(project.announcements||[]).map((a,i)=>`<div class="announcement-row"><input type="datetime-local" data-ann-index="${i}" data-ann-field="timestamp" value="${escapeHtml(a.timestamp?String(a.timestamp).slice(0,16):'')}"><input data-ann-index="${i}" data-ann-field="message" value="${escapeHtml(a.message||'')}" placeholder="Message"><input data-ann-index="${i}" data-ann-field="affected" value="${escapeHtml((a.affectedIds||[]).join(', '))}" placeholder="Affected entity IDs"><button type="button" data-ann-delete="${i}" aria-label="Delete">×</button></div>`).join('')||'<span class="muted">No announcements configured.</span>';
  root.querySelectorAll('[data-ann-index]').forEach(el=>el.addEventListener('input',()=>{const a=project.announcements[Number(el.dataset.annIndex)];if(el.dataset.annField==='affected')a.affectedIds=el.value.split(',').map(x=>x.trim()).filter(Boolean);else if(el.dataset.annField==='timestamp')a.timestamp=el.value?new Date(el.value).toISOString():'';else a[el.dataset.annField]=el.value;scheduleSave();renderDerivedDebounced();}));
  root.querySelectorAll('[data-ann-delete]').forEach(btn=>btn.addEventListener('click',()=>{project.announcements.splice(Number(btn.dataset.annDelete),1);scheduleSave();renderAnnouncementsBuilder();renderDerived();}));
}

function personRoles(pkg){
  const roles=new Map(),entries=new Map();
  const add=(id,role,item)=>{if(!roles.has(id))roles.set(id,new Set());roles.get(id).add(role);if(!entries.has(id))entries.set(id,new Set());entries.get(id).add(item);};
  for(const session of pkg.programme.sessions)for(const id of session.chairIds||[])add(id,'Chair',session.id);
  for(const presentation of pkg.programme.presentations)for(const id of presentation.speakerIds||[])add(id,'Speaker',presentation.id);
  for(const poster of pkg.programme.posters)for(const id of poster.authorIds||[])add(id,'Author',poster.id);
  return {roles,entries};
}
function renderPeopleDirectory(pkg){
  if(activeStep!==4)return;
  const stats=project.identityStats||{};$('#identityStats').textContent=`${stats.automaticallyConsolidated||0} identities automatically consolidated · ${stats.requiresReview||0} ambiguous programme appearances need review.`;
  const people=pkg.people.people||[],duplicates=possiblePersonDuplicates(people),duplicateIds=new Set(duplicates.flatMap(group=>group.map(p=>p.id)));
  const {roles,entries}=personRoles(pkg),search=$('#peopleSearch').value.trim().toLocaleLowerCase(),role=$('#peopleRole').value;
  const visible=people.filter(p=>`${p.name} ${(p.affiliations||[]).join(' ')}`.toLocaleLowerCase().includes(search)&&
    (role==='all'||roles.get(p.id)?.has(role[0].toUpperCase()+role.slice(1)))).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const signature=JSON.stringify([visible.map(p=>[p.id,p.name,p.affiliations,[...(roles.get(p.id)||[])],entries.get(p.id)?.size,duplicateIds.has(p.id)]),search,role]);
  if(signature!==peopleListSignature){
    $('#peoplePreview').innerHTML=visible.map(p=>`<button type="button" class="person-row" data-open-person="${escapeHtml(p.id)}" aria-label="Edit ${escapeHtml(p.name)}"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml((p.affiliations||[]).join('; ')||'Affiliation not specified')}</span><span>${escapeHtml([...(roles.get(p.id)||[])].join(' · ')||'No programme role')} · ${entries.get(p.id)?.size||0} entries</span>${duplicateIds.has(p.id)?'<span class="duplicate-badge">Review match</span>':'<span aria-hidden="true">›</span>'}</button>`).join('')||'<p class="muted">No people match these filters.</p>';
    peopleListSignature=signature;
  }
  $('#duplicateCount').textContent=duplicates.length?`(${duplicates.length})`:'';
  if(!$('#duplicateReview').hidden)renderDuplicateReview(duplicates);
}
function openPersonEditor(id){
  const person=latestPackage?.people.people.find(p=>p.id===id);if(!person)return;
  openPersonId=id;const asset=project.peoplePhotos?.[id],extra=(project.extraPeople||[]).some(x=>x.id===id);
  const input=(field,label,type='text',value=person[field]||'')=>`<label>${label}<input data-edit-field="${field}" type="${type}" value="${escapeHtml(value)}"></label>`;
  $('#personEditor').innerHTML=`<form id="personEditForm"><h3>Edit ${escapeHtml(person.name)}</h3><p class="muted">Person ID: ${escapeHtml(id)}</p><div class="entity-editor-grid">${input('name','Name')}${input('affiliation','Affiliation(s), separated by semicolons','text',(person.affiliations||[]).join('; '))}</div><details><summary>Additional details</summary><div class="entity-editor-grid">${input('position','Position')}${input('publicEmail','Public email','email')}${input('orcid','ORCID')}${input('website','Website','url',(person.links||[]).find(x=>x.label==='Website')?.url||'')}${input('photoUrl','Photo URL or asset path')}<label>Upload profile photograph<input id="personPhotoDraft" type="file" accept="image/png,image/jpeg,image/webp"><span class="muted">${escapeHtml(asset?.name||'No uploaded photograph')}</span></label></div></details><div class="person-editor-actions"><button class="primary-btn" type="submit">Save person</button><button class="secondary-btn" type="button" id="cancelPersonEdit">Cancel</button>${extra?'<button class="secondary-btn" type="button" id="removeExtraPerson">Delete added person</button>':''}</div></form>`;
  $('#personEditor').hidden=false;$('#personEditor').scrollIntoView({block:'nearest'});$('#personEditor [data-edit-field="name"]').focus();
}
function renderDuplicateReview(groups){
  const value=(person,field)=>field==='website'?(person.links||[]).find(x=>x.label==='Website')?.url||'':person[field]||'';
  const fields=['name','position','publicEmail','orcid','website','photoUrl'];
  const groupHtml=groups.map((group,index)=>{
    const profile=p=>`<div class="duplicate-profile"><code>${escapeHtml(p.id)}</code><p>${escapeHtml((p.affiliations||[]).join('; ')||'No affiliation')}</p>${fields.slice(1).filter(field=>value(p,field)).map(field=>`<p>${escapeHtml(field)}: ${escapeHtml(value(p,field))}</p>`).join('')}</div>`;
    const options=group.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)} · ${escapeHtml((p.affiliations||[]).join('; '))}</option>`).join('');
    const removeOptions=group.map((p,i)=>`<option value="${escapeHtml(p.id)}" ${i===1?'selected':''}>${escapeHtml(p.id)} · ${escapeHtml((p.affiliations||[]).join('; '))}</option>`).join('');
    const choices=fields.map(field=>{const chooseRemove=!value(group[0],field)&&value(group[1],field);return `<label>${escapeHtml(field)} from<select data-merge-choice="${field}"><option value="keep">Kept profile</option><option value="remove" ${chooseRemove?'selected':''}>Merged profile</option></select></label>`;}).join('');
    return `<div class="duplicate-group" data-duplicate-group="${index}"><label><input type="checkbox" data-bulk-merge> Confirm this pair for bulk merge</label><strong>${escapeHtml(group[0].name)}</strong><div class="merge-grid">${group.map(profile).join('')}</div><div class="merge-grid"><label>Keep profile ID<select data-merge-keep>${options}</select></label><label>Merge profile ID<select data-merge-remove>${removeOptions}</select></label>${choices}</div><p class="muted">Affiliations and papers from both profiles are retained.</p><button class="secondary-btn" type="button" data-confirm-merge>Merge selected profiles</button></div>`;
  }).join('');
  $('#duplicateReview').innerHTML=`<h3>Review possible duplicates</h3><p class="muted">Matching names can belong to different people. Compare both profiles before confirming a merge. The selected profile ID is kept.</p>${groups.length?'<button class="secondary-btn" type="button" data-confirm-bulk-merge>Merge checked pairs</button>':''}${groupHtml||'<p class="muted">No same-name profiles need review.</p>'}`;
}
function initPeopleUi(){
  $('#peopleSearch').addEventListener('input',()=>{peopleListSignature='';if(latestPackage)renderPeopleDirectory(latestPackage);});
  $('#peopleRole').addEventListener('change',()=>{peopleListSignature='';if(latestPackage)renderPeopleDirectory(latestPackage);});
  $('#peoplePreview').addEventListener('click',event=>{const button=event.target.closest('[data-open-person]');if(button)openPersonEditor(button.dataset.openPerson);});
  $('#reviewDuplicates').addEventListener('click',()=>{const panel=$('#duplicateReview');panel.hidden=!panel.hidden;if(!panel.hidden&&latestPackage)renderDuplicateReview(possiblePersonDuplicates(latestPackage.people.people));});
  $('#duplicateReview').addEventListener('click',async event=>{const single=event.target.closest('[data-confirm-merge]'),bulk=event.target.closest('[data-confirm-bulk-merge]');if(!single&&!bulk)return;const groups=bulk?$$('#duplicateReview [data-duplicate-group]').filter(x=>x.querySelector('[data-bulk-merge]').checked):[single.closest('[data-duplicate-group]')];if(!groups.length)return toast('Check at least one pair to merge');const merges=groups.map(group=>({keep:group.querySelector('[data-merge-keep]').value,remove:group.querySelector('[data-merge-remove]').value,choices:Object.fromEntries([...group.querySelectorAll('[data-merge-choice]')].map(x=>[x.dataset.mergeChoice,x.value]))}));if(merges.some(x=>x.keep===x.remove)||new Set(merges.flatMap(x=>[x.keep,x.remove])).size!==merges.length*2)return toast('Choose separate profiles for each pair');if(!confirm(`Merge ${merges.length} confirmed profile pair${merges.length===1?'':'s'} and update all programme references?`))return;try{for(const merge of merges)mergePersonProfiles(project,latestPackage.people.people,merge.keep,merge.remove,merge.choices);openPersonId='';$('#personEditor').hidden=true;peopleListSignature='';scheduleSave();await renderDerived();toast(`${merges.length} profile pair${merges.length===1?'':'s'} merged`);}catch(error){toast(error.message);}});
  $('#personEditor').addEventListener('click',event=>{if(event.target.id==='cancelPersonEdit'){$('#personEditor').hidden=true;openPersonId='';}if(event.target.id==='removeExtraPerson'&&openPersonId){project.extraPeople=project.extraPeople.filter(x=>x.id!==openPersonId);if(project.peoplePhotos)delete project.peoplePhotos[openPersonId];$('#personEditor').hidden=true;openPersonId='';peopleListSignature='';scheduleSave();renderDerived();}});
  $('#personEditor').addEventListener('submit',async event=>{event.preventDefault();const id=openPersonId;if(!id)return;const fields=Object.fromEntries([...event.target.querySelectorAll('[data-edit-field]')].map(el=>[el.dataset.editField,el.value]));const extra=(project.extraPeople||[]).find(p=>p.id===id);if(extra)Object.assign(extra,fields);else project.peopleOverrides[id]={...(project.peopleOverrides[id]||{}),...fields};const photo=$('#personPhotoDraft').files?.[0];if(photo)project.peoplePhotos={...(project.peoplePhotos||{}),[id]:await assetFromFile(photo)};$('#personEditor').hidden=true;openPersonId='';peopleListSignature='';scheduleSave();await renderDerived();toast('Person saved');});
}

function renderLocationEditor(locations,tracks){
  const root=$('#locationsPreview');if(!root)return;
  const extraIds=new Set((project.extraLocations||[]).map(x=>x.id));
  const parentOptions=(locations||[]).filter(x=>x.type==='venue').map(v=>`<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('');
  const locationHtml=(locations||[]).map(l=>`<div class="entity-editor" data-location-editor="${escapeHtml(l.id)}"><div class="entity-editor-head"><strong>${escapeHtml(l.name||'Location')}</strong><code>${escapeHtml(l.id)}</code>${extraIds.has(l.id)?`<button class="entity-remove" type="button" data-remove-location="${escapeHtml(l.id)}">×</button>`:''}</div><div class="entity-editor-grid"><label>Name<input data-location-field="name" value="${escapeHtml(l.name||'')}"></label><label>Type<select data-location-field="type"><option value="venue" ${l.type==='venue'?'selected':''}>venue</option><option value="room" ${l.type==='room'?'selected':''}>room</option></select></label><label>Parent venue<select data-location-field="parentLocationId"><option value="">— none —</option>${parentOptions.replace(`value="${l.parentLocationId}"`,`value="${l.parentLocationId}" selected`)}</select></label><label>Address<input data-location-field="address" value="${escapeHtml(l.address||'')}"></label><label>Map URL<input data-location-field="mapUrl" type="url" value="${escapeHtml(l.mapUrl||'')}"></label><label>Latitude<input data-location-field="lat" type="number" step="any" value="${escapeHtml(l.lat??'')}"></label><label>Longitude<input data-location-field="lon" type="number" step="any" value="${escapeHtml(l.lon??'')}"></label><label>Display color<div class="color-row"><span>${escapeHtml(project.branding.locationColors?.[l.id]||'default')}</span><input type="color" data-location-color="${escapeHtml(l.id)}" value="${escapeHtml(project.branding.locationColors?.[l.id]||project.branding.primary||'#5b4b9a')}"></div></label></div></div>`).join('');
  const trackHtml=(tracks||[]).map(t=>`<div class="entity-editor"><div class="entity-editor-head"><strong>${escapeHtml(t.name)}</strong><code>track · ${escapeHtml(t.id)}</code></div><div class="entity-editor-grid"><label>Track color<div class="color-row"><span>${escapeHtml(project.branding.trackColors?.[t.id]||'default')}</span><input type="color" data-track-color="${escapeHtml(t.id)}" value="${escapeHtml(project.branding.trackColors?.[t.id]||project.branding.primary||'#5b4b9a')}"></div></label></div></div>`).join('');
  root.innerHTML=locationHtml+trackHtml||'<span class="muted">No locations/tracks yet</span>';
  root.querySelectorAll('[data-location-field]').forEach(el=>el.addEventListener('change',()=>{const card=el.closest('[data-location-editor]'),id=card.dataset.locationEditor,field=el.dataset.locationField;let value=el.value;if(['lat','lon'].includes(field))value=value===''?undefined:Number(value);const extra=(project.extraLocations||[]).find(x=>x.id===id);if(extra)extra[field]=value;else project.locationOverrides[id]={...(project.locationOverrides[id]||{}),[field]:value||value===0?value:undefined};scheduleSave();renderDerivedDebounced();}));
  root.querySelectorAll('[data-location-color]').forEach(el=>el.addEventListener('input',()=>{project.branding.locationColors={...(project.branding.locationColors||{}),[el.dataset.locationColor]:el.value};scheduleSave();renderDerivedDebounced();}));
  root.querySelectorAll('[data-track-color]').forEach(el=>el.addEventListener('input',()=>{project.branding.trackColors={...(project.branding.trackColors||{}),[el.dataset.trackColor]:el.value};scheduleSave();renderDerivedDebounced();}));
  root.querySelectorAll('[data-remove-location]').forEach(btn=>btn.addEventListener('click',()=>{project.extraLocations=(project.extraLocations||[]).filter(x=>x.id!==btn.dataset.removeLocation);scheduleSave();renderDerived();}));
}

async function renderDerived(){
  const revision=++renderRevision;
  const result=await buildPackage(project);if(revision!==renderRevision)return;appliedRevision=revision;scheduleSave();const {pkg,report}=result;if(project.reimportConflicts?.length)report.warnings.push(...project.reimportConflicts);if(project.rows.some(r=>r.personIdentityConflict&&!r.personIdentityResolved)&&!$('#reviewTable tbody [data-person-identity]'))renderRows();
  const conflictPanel=$('#conflictPanel'),conflictList=$('#conflictList'),conflicts=project.reimportConflicts||[];if(conflictPanel){conflictPanel.hidden=!conflicts.length;if(conflictList)conflictList.innerHTML=conflicts.map(x=>`<div class="conflict-item">${escapeHtml(x)}</div>`).join('');}
  latestPackage=pkg;
  updatePreviewControls(pkg);renderBrandingSample(pkg);if(!pendingPreviewAssets)queuePreview();
  renderPeopleDirectory(pkg);
  const trackNames=new Map((pkg.programme.tracks||[]).map(t=>[t.id,t.name]));
  if(activeStep===5&&!document.activeElement?.closest('#locationsPreview'))renderLocationEditor(pkg.locations.locations||[],pkg.programme.tracks||[]);
  if(activeStep===3)renderSessionEditor(pkg.programme.sessions||[],pkg.locations.locations||[],pkg.programme.tracks||[]);
  renderReport(report);
}
function errorStep(message){if(/conference\.|conference |timezone|venue name|website|contact email/i.test(message))return 1;if(/person|people|speaker|author|chair|affiliation/i.test(message))return 4;if(/location|track|venue|room/i.test(message))return 5;if(/brand|logo|icon|color/i.test(message))return 6;if(/announcement|feature/i.test(message))return 7;if(/row|session|presentation|poster|calendar|time|date|source/i.test(message))return 3;return 8;}
function renderReport(report){const el=$('#validationReport');if(!report.errors.length&&!report.warnings.length){el.innerHTML='<div class="validation-ok">Validation passed. Package is structurally ready to publish.</div>';return;}const issue=(message,severity)=>{const described=describeValidationMessage(message,latestPackage,project),target=described.target,step=target?.type==='person'?4:target?.type==='location'?5:target?3:errorStep(message);return `<div class="validation-${severity}">${escapeHtml(described.text)} <button class="secondary-btn" type="button" data-error-step="${step}" ${target?`data-target-type="${target.type}" data-target-id="${escapeHtml(target.id)}"`:''}>Go to ${escapeHtml(target?'record':STEP_NAMES[step-1])}</button></div>`;};const unique=(messages)=>[...new Set(messages)];el.innerHTML=[...unique(report.errors).map(x=>issue(x,'error')),...unique(report.warnings).map(x=>issue(x,'warning'))].join('');}

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
        if(Number.isInteger(Number(json.manifest?.dataVersion)))project.dataVersion=Math.max(Number(project.dataVersion||1),Number(json.manifest.dataVersion));
        const incomingHistory=Array.isArray(json.manifest?.changelog)?json.manifest.changelog:[];
        project.changelog=[...new Map([...(project.changelog||[]),...incomingHistory].map(item=>[Number(item.version),item])).values()].sort((a,b)=>Number(a.version)-Number(b.version));
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
async function chooseLogo(file){pendingPreviewAssets++;try{project.logo=await assetFromFile(file);scheduleSave();toast(project.logo?'Logo stored in Builder project':'Logo cleared');}finally{pendingPreviewAssets--;if(!pendingPreviewAssets)renderDerived();}}
async function chooseAppIcon(file){project.appIcon=await assetFromFile(file);scheduleSave();toast(project.appIcon?'App icon artwork stored':'App icon cleared');}
async function chooseSponsors(files){pendingPreviewAssets++;try{project.sponsorFiles=[];for(const file of files||[])project.sponsorFiles.push(await assetFromFile(file));scheduleSave();toast(`${project.sponsorFiles.length} sponsor asset${project.sponsorFiles.length===1?'':'s'} stored`);}finally{pendingPreviewAssets--;if(!pendingPreviewAssets)renderDerived();}}
async function exportBuilderProject(){try{const blob=await createBuilderProjectFile(project),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(project.conference?.shortName||project.conference?.name||'conference').replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-builder-project.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Builder project exported');}catch(err){console.error(err);toast('Could not export Builder project');}}
async function importBuilderProject(file){try{const incoming=await readBuilderProjectFile(file);clearTimeout(saveTimer);saveRevision++;await pendingSave.catch(()=>{});project={...structuredClone(defaults),...incoming,conference:{...defaults.conference,...incoming.conference},features:{...defaults.features,...incoming.features},policy:{...defaults.policy,...incoming.policy},branding:{...defaults.branding,...incoming.branding,trackColors:{...(incoming.branding?.trackColors||{})},locationColors:{...(incoming.branding?.locationColors||{})}}};await saveProject(project);location.reload();}catch(err){console.error(err);toast(err?.message||'Could not import Builder project');}}

async function download(){try{const {blob,report,pkg}=await packageZip(project);renderReport(report);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${pkg.conference.id||'conference'}-data-package-v${pkg.manifest.dataVersion}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);project.lastExportedVersion=Number(pkg.manifest.dataVersion||project.dataVersion||1);project.lastExportedAt=new Date().toISOString();project.lastExportedFingerprint=await packageContentFingerprint(pkg);scheduleSave();updateReleaseStatus();toast('Validated deployment ZIP downloaded; confirm publication after deploying it');}catch(err){console.error(err);toast(err?.message||'Fix validation errors before exporting');const result=await buildPackage(project);renderReport(result.report);}}
async function confirmPublication(){const {pkg,report}=await buildPackage(project);renderReport(report);if(report.errors.length){toast('Resolve validation errors before confirming publication');return;}if(!confirm(`Confirm that data version ${pkg.manifest.dataVersion} has been deployed to the conference website?`))return;try{await confirmProjectPublication(project,pkg);scheduleSave();updateReleaseStatus();renderDerived();toast(`Version ${pkg.manifest.dataVersion} confirmed as published`);}catch(error){toast(error.message||'Could not confirm publication');}}

async function init(){const saved=await loadProject();if(saved)project={...structuredClone(defaults),...saved,conference:{...defaults.conference,...saved.conference},features:{...defaults.features,...saved.features},policy:{...defaults.policy,...saved.policy},branding:{...defaults.branding,...saved.branding,trackColors:{...defaults.branding.trackColors,...saved.branding?.trackColors},locationColors:{...defaults.branding.locationColors,...saved.branding?.locationColors}},peopleOverrides:{...(saved.peopleOverrides||{})},locationOverrides:{...(saved.locationOverrides||{})},sessionOverrides:{...(saved.sessionOverrides||{})},peoplePhotos:{...(saved.peoplePhotos||{})},extraPeople:Array.isArray(saved.extraPeople)?saved.extraPeople:[],extraLocations:Array.isArray(saved.extraLocations)?saved.extraLocations:[],announcements:Array.isArray(saved.announcements)?saved.announcements:[],deletedSourceIds:Array.isArray(saved.deletedSourceIds)?saved.deletedSourceIds:[],changelog:Array.isArray(saved.changelog)?saved.changelog:[],lastPublishedVersion:Number(saved.lastPublishedVersion||0),lastExportedVersion:Number(saved.lastExportedVersion||0),confirmedPublications:Array.isArray(saved.confirmedPublications)?saved.confirmedPublications:[],identityRegistry:{people:{...(saved.identityRegistry?.people||{})},personRecords:{...(saved.identityRegistry?.personRecords||{})},autoConsolidatedIds:[...(saved.identityRegistry?.autoConsolidatedIds||[])],locations:{...(saved.identityRegistry?.locations||{})},tracks:{...(saved.identityRegistry?.tracks||{})}},logo:saved.logo||null,appIcon:saved.appIcon||null,sponsorFiles:Array.isArray(saved.sponsorFiles)?saved.sponsorFiles:[],sourceFiles:Array.isArray(saved.sourceFiles)?saved.sourceFiles:[]};bindConfig();initBulkEditor();renderRows();renderAnnouncementsBuilder();renderDerived();
  $('#importProgramme').addEventListener('click',doImport);$('#xlsxSheet').addEventListener('change',e=>loadXlsxWorksheet(e.target.value).catch(err=>{console.error(err);toast(err.message||'Could not load worksheet');}));$('#applyMapping').addEventListener('click',applyMapping);$('#addRow').addEventListener('click',()=>{project.rows.push({id:crypto.randomUUID(),date:'',start:'',end:'',type:'talk',session:'',title:'',speaker:'',chair:'',affiliation:'',location:'',track:'',posterNumber:'',abstract:'',doi:'',manualEdited:true});scheduleSave();renderRows();renderDerived();});$('#logoFile').addEventListener('change',e=>chooseLogo(e.target.files[0]));$('#appIconFile').addEventListener('change',e=>chooseAppIcon(e.target.files[0]));$('#sponsorFiles').addEventListener('change',e=>chooseSponsors([...e.target.files]));$('#exportBuilderProject').addEventListener('click',exportBuilderProject);$('#importBuilderProject').addEventListener('click',()=>$('#builderProjectInput').click());$('#builderProjectInput').addEventListener('change',e=>{if(e.target.files[0])importBuilderProject(e.target.files[0]);e.target.value='';});$('#addPerson').addEventListener('click',async()=>{const id=`person-extra-${crypto.randomUUID()}`;project.extraPeople=[...(project.extraPeople||[]),{id,name:'New person',position:'',affiliation:'',publicEmail:'',orcid:'',website:'',photoUrl:''}];scheduleSave();await renderDerived();openPersonEditor(id);});$('#addLocation').addEventListener('click',()=>{project.extraLocations=[...(project.extraLocations||[]),{id:`loc-extra-${crypto.randomUUID()}`,type:'venue',name:'New location',parentLocationId:'',address:'',mapUrl:'',lat:'',lon:''}];scheduleSave();renderDerived();});$('#addAnnouncement').addEventListener('click',()=>{project.announcements.push({id:crypto.randomUUID(),timestamp:new Date().toISOString(),message:'',affectedIds:[]});scheduleSave();renderAnnouncementsBuilder();});$('#validateProject').addEventListener('click',renderDerived);$('#downloadPackage').addEventListener('click',download);$('#confirmPublication').addEventListener('click',confirmPublication);$('#resetProject').addEventListener('click',async()=>{if(!confirm('Reset the entire Builder project?'))return;clearTimeout(saveTimer);saveRevision++;await pendingSave.catch(()=>{});await clearProject();location.reload();});
}
init().then(()=>{
  initWizard();initPeopleUi();setupPreview();
  $('#validationReport').addEventListener('click',event=>{const button=event.target.closest('[data-error-step]');if(!button)return;setStep(button.dataset.errorStep,{focus:true});const id=button.dataset.targetId,type=button.dataset.targetType;if(!id)return;if(type==='person'){openPersonEditor(id);return;}const row=project.rows.find(x=>x.entityId===id||x.id===id);const target=type==='session'?$$('#sessionPreview [data-session-id]').find(el=>el.dataset.sessionId===id):row?$$('#reviewTable tbody tr')[project.rows.indexOf(row)]:null;if(target){target.scrollIntoView({block:'center'});target.querySelector('input,select,textarea')?.focus();}});
}).catch(error=>{console.error(error);setSaveStatus(`Builder could not load: ${error.message}`,true);});
