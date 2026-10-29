import {loadProject,saveProject,clearProject} from './project-store.js';
import {parseCSV,guessMapping,rowsFromMapping,importXlsx,listXlsxSheets,importPdf,analyzePdfProgram,rowsFromStructuredPackage} from './importers.js';
import {buildPackage,packageZip,packageContentFingerprint,confirmProjectPublication} from './package.js';
import {createBuilderProjectFile,readBuilderProjectFile,normalizeBuilderProjectAssets,validateBuilderProjectStructure,validateBuilderProjectTrial} from './project-file.js';
import {mergeImportedRows as mergeProgrammeRows} from './merge.js';
import {reconcileAppearanceNames} from './identity-assignments.js';
import {prepareSourceRemoval,prepareClearImportedProgramme} from './source-removal.js';
import {classifyProgrammeRows,resolveRowProvenance,sourceStateRecords} from './source-provenance.js';
import {mergePersonProfilesMany,identityReviewGroups,applyPersonIdentityDecision} from './people.js';
import {describeValidationMessage} from './validation-ui.js';
import {validatePackage} from '../validation.js';
import {validatePackageSchemas} from '../json-schema.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const FIELDS=['date','start','end','type','session','title','speaker','chair','affiliation','location','track','posterNumber','abstract','doi'];
const MAPPING_FIELDS=[...FIELDS,'speakerId','chairId'];
const LABELS={date:'Date',start:'Start',end:'End',type:'Type',session:'Session',title:'Title',speaker:'Speaker / author',chair:'Chair',affiliation:'Affiliation',location:'Location',track:'Track',posterNumber:'Poster #',abstract:'Abstract',doi:'DOI / link',speakerId:'Speaker / author ID (optional)',chairId:'Chair ID (optional)'};
const defaults={
  conference:{name:'',shortName:'',startDate:'',endDate:'',timezone:'Europe/Helsinki',city:'',country:'',officialWebsite:'',contactEmail:'',venueName:'',venueAddress:''},
  rows:[],features:{photos:true,notes:true,pptxExport:true,friendBook:true,calendarExport:true,announcements:true},policy:{requireAffiliation:false,requireAbstract:false,requireChair:false},branding:{primary:'#5b4b9a',secondary:'#2f7d68',accent:'#5b4b9a',trackColors:{},locationColors:{},headerStyle:'combined',brandMode:'combined',defaultAppearance:'light',previewAppearance:'light',headingFont:'inter',bodyFont:'inter',headerBackgroundLight:'#ffffff',headerBackgroundDark:'#191a1d',logoAlignment:'left',logoSize:36},peopleOverrides:{},locationOverrides:{},sessionOverrides:{},peoplePhotos:{},extraPeople:[],extraLocations:[],announcements:[],deletedSourceIds:[],sourceFiles:[],dataVersion:1,lastPublishedVersion:0,lastExportedVersion:0,confirmedPublications:[],changelog:[],releaseMessage:'Initial Builder release',sourceState:[],mapping:{},identityRegistry:{people:{},locations:{},tracks:{}},identityDecisions:{pairs:{}},logo:null,logoLight:null,logoDark:null,appIcon:null,sponsorFiles:[]
};
const FONT_CHOICES=[['inter','Inter'],['source-sans-3','Source Sans 3'],['space-grotesk','Space Grotesk'],['ibm-plex-sans','IBM Plex Sans'],['ibm-plex-sans-condensed','IBM Plex Sans Condensed'],['noto-serif','Noto Serif']];
const FONT_STACK=Object.fromEntries(FONT_CHOICES.map(([key,label])=>[key,"'"+label+"',system-ui,sans-serif"]));
const LEGACY_FONT=value=>value==='serif'?'noto-serif':value==='condensed'?'ibm-plex-sans-condensed':'inter';
function normalizeBranding(source={}){
  const b={...structuredClone(defaults.branding),...(source||{})};
  if(!Object.hasOwn(source||{},'defaultAppearance'))b.defaultAppearance=source?.darkMode===true?'dark':source?.darkMode===false?'system':'light';
  if(!Object.hasOwn(source||{},'brandMode'))b.brandMode=source?.headerStyle==='logo'?'logo':'combined';
  if(!Object.hasOwn(source||{},'headingFont'))b.headingFont=LEGACY_FONT(source?.typography);
  if(!Object.hasOwn(source||{},'bodyFont'))b.bodyFont=LEGACY_FONT(source?.typography);
  return b;
}
function normalizeSponsorFiles(files=[]){return files.map((item,index)=>item?.bytes?{id:'sponsor-'+(index+1),name:item.name||'Sponsor '+(index+1),light:item,dark:null,height:48}:{id:item?.id||'sponsor-'+(index+1),name:item?.name||'Sponsor '+(index+1),light:item?.light||null,dark:item?.dark||null,height:Math.max(20,Math.min(120,Number(item?.height)||48))});}
let project=structuredClone(defaults),rawRows=[],rawHeaders=[],saveTimer=null,pdfPages=[],pendingXlsxFile=null,pendingXlsxSourceId='',pendingSourceFile=null,pendingMappedRows=[],pendingPdfAnalysis=null,pendingStructuredPackage=null,loadedWorksheetName='',worksheetLoading=false,selectedRows=new Set(),importRevision=0,commitRevision=0,worksheetRevision=0,importCommitInProgress=false,sourceRemovalPlans=null,sourceRemovalBusy=false;
const STEP_NAMES=['Conference details','Programme import','Review & fix','People','Locations & tracks','Branding','Features & announcements','Preview, validate & publish'];
let activeStep=1,latestPackage=null,pendingSave=Promise.resolve(),saveRevision=0,openPersonId='',peopleListSignature='',duplicateSelections=new Map(),pendingPersonMerge=null,duplicatePhotoUrls=[],previewTimer=null,previewAssets=[],pendingPreviewAssets=0,renderRevision=0,appliedRevision=0,previewGeneration=0,previewRequestRevision=0,previewLaunchedRequestRevision=0,previewStatusTimer=null,previewForceRequested=false,assetIdleResolvers=[],renderedIdentitySignature='';
const previewIdentity=`builder-preview-${crypto.randomUUID()}`;

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800);}
function setSaveStatus(message,error=false){const el=$('#builderSaveStatus');if(!el)return;el.textContent=message;el.classList.toggle('error',error);}
function scheduleSave(){const revision=++saveRevision;setSaveStatus('Saving project…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>{const snapshot=structuredClone(project);pendingSave=pendingSave.catch(()=>{}).then(()=>saveProject(snapshot)).then(()=>{if(revision===saveRevision)setSaveStatus('Project saved locally');}).catch(error=>{console.error(error);setSaveStatus('Autosave failed. Your changes are still open; export a project backup.',true);});},200);}
function setStep(step,{focus=false}={}){
  const previousStep=activeStep;activeStep=Math.max(1,Math.min(8,Number(step)||1));project.activeStep=activeStep;
  if(previousStep===4&&activeStep!==4){for(const url of duplicatePhotoUrls)URL.revokeObjectURL(url);duplicatePhotoUrls=[];}
  $$('[data-step]').forEach(panel=>{panel.hidden=Number(panel.dataset.step)!==activeStep;});
  $$('#wizardSteps button').forEach(button=>{if(Number(button.dataset.gotoStep)===activeStep)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
  const progress=`Step ${activeStep} of 8 · ${STEP_NAMES[activeStep-1]}`;
  $('#wizardProgress').textContent=progress;$('#wizardFooterProgress').textContent=progress;
  $('#previousStep').disabled=activeStep===1;$('#nextStep').disabled=activeStep===8;
  if(activeStep===6)updateBrandingPreviews();
  if(latestPackage){if(activeStep===4)renderPeopleDirectory(latestPackage);if(activeStep===5)renderLocationEditor(latestPackage.locations.locations||[],latestPackage.programme.tracks||[]);if(activeStep===3){renderRows();renderSessionEditor(latestPackage.programme.sessions||[],latestPackage.locations.locations||[],latestPackage.programme.tracks||[]);}}
  if(activeStep===8)refreshPreview({force:false});
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
  $$('[data-feature]').forEach(input=>{input.checked=project.features[input.dataset.feature]!==false;input.addEventListener('change',()=>{project.features[input.dataset.feature]=input.checked;scheduleSave();renderDerived();});});
  $$('[data-policy]').forEach(input=>{input.checked=!!project.policy?.[input.dataset.policy];input.addEventListener('change',()=>{project.policy={...(project.policy||{}),[input.dataset.policy]:input.checked};scheduleSave();renderDerived();});});
  $('#primaryColor').value=project.branding.primary;$('#secondaryColor').value=project.branding.secondary;$('#accentColor').value=project.branding.accent;
  ['primaryColor','secondaryColor','accentColor'].forEach(id=>$('#'+id).addEventListener('input',e=>{project.branding[id.replace('Color','')]=e.target.value;scheduleSave();renderDerived();}));
  setupBrandingEditor();
  $('#dataVersion').value=project.dataVersion||1;$('#releaseMessage').value=project.releaseMessage||'';
  updateReleaseStatus();
  $('#dataVersion').addEventListener('input',e=>{project.dataVersion=Number(e.target.value)||1;scheduleSave();});
  $('#releaseMessage').addEventListener('input',e=>{project.releaseMessage=e.target.value;scheduleSave();});
}

let brandingPreviewUrls=[],appIconPreviewUrl='';
function brandingAssetUrl(asset){if(!asset?.bytes)return '';const url=URL.createObjectURL(new Blob([asset.bytes],{type:asset.type||'image/png'}));brandingPreviewUrls.push(url);return url;}
function contrastRatio(a,b){
  const luminance=color=>{const rgb=/^#([\da-f]{6})$/i.exec(color||'');if(!rgb)return 0;const c=[0,2,4].map(i=>parseInt(rgb[1].slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
function contrastText(color){return contrastRatio(color,'#fff')>=contrastRatio(color,'#111')?'#fff':'#111';}
function updateContrastWarnings(){
  const warnings=[];for(const [label,color] of [['Primary',project.branding.primary],['Secondary',project.branding.secondary],['Accent',project.branding.accent]]){const ratio=contrastRatio(color,'#ffffff');if(ratio<4.5)warnings.push(label+' color '+color+' has '+ratio.toFixed(1)+':1 contrast with white text. Preview buttons choose black or white text automatically.');}
  $('#contrastWarnings').innerHTML=warnings.length?warnings.map(x=>'<p class="contrast-warning">'+escapeHtml(x)+'</p>').join(''):'<p class="contrast-ok">Brand colors have readable automatic foreground text. Review both theme previews for your color combinations.</p>';
}
function updateBrandingPreviews(){
  const root=$('#brandingPreviews');if(!root)return;for(const url of brandingPreviewUrls)URL.revokeObjectURL(url);brandingPreviewUrls=[];
  const b=project.branding,c=project.conference,track=Object.values(b.trackColors||{})[0]||b.secondary,room=Object.values(b.locationColors||{})[0]||b.primary;
  const logos={light:brandingAssetUrl(project.logoLight||project.logo||project.logoDark),dark:brandingAssetUrl(project.logoDark||project.logoLight||project.logo)};
  const heading=FONT_STACK[b.headingFont]||FONT_STACK.inter,body=FONT_STACK[b.bodyFont]||FONT_STACK.inter,mode=b.brandMode||'combined';
  let html='';
  for(const theme of ['light','dark']){
    const dark=theme==='dark',bg=dark?b.headerBackgroundDark:b.headerBackgroundLight,ink=contrastText(bg),logo=logos[theme];
    const sponsorHtml=normalizeSponsorFiles(project.sponsorFiles||[]).map(item=>{const src=brandingAssetUrl(item[theme]||item.light||item.dark);return src?'<img src="'+src+'" alt="'+escapeHtml(item.name)+'" style="height:'+item.height+'px">':'';}).join('');
    html+='<article class="brand-theme-card '+(dark?'dark':'light')+'" data-theme="'+theme+'" style="--preview-bg:'+(dark?'#111216':'#f5f6f8')+';--preview-surface:'+(dark?'#1c1e23':'#fff')+';--preview-ink:'+(dark?'#f5f5f7':'#17181c')+';--preview-muted:'+(dark?'#b8bbc5':'#626571')+';--preview-header:'+bg+';--preview-header-ink:'+ink+';--preview-primary:'+b.primary+';--preview-primary-ink:'+contrastText(b.primary)+';--preview-secondary:'+b.secondary+';--preview-secondary-ink:'+contrastText(b.secondary)+';--preview-accent:'+b.accent+';--preview-track:'+track+';--preview-room:'+room+';--preview-heading:'+heading+';--preview-body:'+body+'"><header class="brand-theme-header" data-mode="'+mode+'" data-align="'+b.logoAlignment+'">'+(logo&&mode!=='text'?'<img src="'+logo+'" alt="'+theme+' theme logo" style="height:'+b.logoSize+'px">':'')+'<div class="brand-theme-name"><strong>'+escapeHtml(c.shortName||c.name||'Conference name')+'</strong><small>'+escapeHtml(c.city||'Conference location')+'</small></div></header><div class="brand-theme-content"><nav><span>Programme</span><span>Posters</span><span>My Schedule</span></nav><h4>'+escapeHtml(c.name||'Conference programme')+'</h4><div class="brand-example-card"><small>09:30 · '+escapeHtml(c.startDate||'Programme date')+'</small><strong>Scientific programme example</strong><p>Dr. Renée Åström · ΔE / β-catenin · Room 2</p><div class="brand-chips"><span>Track</span><span>Room</span></div></div><div class="brand-theme-actions"><button>Primary action</button><button class="secondary">Secondary</button><span>Accent</span></div><div class="brand-theme-sponsors">'+(sponsorHtml||'<small>Sponsor marks appear here</small>')+'</div></div></article>';
  }
  root.innerHTML=html;updateContrastWarnings();
}
function syncBrandingControls(){
  const b=project.branding;for(const [id,key] of [['primaryColor','primary'],['secondaryColor','secondary'],['accentColor','accent'],['headerStyle','brandMode'],['defaultAppearance','defaultAppearance'],['brandingPreviewAppearance','previewAppearance'],['logoAlignment','logoAlignment'],['logoSize','logoSize'],['headerBackgroundLight','headerBackgroundLight'],['headerBackgroundDark','headerBackgroundDark'],['headingFont','headingFont'],['bodyFont','bodyFont']])if($('#'+id))$('#'+id).value=b[key]??'';
  $('#logoSizeValue').textContent=(b.logoSize||36)+' px';
  for(const [id,label,asset] of [['logoLightStatus','Light',project.logoLight||project.logo],['logoDarkStatus','Dark',project.logoDark],['appIconStatus','Icon',project.appIcon]]){const node=$('#'+id);if(node)node.textContent=asset?label+' logo uploaded · '+(asset.name||asset.extension||'image'):'No '+label.toLowerCase()+' logo uploaded';}
  const icon=$('#appIconPreview');if(icon){if(appIconPreviewUrl)URL.revokeObjectURL(appIconPreviewUrl);appIconPreviewUrl=project.appIcon?.bytes?URL.createObjectURL(new Blob([project.appIcon.bytes],{type:project.appIcon.type||'image/png'})):'';icon.src=appIconPreviewUrl;icon.hidden=!appIconPreviewUrl;}
}
function renderSponsorAssets(){
  const root=$('#sponsorAssetList');if(!root)return;project.sponsorFiles=normalizeSponsorFiles(project.sponsorFiles||[]);
  root.innerHTML=project.sponsorFiles.map((item,i)=>'<article class="sponsor-editor" data-sponsor-index="'+i+'"><div class="sponsor-editor-tools"><strong>'+(i+1)+'. '+escapeHtml(item.name)+'</strong><button type="button" data-sponsor-action="up" aria-label="Move sponsor up" '+(i===0?'disabled':'')+'>↑</button><button type="button" data-sponsor-action="down" aria-label="Move sponsor down" '+(i===project.sponsorFiles.length-1?'disabled':'')+'>↓</button><button type="button" data-sponsor-action="remove">Remove</button></div><div class="sponsor-editor-fields"><label>Name<input data-sponsor-name value="'+escapeHtml(item.name)+'"></label><label>Display height<input data-sponsor-height type="number" min="20" max="120" value="'+item.height+'"></label><label>Light logo<input data-sponsor-file="light" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"><small>'+(item.light?'Uploaded: '+escapeHtml(item.light.name||'image'):'No light variant')+'</small><button type="button" data-sponsor-clear="light">Remove light variant</button></label><label>Dark logo<input data-sponsor-file="dark" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"><small>'+(item.dark?'Uploaded: '+escapeHtml(item.dark.name||'image'):'Uses light variant')+'</small><button type="button" data-sponsor-clear="dark">Remove dark variant</button></label></div></article>').join('')||'<p class="muted">No sponsor logos added.</p>';
}
async function chooseThemeLogo(theme,file){const key=theme==='light'?'logoLight':'logoDark';pendingPreviewAssets++;try{project[key]=file?await assetFromFile(file):null;if(theme==='light'&&!file)project.logo=null;scheduleSave();syncBrandingControls();updateBrandingPreviews();}finally{finishPreviewAssetRead();}}
function setupBrandingEditor(){
  const choices=FONT_CHOICES.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');$('#headingFont').innerHTML=choices;$('#bodyFont').innerHTML=choices;
  project.branding=normalizeBranding(project.branding);project.sponsorFiles=normalizeSponsorFiles(project.sponsorFiles||[]);syncBrandingControls();renderSponsorAssets();updateBrandingPreviews();
  const store=(key,value)=>{project.branding[key]=value;if(key==='defaultAppearance')delete project.branding.darkMode;if(key==='brandMode')project.branding.headerStyle=value;if(key==='previewAppearance')$('#previewAppearance').value=value;scheduleSave();updateBrandingPreviews();renderDerived();if(key==='previewAppearance'&&activeStep===8)refreshPreview();};
  [['primaryColor','primary'],['secondaryColor','secondary'],['accentColor','accent'],['headerBackgroundLight','headerBackgroundLight'],['headerBackgroundDark','headerBackgroundDark']].forEach(([id,key])=>$('#'+id).addEventListener('input',e=>store(key,e.target.value)));
  [['headerStyle','brandMode'],['defaultAppearance','defaultAppearance'],['brandingPreviewAppearance','previewAppearance'],['logoAlignment','logoAlignment'],['headingFont','headingFont'],['bodyFont','bodyFont']].forEach(([id,key])=>$('#'+id).addEventListener('change',e=>store(key,e.target.value)));
  $('#logoSize').addEventListener('input',e=>{project.branding.logoSize=Number(e.target.value);$('#logoSizeValue').textContent=e.target.value+' px';scheduleSave();updateBrandingPreviews();renderDerivedDebounced();});
  $('#logoLightFile').addEventListener('change',async e=>{await chooseThemeLogo('light',e.target.files?.[0]);e.target.value='';});
  $('#logoDarkFile').addEventListener('change',async e=>{await chooseThemeLogo('dark',e.target.files?.[0]);e.target.value='';});
  $('#removeLightLogo').addEventListener('click',()=>chooseThemeLogo('light',null));$('#removeDarkLogo').addEventListener('click',()=>chooseThemeLogo('dark',null));
  $('#removeAppIcon').addEventListener('click',()=>{project.appIcon=null;scheduleSave();syncBrandingControls();});
  $('#addSponsor').addEventListener('click',()=>{project.sponsorFiles.push({id:'sponsor-'+crypto.randomUUID(),name:'Sponsor '+(project.sponsorFiles.length+1),light:null,dark:null,height:48});scheduleSave();renderSponsorAssets();});
  $('#sponsorAssetList').addEventListener('click',event=>{const button=event.target.closest('[data-sponsor-action]');if(!button)return;const index=Number(button.closest('[data-sponsor-index]').dataset.sponsorIndex),action=button.dataset.sponsorAction;if(action==='remove')project.sponsorFiles.splice(index,1);else{const other=index+(action==='up'?-1:1);if(other<0||other>=project.sponsorFiles.length)return;[project.sponsorFiles[index],project.sponsorFiles[other]]=[project.sponsorFiles[other],project.sponsorFiles[index]];}scheduleSave();renderSponsorAssets();updateBrandingPreviews();renderDerived();});
  $('#sponsorAssetList').addEventListener('click',event=>{const button=event.target.closest('[data-sponsor-clear]');if(!button)return;const row=button.closest('[data-sponsor-index]');project.sponsorFiles[Number(row.dataset.sponsorIndex)][button.dataset.sponsorClear]=null;scheduleSave();renderSponsorAssets();updateBrandingPreviews();renderDerived();});
  $('#sponsorAssetList').addEventListener('change',async event=>{const input=event.target.closest('[data-sponsor-file]');if(!input)return;const index=Number(input.closest('[data-sponsor-index]').dataset.sponsorIndex);pendingPreviewAssets++;try{project.sponsorFiles[index][input.dataset.sponsorFile]=await assetFromFile(input.files?.[0]);scheduleSave();renderSponsorAssets();updateBrandingPreviews();}finally{finishPreviewAssetRead();}});
  $('#sponsorAssetList').addEventListener('input',event=>{const row=event.target.closest('[data-sponsor-index]');if(!row)return;const item=project.sponsorFiles[Number(row.dataset.sponsorIndex)];if(event.target.matches('[data-sponsor-name]'))item.name=event.target.value;if(event.target.matches('[data-sponsor-height]'))item.height=Math.max(20,Math.min(120,Number(event.target.value)||48));scheduleSave();updateBrandingPreviews();renderDerivedDebounced();});
  $('#resetBranding').addEventListener('click',()=>{const keep={trackColors:project.branding.trackColors||{},locationColors:project.branding.locationColors||{}};project.branding={...structuredClone(defaults.branding),...keep};syncBrandingControls();scheduleSave();updateBrandingPreviews();renderDerived();});
  $('#brandingPreset').addEventListener('change',event=>{const presets={indigo:['#4d46a8','#237c75','#bc3f74'],ocean:['#145c91','#147b78','#df633d'],forest:['#246b50','#7c6725','#a74632'],mono:['#24262c','#565b66','#0a6fa6']},values=presets[event.target.value];if(!values)return;[project.branding.primary,project.branding.secondary,project.branding.accent]=values;syncBrandingControls();scheduleSave();updateBrandingPreviews();renderDerived();});
}

function updateReleaseStatus(){const el=$('#releaseStatus');if(!el)return;const published=project.lastPublishedVersion?`Last confirmed published: v${project.lastPublishedVersion}${project.lastPublishedAt?` · ${new Date(project.lastPublishedAt).toLocaleString()}`:''}`:'No release confirmed as published';const exported=project.lastExportedVersion?`Last exported: v${project.lastExportedVersion}${project.lastExportedAt?` · ${new Date(project.lastExportedAt).toLocaleString()}`:''}`:'No package exported yet';el.textContent=`${published}. ${exported}. Downloading a ZIP does not confirm deployment.`;}

function mappingOptions(selected=''){return `<option value="">— not mapped —</option>${rawHeaders.map(h=>`<option ${h===selected?'selected':''}>${escapeHtml(h)}</option>`).join('')}`;}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

function updateSelectedCount(){const el=$('#selectedRowCount');if(el)el.textContent=`${selectedRows.size} selected`;const all=$('#selectAllRows');if(all){const visible=project.rows.map(r=>r.id);all.checked=!!visible.length&&visible.every(id=>selectedRows.has(id));all.indeterminate=visible.some(id=>selectedRows.has(id))&&!all.checked;}}
function initBulkEditor(){const field=$('#bulkField');if(!field)return;field.innerHTML=FIELDS.map(f=>`<option value="${f}">${escapeHtml(LABELS[f])}</option>`).join('');$('#applyBulkEdit')?.addEventListener('click',()=>{if(!selectedRows.size)return toast('Select at least one row');const key=field.value,value=$('#bulkValue').value;const calendarFields=new Set(['date','start','end','title','location','session']);let changed=0;for(const row of project.rows){if(!selectedRows.has(row.id))continue;const before=String(row[key]??'');row[key]=value;row.manualFields={...(row.manualFields||{}),[key]:true};if(calendarFields.has(key)&&before!==String(value))row.sequence=Number(row.sequence||0)+1;changed++;}scheduleSave();renderRows();renderDerived();toast(`Updated ${changed} row${changed===1?'':'s'}`);});$('#selectAllRows')?.addEventListener('change',e=>{if(e.target.checked)project.rows.forEach(r=>selectedRows.add(r.id));else selectedRows.clear();renderRows();});}
function sessionFieldInput(session,field,locations,tracks){const value=session[field]??'';if(field==='locationId')return `<select data-session-field="locationId"><option value="">— none —</option>${locations.map(l=>`<option value="${escapeHtml(l.id)}" ${l.id===value?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select>`;if(field==='trackId')return `<select data-session-field="trackId"><option value="">— none —</option>${tracks.map(t=>`<option value="${escapeHtml(t.id)}" ${t.id===value?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select>`;const type=field==='date'?'date':(['start','end'].includes(field)?'time':'text');return `<input type="${type}" data-session-field="${field}" value="${escapeHtml(value)}">`;}
function renderSessionEditor(sessions,locations,tracks){const root=$('#sessionPreview');if(!root)return;const bySessionId=new Map((sessions||[]).map(s=>[s.id,s]));root.innerHTML=(sessions||[]).map(s=>`<div class="session-card" data-session-id="${escapeHtml(s.id)}"><div class="session-card-head"><strong>${escapeHtml(s.title||'Session')}</strong><code>${escapeHtml(s.id)}</code></div><div class="session-card-grid"><label>Title${sessionFieldInput(s,'title',locations,tracks)}</label><label>Date${sessionFieldInput(s,'date',locations,tracks)}</label><label>Start${sessionFieldInput(s,'start',locations,tracks)}</label><label>End${sessionFieldInput(s,'end',locations,tracks)}</label><label>Location${sessionFieldInput(s,'locationId',locations,tracks)}</label><label>Track${sessionFieldInput(s,'trackId',locations,tracks)}</label></div></div>`).join('')||'<span class="muted">No sessions yet.</span>';root.querySelectorAll('[data-session-field]').forEach(el=>el.addEventListener('change',()=>{const card=el.closest('[data-session-id]'),id=card.dataset.sessionId,field=el.dataset.sessionField;const current=project.sessionOverrides?.[id]||{};const before=String(bySessionId.get(id)?.[field]??'');const value=el.value;project.sessionOverrides={...(project.sessionOverrides||{}),[id]:{...current,[field]:value,sequenceBump:Number(current.sequenceBump||0)+(before!==String(value)?1:0)}};scheduleSave();renderDerivedDebounced();}));}

function showMapping(mapping){const grid=$('#mappingGrid');grid.innerHTML=MAPPING_FIELDS.map(f=>`<label>${LABELS[f]}<select data-map="${f}">${mappingOptions(mapping[f])}</select></label>`).join('');$('#mappingCard').hidden=false;$('#applyMapping').textContent='Preview mapped changes';}
function mergeImportedRows(base,nextRows,resolutions={}){return mergeProgrammeRows(base.rows,nextRows,base.deletedSourceIds,resolutions);}
function renderSourceManager(){
  const root=$('#sourceManager');if(!root)return;
  const classified=classifyProgrammeRows(project),provenance=new Map(classified.map(item=>[item.row.id,item]));
  const uncertain=classified.filter(item=>item.origin==='uncertain').length,orphaned=classified.filter(item=>item.orphaned).length;
  $('#orphanProgrammeSummary').textContent=uncertain||orphaned?`${orphaned} imported entries have incomplete source links; ${uncertain} entries have uncertain origin. Use “Clear imported programme data” to review and remove orphaned records safely.`:'All programme entries have clear source or manual provenance.';
  root.innerHTML=(project.sourceFiles||[]).map(source=>{
    const rows=(project.rows||[]).filter(row=>provenance.get(row.id)?.sourceIds.includes(source.id));
    const edited=rows.filter(row=>Object.keys(row.manualFields||{}).length),shared=rows.filter(row=>(row.source?.contributors||[]).filter(x=>x!==source.id).length);
    return `<details class="source-record" data-source-record="${escapeHtml(source.id)}"><summary><strong>${escapeHtml(source.name||'Imported file')}</strong><span>${escapeHtml((source.name||'').split('.').pop()?.toUpperCase()||'FILE')}</span><span>${escapeHtml(source.importedAt?new Date(source.importedAt).toLocaleDateString():'Import date unavailable')}</span><span>${rows.length} programme entries</span><span>${Number(source.updatedRecords||0)} updated · ${shared.length} shared · ${edited.length} manually edited</span></summary><div class="source-details"><p>${escapeHtml(source.status||'Imported')} · ${Number(source.contributedRecords||rows.length)} records contributed</p><ul>${rows.map(row=>`<li>${escapeHtml(row.title||'Untitled')} · ${escapeHtml(row.date||'date unknown')} ${escapeHtml(row.start||'')} · ${escapeHtml(row.source?.sheet||'')} ${row.source?.row?`row ${row.source.row}`:row.source?.page?`page ${row.source.page}`:''}${Object.keys(row.manualFields||{}).length?' · organizer edited':''}</li>`).join('')||'<li>No current programme entries</li>'}</ul><button class="secondary-btn" type="button" data-remove-source="${escapeHtml(source.id)}">Remove source…</button></div></details>`;
  }).join('')||'<p class="muted">No programme sources imported yet.</p>';
}
const sourceRemovalLabel={'remove-associated':'Remove source and associated programme data','preserve-edited':'Remove source but preserve manually edited entries'};
function renderSourceRemovalImpact(plan){
  const impact=plan.impact;$('#sourceRemovalDescription').textContent=sourceRemovalLabel[plan.strategy];
  for(const [key,value] of Object.entries(impact)){const target=$(`[data-removal-impact="${key}"]`);if(target)target.textContent=String(value);}
}
async function openSourceRemoval(id){
  if(sourceRemovalBusy)return;
  try{
    const [removeAssociated,preserveEdited]=await Promise.all([prepareSourceRemoval(structuredClone(project),id,'remove-associated'),prepareSourceRemoval(structuredClone(project),id,'preserve-edited')]);
    if(!(project.sourceFiles||[]).some(source=>source.id===id))return;
    sourceRemovalPlans={id,options:{'remove-associated':removeAssociated,'preserve-edited':preserveEdited}};
    const source=(project.sourceFiles||[]).find(item=>item.id===id);$('#sourceRemovalTitle').textContent=`Remove ${source.name||'imported source'}?`;
    $$('input[name="sourceRemovalStrategy"]').forEach(input=>input.checked=false);
    $('#sourceRemovalImpact').hidden=true;$('#confirmSourceRemoval').disabled=true;$('#sourceRemovalDescription').textContent='Choose an option to see exactly what will change.';
    $('#sourceRemovalDialog').showModal();
  }catch(error){console.error(error);toast(error.message||'Could not prepare source-removal preview; the project was not changed');}
}
async function confirmSourceRemoval(){
  if(sourceRemovalBusy||!sourceRemovalPlans)return;
  const strategy=$('input[name="sourceRemovalStrategy"]:checked')?.value;if(!strategy)return toast('Choose how to handle programme entries supported by this source');
  sourceRemovalBusy=true;$('#confirmSourceRemoval').disabled=true;$('#cancelSourceRemoval').disabled=true;
  const sourceId=sourceRemovalPlans.id;
  try{
    ++importRevision;++worksheetRevision;++renderRevision;clearTimeout(deriveTimer);deriveTimer=null;pendingSourceFile=null;pendingMappedRows=[];pendingStructuredPackage=null;pendingPdfAnalysis=null;pendingXlsxFile=null;pendingXlsxSourceId='';
    clearTimeout(saveTimer);saveRevision++;await pendingSave.catch(()=>{});
    const previous=structuredClone(project),plan=await prepareSourceRemoval(previous,sourceId,strategy);
    await persistAndVerifyProject(plan.project,plan);
    project=plan.project;selectedRows=new Set([...selectedRows].filter(rowId=>project.rows.some(row=>row.id===rowId)));
    $('#sourceRemovalDialog').close();sourceRemovalPlans=null;
    renderRows();renderSourceManager();await renderDerived();
    setSaveStatus('Project saved locally');
    toast(`Source removed · ${plan.impact.programmeEntriesToDelete} programme entries deleted · ${plan.impact.entriesRetainedAsManual} retained as manually maintained`);
  }catch(error){console.error(error);setSaveStatus('Source removal was not saved. The previous project remains intact.',true);toast(error.message||'Could not remove source; the previous project remains intact');}
  finally{sourceRemovalBusy=false;$('#cancelSourceRemoval').disabled=false;$('#confirmSourceRemoval').disabled=!$('input[name="sourceRemovalStrategy"]:checked');}
}
async function persistAndVerifyProject(next,plan){
  const previous=structuredClone(project),expectedRowIds=(next.rows||[]).map(row=>row.id).sort(),expectedSources=(next.sourceFiles||[]).map(source=>source.id).sort();
  const removedSourceIds=new Set((previous.sourceFiles||[]).map(source=>source.id).filter(id=>!expectedSources.includes(id)));
  try{
    await saveProject(next);
    const persisted=await loadProject();if(!persisted)throw new Error('The saved project could not be read back from local storage');
    if(JSON.stringify((persisted.rows||[]).map(row=>row.id).sort())!==JSON.stringify(expectedRowIds))throw new Error('The saved programme rows do not match the removal plan');
    if(JSON.stringify((persisted.sourceFiles||[]).map(source=>source.id).sort())!==JSON.stringify(expectedSources))throw new Error('The saved source list does not match the removal plan');
    for(const row of persisted.rows||[]){const source=row.source||{},refs=[source.fileId,...(source.contributors||[]),...(source.sources||[]).flatMap(ref=>[ref?.fileId,ref?.sourceId]),...(source.sourceRecords||[]),source.id].filter(Boolean).map(String);if(refs.some(ref=>[...removedSourceIds].some(id=>ref===id||ref.startsWith(`${id}:`)||ref.startsWith(`${id}/`)||ref.startsWith(`${id}#`))))throw new Error(`Programme entry “${row.title||row.id}” still references a removed source`);const activeRefs=resolveRowProvenance(persisted,row).sourceIds;if(activeRefs.some(id=>!(persisted.sourceFiles||[]).some(sourceFile=>sourceFile.id===id)))throw new Error(`Programme entry “${row.title||row.id}” still references an unavailable source`);}
    const rebuilt=await buildPackage(persisted);if(plan?.package&&await packageContentFingerprint(rebuilt.pkg)!==await packageContentFingerprint(plan.package))throw new Error('The saved package does not match the reviewed removal result');
    return persisted;
  }catch(error){
    try{await saveProject(previous);}catch(restoreError){throw new Error(`Removal verification failed (${error.message}); restoring the previous Builder project also failed (${restoreError.message})`);}
    throw new Error(`Removal was not applied: ${error.message}. The previous project was restored.`);
  }
}
let clearProgrammePlan=null,clearProgrammeBusy=false;
async function openClearProgramme(){
  if(clearProgrammeBusy)return;
  try{
    const plan=await prepareClearImportedProgramme(structuredClone(project),null);clearProgrammePlan=plan;
    for(const [key,value] of Object.entries(plan.impact)){const target=$(`[data-clear-impact="${key}"]`);if(target&&typeof value==='number')target.textContent=String(value);}
    const section=$('#uncertainProgrammeRows'),root=$('#uncertainProgrammeChoices');root.innerHTML='';section.hidden=!plan.impact.uncertainRows.length;
    for(const row of plan.impact.uncertainRows){const item=document.createElement('fieldset');item.className='uncertain-programme-choice';item.dataset.uncertainRow=row.id;item.innerHTML=`<legend>${escapeHtml(row.title)} · ${escapeHtml(row.date||'date unknown')}</legend><label><input type="radio" name="uncertain-${escapeHtml(row.id)}" value="keep"><span>Keep as manually maintained</span></label><label><input type="radio" name="uncertain-${escapeHtml(row.id)}" value="delete"><span>Delete as imported</span></label>`;root.append(item);}
    $('#confirmClearProgramme').disabled=plan.impact.uncertainRows.length>0;$('#clearProgrammeDialog').showModal();
  }catch(error){console.error(error);toast(error.message||'Could not prepare imported programme cleanup');}
}
async function confirmClearProgramme(){
  if(clearProgrammeBusy||!clearProgrammePlan)return;
  const decisions={};for(const row of clearProgrammePlan.impact.uncertainRows){const selected=$(`[name="uncertain-${CSS.escape(row.id)}"]:checked`);if(!selected)return toast(`Choose whether to delete or keep “${row.title}”`);decisions[row.id]=selected.value;}
  clearProgrammeBusy=true;$('#confirmClearProgramme').disabled=true;$('#cancelClearProgramme').disabled=true;
  try{
    ++importRevision;++worksheetRevision;++renderRevision;clearTimeout(deriveTimer);deriveTimer=null;pendingSourceFile=null;pendingMappedRows=[];pendingStructuredPackage=null;pendingPdfAnalysis=null;pendingXlsxFile=null;pendingXlsxSourceId='';
    clearTimeout(saveTimer);saveRevision++;await pendingSave.catch(()=>{});
    const plan=await prepareClearImportedProgramme(structuredClone(project),decisions);await persistAndVerifyProject(plan.project,plan);
    project=plan.project;selectedRows.clear();sourceRemovalPlans=null;clearProgrammePlan=null;$('#clearProgrammeDialog').close();
    renderRows();renderSourceManager();await renderDerived();
    setSaveStatus('Project saved locally');toast(`Imported programme cleared · ${plan.impact.importedEntriesToDelete+plan.impact.uncertainEntriesSelected} entries deleted · ${plan.impact.manualEntriesRetained} manual entries retained`);
  }catch(error){console.error(error);setSaveStatus('Programme cleanup was not saved. The previous project remains intact.',true);toast(error.message||'Could not clear imported programme data');}
  finally{clearProgrammeBusy=false;$('#cancelClearProgramme').disabled=false;$('#confirmClearProgramme').disabled=false;}
}
async function commitImportedProject(next,revision){
  if(revision!==importRevision)throw new Error('A newer import replaced this result; please apply the current preview.');
  if(importCommitInProgress)throw new Error('Another import is being saved; wait for it to finish before applying this result.');
  validateBuilderProjectStructure(next);
  if(revision!==importRevision)throw new Error('A newer import replaced this result; please apply the current preview.');
  importCommitInProgress=true;const previousInert=document.body.inert;document.body.inert=true;const commit=++commitRevision;
  clearTimeout(saveTimer);saveRevision++;
  try{
    await pendingSave.catch(()=>{});
    if(commit!==commitRevision||revision!==importRevision)throw new Error('Import was superseded before it could be saved.');
    await saveProject(structuredClone(project));
    await saveProject(structuredClone(next));
    project=next;setSaveStatus('Project saved locally');
  }catch(error){setSaveStatus('Import was not saved; the previous project is preserved.',true);throw error;}
  finally{document.body.inert=previousInert;importCommitInProgress=false;}
}
async function applyMapping(){
  if(!rawRows.length||!pendingSourceFile)return toast('Load an import preview first');
  if(pendingXlsxFile&&(worksheetLoading||loadedWorksheetName!==$('#xlsxSheet').value))return toast('Wait for the selected worksheet to finish loading before applying its mapping.');
  const revision=importRevision,mapping={};$$('[data-map]').forEach(s=>mapping[s.dataset.map]=s.value);
  try{pendingMappedRows=rowsFromMapping(rawRows,mapping);const comparison=compareProgrammeImport(pendingMappedRows,$('#importMode').value,pendingSourceFile);showImportComparison(comparison);}
  catch(error){console.error(error);toast(error?.message||'Could not prepare import preview');}
}
function compareProgrammeImport(incoming,mode,source,resolutions={}){
  const original=project.rows||[],merged=mergeImportedRows(structuredClone(project),incoming,resolutions),incomingIds=new Set(incoming.map(row=>row.source.id));
  const hasIncomingSource=row=>incomingIds.has(row.source?.id)||(row.source?.sourceRecords||[]).some(id=>incomingIds.has(id))||(row.source?.sources||[]).some(sourceRef=>incomingIds.has(sourceRef.id));
  const byId=new Map(original.map(row=>[row.id,row])),matched=new Set(),added=[],updated=[],unchanged=[];
  for(const row of merged.rows){if(!hasIncomingSource(row))continue;const old=byId.get(row.id);if(!old){added.push(row);continue;}matched.add(old.id);const changed=FIELDS.some(field=>String(old[field]??'')!==String(row[field]??''));(changed?updated:unchanged).push(row);}
  const removed=mode==='replace-programme'?original.filter(row=>!matched.has(row.id)):mode==='replace-source'?original.filter(row=>(row.source?.fileId===source.id||row.source?.contributors?.includes(source.id))&&!matched.has(row.id)&&!Object.keys(row.manualFields||{}).length):[];
  const removedIds=new Set(removed.map(row=>row.id));
  const rows=mode==='replace-programme'?merged.rows.filter(hasIncomingSource):mode==='replace-source'?merged.rows.filter(row=>!removedIds.has(row.id)):merged.rows;
  return {rows,conflicts:merged.conflicts,reviewMatches:merged.reviewMatches||[],added,updated,unchanged,removed,mode,resolutions};
}
function showImportComparison(comparison){
  const el=$('#importReview');el.hidden=false;el.dataset.mode=comparison.mode;
  const names={merge:'Merge with existing programme','replace-source':"Replace this source's entries",'replace-programme':'Replace entire programme'};
  const uncertain=comparison.reviewMatches.map(match=>{const opts=match.candidates.map(candidate=>`<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.title)} · ${escapeHtml(candidate.date)} ${escapeHtml(candidate.start)} · ${escapeHtml(candidate.location)} · ${escapeHtml(candidate.session)}</option>`).join('');return `<li><strong>Incoming:</strong> ${escapeHtml(pendingMappedRows.find(row=>row.source.id===match.incomingId)?.title||match.incomingId)} <label>Resolution<select data-import-match="${escapeHtml(match.incomingId)}"><option value="">Choose how to resolve…</option><option value="__separate__">Keep as a separate entry</option>${opts}</select></label></li>`;}).join('');
  el.innerHTML=`<h3>Import preview · ${escapeHtml(names[comparison.mode])}</h3><div class="import-summary"><span><strong>${comparison.added.length}</strong> new</span><span><strong>${comparison.updated.length}</strong> updated</span><span><strong>${comparison.unchanged.length}</strong> unchanged</span><span><strong>${comparison.reviewMatches.length}</strong> uncertain matches</span><span><strong>${comparison.removed.length}</strong> scheduled for removal</span></div>${comparison.reviewMatches.length?`<details open><summary>Choose uncertain matches or retain separately</summary><ul>${uncertain}</ul></details>`:''}${comparison.conflicts.length?`<details><summary>Other import notes</summary><ul>${comparison.conflicts.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></details>`:''}${comparison.removed.length?`<details><summary>Entries scheduled for removal</summary><ul>${comparison.removed.map(row=>`<li>${escapeHtml(row.title||'Untitled')} · ${escapeHtml(row.date||'date unknown')} ${escapeHtml(row.start||'')}</li>`).join('')}</ul></details>`:''}<p class="muted">${comparison.mode==='replace-programme'?'This replaces the full programme and may remove unmatched row identities, overrides, and calendar identifiers. Conference settings and branding remain unchanged.':comparison.mode==='replace-source'?'Unmatched entries from this source are removed unless manually edited; other sources remain.':'Confident matches retain IDs and organizer corrections. Uncertain matches stay separate unless you select a specific existing entry above.'}</p><button id="confirmImportChanges" class="primary-btn" type="button">Confirm import</button> <button id="cancelImportPreview" class="secondary-btn" type="button">Cancel</button>`;
  $('#confirmImportChanges').addEventListener('click',()=>{try{const selects=[...el.querySelectorAll('[data-import-match]')];if(selects.some(input=>!input.value))return toast('Choose a match or explicitly keep each uncertain entry separate');const choices=Object.fromEntries(selects.map(input=>[input.dataset.importMatch,input.value]));const revised=compareProgrammeImport(pendingMappedRows,comparison.mode,pendingSourceFile,choices);if(revised.reviewMatches.length){showImportComparison(revised);return;}confirmMappedImport(revised);}catch(error){toast(error.message||'Selected import matches conflict; review those choices and try again');}});$('#cancelImportPreview').addEventListener('click',()=>{el.hidden=true;pendingMappedRows=[];pendingPdfAnalysis=null;pendingStructuredPackage=null;});
}
async function confirmMappedImport(comparison){
  const revision=importRevision,source=pendingSourceFile;if(!source||!pendingMappedRows.length)return toast('Import preview is no longer available');
  try{const next=structuredClone(project),mapping=Object.fromEntries($$('[data-map]').map(el=>[el.dataset.map,el.value]));next.mapping=mapping;next.rows=comparison.rows;next.reimportConflicts=comparison.conflicts;const sourceState=sourceStateRecords(next).filter(item=>item.fileId!==source.id&&!String(item.sourceRecordId||'').startsWith(`${source.id}:`));next.sourceState=[...sourceState,...rawRows.map((row,i)=>({fileId:source.id,sourceId:`${row.__sourceFileId||'source'}:${row.__sheet||'source'}:${row.__sourceRow||i+1}`,raw:row,mapping}))];
    const record={...source,importedAt:new Date().toISOString(),contributedRecords:pendingMappedRows.length,updatedRecords:comparison.updated.length,status:'Imported'};const files=(next.sourceFiles||[]).filter(x=>x.id!==source.id&&x.name!==source.name);next.sourceFiles=comparison.mode==='replace-programme'?[record]:[...files,record];if(pendingXlsxFile)next.lastWorksheet=$('#xlsxSheet').value;
    if(pendingPdfAnalysis?.pages)next.sourceState=[...(next.sourceState||[]),...pendingPdfAnalysis.pages.map(page=>({...page,sourceFileId:source.id}))];
    if(pendingStructuredPackage){const json=pendingStructuredPackage;next.conference={...next.conference,...json.conference};if(Number.isInteger(Number(json.manifest?.dataVersion)))next.dataVersion=Math.max(Number(next.dataVersion||1),Number(json.manifest.dataVersion));next.changelog=[...new Map([...(next.changelog||[]),...(Array.isArray(json.manifest?.changelog)?json.manifest.changelog:[])].map(item=>[Number(item.version),item])).values()].sort((a,b)=>Number(a.version)-Number(b.version));next.features={...next.features,...(json.conference.features||{})};next.branding={...next.branding,...(json.branding||{}),trackColors:{...(next.branding?.trackColors||{}),...(json.branding?.trackColors||{})},locationColors:{...(next.branding?.locationColors||{}),...(json.branding?.locationColors||{})}};for(const person of json.people?.people||[])next.peopleOverrides[person.id]={...(next.peopleOverrides[person.id]||{}),name:person.name||'',position:person.position||'',affiliation:(person.affiliations||[]).join('; '),publicEmail:person.publicEmail||person.email||'',orcid:person.orcid||'',website:(person.links||[]).find(x=>x.label==='Website')?.url||'',photoUrl:person.photoUrl||'',papers:person.papers||[]};for(const loc of json.locations?.locations||[])next.locationOverrides[loc.id]={...(next.locationOverrides[loc.id]||{}),name:loc.name,type:loc.type,parentLocationId:loc.parentLocationId,address:loc.address,mapUrl:loc.mapUrl,lat:loc.lat,lon:loc.lon};next.announcements=[...(json.programme.announcements||[])];}
    await commitImportedProject(next,revision);pendingSourceFile=null;pendingMappedRows=[];pendingPdfAnalysis=null;pendingStructuredPackage=null;$('#importReview').hidden=true;renderRows();renderDerived();renderSourceManager();$('#importStatus').textContent=`${record.name}: ${comparison.added.length} new, ${comparison.updated.length} updated, ${comparison.unchanged.length} unchanged`;toast('Programme import saved');
  }catch(error){console.error(error);toast(error?.message||'Import failed; existing project preserved');}
}

function identityIssueSignature(){return JSON.stringify((project.rows||[]).map(row=>[row.id,(row.personIdentityIssues||[]).map(issue=>[issue.role,issue.index,issue.name,issue.candidateIds])]));}
function rowInput(row,index,field){
  const value=row[field]??'';
  if(field==='type')return `<select data-row="${index}" data-field="type">${['talk','plenary','keynote','special','break','meal','social','registration','poster'].map(type=>`<option ${value===type?'selected':''}>${type}</option>`).join('')}</select>`;
  if(field==='abstract')return `<textarea data-row="${index}" data-field="${field}" rows="2">${escapeHtml(value)}</textarea>`;
  const type=field==='date'?'date':(field==='start'||field==='end')?'time':'text';
  const color=field==='location'?project.branding.locationColors?.[row.locationEntityId]:field==='track'?project.branding.trackColors?.[row.trackEntityId]:'';
  const input=`<input type="${type}" data-row="${index}" data-field="${field}" value="${escapeHtml(value)}" ${color?`style="border-left:4px solid ${escapeHtml(color)}"`:''}>`;
  const manualLabel=field==='title'&&row.manuallyMaintained?'<small class="manual-maintained-badge">Manually maintained</small>':'';
  if(!['speaker','chair'].includes(field))return input+manualLabel;
  const issues=(row.personIdentityIssues||[]).filter(issue=>issue.role===field),idField=field==='speaker'?'speakerEntityIds':'chairEntityIds';
  const candidateLabel=(id)=>{const person=latestPackage?.people.people.find(item=>item.id===id);if(!person)return 'Profile context unavailable';const contexts=(project.rows||[]).filter(item=>item.id!==row.id&&[...(item.speakerEntityIds||[]),...(item.chairEntityIds||[]),...(item.authorEntityIds||[])].includes(id)).slice(0,2).map(item=>`${item.title||item.session||'Programme entry'} · ${item.date||'date unknown'} ${item.start||''} · ${item.location||'room unknown'}`);return `${person.name} — ${(person.affiliations||[]).join('; ')||'affiliation unknown'}${person.position?` · ${person.position}`:''}${contexts.length?` · Also: ${contexts.join(' / ')}`:''}`;};
  const selectors=issues.map(issue=>`<div class="identity-choice" data-identity-issue="${field}:${issue.index}"><p><strong>${escapeHtml(issue.role==='speaker'&&String(row.type).toLowerCase()==='poster'?'Poster author':field==='speaker'?'Speaker':'Chair')}: ${escapeHtml(issue.name)}</strong> needs an assignment for <em>${escapeHtml(row.title||row.session||'this programme entry')}</em>${row.date?` · ${escapeHtml(row.date)}`:''}${row.start?` ${escapeHtml(row.start)}${row.end?`–${escapeHtml(row.end)}`:''}`:''}.</p><label>Choose the profile for this appearance<select data-person-identity data-row-id="${escapeHtml(row.id)}" data-person-role="${field}" data-person-index="${issue.index}" aria-label="Choose profile for ${escapeHtml(issue.name)} as ${escapeHtml(field)} in ${escapeHtml(row.title||row.session||'programme entry')}"><option value="">Choose a person…</option>${issue.candidateIds.map(id=>`<option value="${escapeHtml(id)}">${escapeHtml(candidateLabel(id))}</option>`).join('')}</select></label></div>`).join('');
  return `${input}${manualLabel}${selectors}`;
}
function renderRows(){
  const body=$('#reviewTable tbody');
  body.innerHTML=project.rows.map((r,i)=>`<tr data-row-id="${escapeHtml(r.id)}" class="${r.personIdentityIssues?.length?'identity-needs-review':''}"><td><input type="checkbox" data-select-row="${escapeHtml(r.id)}" ${selectedRows.has(r.id)?'checked':''} aria-label="Select row ${i+1}"></td>${FIELDS.map(f=>`<td>${rowInput(r,i,f)}</td>`).join('')}<td><button class="row-delete" data-delete-row="${i}" title="Delete">×</button></td></tr>`).join('');
  renderedIdentitySignature=identityIssueSignature();
  $('#rowCount').textContent=`${project.rows.length} rows`;
  body.querySelectorAll('[data-select-row]').forEach(el=>el.addEventListener('change',()=>{if(el.checked)selectedRows.add(el.dataset.selectRow);else selectedRows.delete(el.dataset.selectRow);updateSelectedCount();}));
  body.querySelectorAll('[data-row]').forEach(el=>el.addEventListener('input',()=>{const r=project.rows[Number(el.dataset.row)],field=el.dataset.field,oldValue=r[field];if(['speaker','chair','author'].includes(field)&&oldValue!==el.value)reconcileAppearanceNames(r,field,oldValue,el.value);r[field]=el.value;r.manualFields={...(r.manualFields||{}),[field]:true};if(['date','start','end','title','location','session'].includes(field)&&String(oldValue??'')!==String(el.value??''))r.sequence=Number(r.sequence||0)+1;scheduleSave();renderDerivedDebounced();}));
  body.querySelectorAll('[data-person-identity]').forEach(el=>el.addEventListener('change',async()=>{const role=el.dataset.personRole,index=Number(el.dataset.personIndex),rowId=el.dataset.rowId,personId=el.value,field={speaker:'speakerEntityIds',chair:'chairEntityIds',author:'authorEntityIds'}[role];if(!personId||!field)return;const next=structuredClone(project),target=next.rows.find(item=>item.id===rowId);if(!target)return;target[field]=[...(target[field]||[])];target[field][index]=personId;target.personIdentityAssignments||={};target.personIdentityAssignments[role]||={};target.personIdentityAssignments[role][index]={personId,status:'confirmed'};target.personIdentityIssues=(target.personIdentityIssues||[]).filter(issue=>issue.role!==role||issue.index!==index);target.personIdentityConflict=target.personIdentityIssues.length>0;target.personIdentityResolved=!target.personIdentityConflict;try{validateBuilderProjectStructure(next);await buildPackage(next);await persistIdentityProject(next,{assignmentCheck:{rowId,role,index,personId}});await renderDerived();toast('Programme person assignment saved');}catch(error){setSaveStatus('Person assignment was not saved; the previous project remains intact.',true);toast(error.message||'Could not save the programme person assignment');renderRows();}}));
  body.querySelectorAll('[data-delete-row]').forEach(btn=>btn.addEventListener('click',()=>{const idx=Number(btn.dataset.deleteRow),row=project.rows[idx];if(row?.source?.id)project.deletedSourceIds=[...new Set([...(project.deletedSourceIds||[]),row.source.id])];if(row?.id)selectedRows.delete(row.id);project.rows.splice(idx,1);scheduleSave();renderRows();renderDerived();}));
  updateSelectedCount();
}

let deriveTimer=null;function renderDerivedDebounced(){clearTimeout(deriveTimer);deriveTimer=setTimeout(()=>{deriveTimer=null;renderDerived();},150);}
let previewPayload=null,previewSignature='';
function setPreviewStatus(state){const el=$('#previewStatus');if(!el)return;el.dataset.state=state;el.textContent=state==='ready'?'Up to date':state==='failed'?'Failed to load preview. Review the project and try Refresh preview.':'Loading preview…';}
function waitForPreviewAssets(){return pendingPreviewAssets?new Promise(resolve=>assetIdleResolvers.push(resolve)):Promise.resolve();}
function finishPreviewAssetRead(){pendingPreviewAssets--;if(pendingPreviewAssets)return;const waiting=assetIdleResolvers.splice(0);for(const resolve of waiting)resolve();if(!waiting.length)renderDerived();}
async function refreshPreview({force=true}={}){
  if(force)previewForceRequested=true;
  previewRequestRevision++;
  if(activeStep===8)setPreviewStatus('loading');
  clearTimeout(deriveTimer);deriveTimer=null;
  await waitForPreviewAssets();
  return renderDerived();
}
function previewAsset(asset){if(!asset?.bytes)return '';const url=URL.createObjectURL(new Blob([asset.bytes],{type:asset.type||'image/png'}));previewAssets.push(url);return url;}
function assetContentKey(asset){if(!asset?.bytes)return '';let a=2166136261,b=0x9e3779b9;for(const byte of asset.bytes){a=Math.imul(a^byte,16777619);b=Math.imul(b+byte,2246822519);}return(a>>>0).toString(16)+':'+(b>>>0).toString(16)+':'+asset.bytes.length;}
function queuePreview(){
  clearTimeout(previewTimer);
  if(activeStep!==8||!latestPackage||pendingPreviewAssets||renderRevision!==appliedRevision)return;
  setPreviewStatus('loading');
  previewTimer=setTimeout(()=>{
    previewTimer=null;
    if(pendingPreviewAssets||renderRevision!==appliedRevision)return;
    const signature=JSON.stringify([latestPackage.conference,latestPackage.programme,latestPackage.people,latestPackage.locations,latestPackage.branding,assetContentKey(project.logo),assetContentKey(project.logoLight),assetContentKey(project.logoDark),assetContentKey(project.appIcon),(project.sponsorFiles||[]).map(x=>[x.name,x.height,assetContentKey(x.light||x),assetContentKey(x.dark)]),Object.entries(project.peoplePhotos||{}).map(([id,x])=>[id,assetContentKey(x)])]);
    if(!previewForceRequested&&signature===previewSignature&&$('#attendeePreview').getAttribute('src')&&$('#previewStatus').dataset.state!=='failed'){
      if($('#attendeePreview').contentWindow?.CONFERENCE_APP_INITIALIZED===true&&$('#attendeePreview').contentWindow?.CONFERENCE_PACKAGE?.conference?.id===`${previewIdentity}-${previewGeneration}`)setPreviewStatus('ready');
      return;
    }
    previewForceRequested=false;
    previewSignature=signature;
    const generation=++previewGeneration;
    previewLaunchedRequestRevision=previewRequestRevision;
    for(const url of previewAssets)URL.revokeObjectURL(url);previewAssets=[];
    const pkg=structuredClone(latestPackage);
    // The real attendee runtime is used, but all its personal storage keys
    // belong to this disposable Builder preview identity.
    pkg.conference.id=`${previewIdentity}-${generation}`;
    const logoLight=project.logoLight?.bytes?project.logoLight:project.logo;
    const logoDark=project.logoDark?.bytes?project.logoDark:logoLight;
    pkg.branding.logoLight=previewAsset(logoLight)||pkg.branding.logoLight;
    pkg.branding.logoDark=previewAsset(logoDark)||pkg.branding.logoDark||pkg.branding.logoLight;
    pkg.branding.logo=pkg.branding.logoLight||pkg.branding.logo;
    pkg.branding.previewAppearance=project.branding.previewAppearance||'light';
    pkg.branding.sponsorLogos=normalizeSponsorFiles(project.sponsorFiles||[]).map(item=>({name:item.name,height:item.height,light:previewAsset(item.light)||null,dark:previewAsset(item.dark)||null}));
    pkg.branding.sponsorAssets=pkg.branding.sponsorLogos.map(item=>item.light||item.dark).filter(Boolean);
    for(const person of pkg.people.people||[])if(project.peoplePhotos?.[person.id])person.photoUrl=previewAsset(project.peoplePhotos[person.id]);
    previewPayload=pkg;
    const frame=$('#attendeePreview');
    clearTimeout(previewStatusTimer);
    previewStatusTimer=setTimeout(()=>{if(generation===previewGeneration&&previewLaunchedRequestRevision===previewRequestRevision)setPreviewStatus('failed');},12000);
    frame.src=`./index.html?builderPreview=1&revision=${generation}`;
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
  $('#refreshPreview').addEventListener('click',()=>refreshPreview());
  $('#previewSize').addEventListener('change',event=>{$('#attendeePreview').style.width=`${event.target.value}px`;});
  for(const id of ['previewDate','previewRoom'])$('#'+id).addEventListener('change',applyPreviewNavigation);
  $('#previewAppearance').value=project.branding.previewAppearance||'light';
  $('#previewAppearance').addEventListener('change',event=>{project.branding.previewAppearance=event.target.value;$('#brandingPreviewAppearance').value=event.target.value;scheduleSave();updateBrandingPreviews();refreshPreview();});
  const frame=$('#attendeePreview');
  const watch=()=>{
    const generation=previewGeneration;
    const check=()=>{
      if(generation!==previewGeneration||previewLaunchedRequestRevision!==previewRequestRevision||previewTimer||renderRevision!==appliedRevision||$('#previewStatus').dataset.state!=='loading')return;
      const doc=frame.contentDocument;
      if(doc?.URL.includes(`revision=${generation}`)&&frame.contentWindow?.CONFERENCE_APP_INITIALIZED===true&&frame.contentWindow?.CONFERENCE_PACKAGE?.conference?.id===`${previewIdentity}-${generation}`){
        clearTimeout(previewStatusTimer);applyPreviewNavigation();setPreviewStatus('ready');return;
      }
      if(doc?.URL.includes(`revision=${generation}`)&&doc.querySelector('main h1')?.textContent==='Conference app could not start'){
        clearTimeout(previewStatusTimer);setPreviewStatus('failed');return;
      }
      setTimeout(check,80);
    };check();
  };
  frame.addEventListener('load',()=>{if(!frame.contentDocument?.URL.includes(`revision=${previewGeneration}`))return;if(previewPayload)frame.contentWindow.postMessage({type:'conference-builder-preview',pkg:previewPayload},location.origin);watch();});
  window.addEventListener('message',event=>{
    if(event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.type!=='conference-builder-preview-ready'||!previewPayload||!frame.contentDocument?.URL.includes(`revision=${previewGeneration}`))return;
    event.source.postMessage({type:'conference-builder-preview',pkg:previewPayload},location.origin);
    watch();
  });
}
function updatePreviewControls(pkg){
  const dates=[...new Set((pkg.programme.sessions||[]).map(s=>s.date).filter(Boolean))].sort(),rooms=pkg.locations.locations.filter(l=>l.type==='room');
  const date=$('#previewDate'),room=$('#previewRoom'),selectedDate=date.value,selectedRoom=room.value;
  date.innerHTML=dates.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');if(dates.includes(selectedDate))date.value=selectedDate;
  room.innerHTML='<option value="">All rooms</option>'+rooms.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');if(rooms.some(l=>l.id===selectedRoom))room.value=selectedRoom;
  $('#previewAppearance').value=project.branding.previewAppearance||'light';
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
  const people=pkg.people.people||[],allGroups=identityReviewGroups(project,people,{includeResolved:true}),reviewGroups=allGroups.filter(group=>group.unresolved),duplicateIds=new Set(reviewGroups.flatMap(group=>group.candidates.map(p=>p.id)));
  const stats=project.identityStats||{};$('#identityStats').textContent=`${stats.automaticallyConsolidated||0} appearances linked automatically · ${reviewGroups.length} identity groups need organizer review.`;
  const {roles,entries}=personRoles(pkg),search=$('#peopleSearch').value.trim().toLocaleLowerCase(),role=$('#peopleRole').value;
  const visible=people.filter(p=>`${p.name} ${(p.affiliations||[]).join(' ')}`.toLocaleLowerCase().includes(search)&&
    (role==='all'||roles.get(p.id)?.has(role[0].toUpperCase()+role.slice(1)))).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const signature=JSON.stringify([visible.map(p=>[p.id,p.name,p.affiliations,[...(roles.get(p.id)||[])],entries.get(p.id)?.size,duplicateIds.has(p.id)]),search,role]);
  if(signature!==peopleListSignature){
    $('#peoplePreview').innerHTML=visible.map(p=>`<button type="button" class="person-row" data-open-person="${escapeHtml(p.id)}" aria-label="Edit ${escapeHtml(p.name)}"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml((p.affiliations||[]).join('; ')||'Affiliation not specified')}</span><span>${escapeHtml([...(roles.get(p.id)||[])].join(' · ')||'No programme role')} · ${entries.get(p.id)?.size||0} entries</span>${duplicateIds.has(p.id)?'<span class="duplicate-badge">Review match</span>':'<span aria-hidden="true">›</span>'}</button>`).join('')||'<p class="muted">No people match these filters.</p>';
    peopleListSignature=signature;
  }
  $('#duplicateCount').textContent=reviewGroups.length?`(${reviewGroups.length})`:'';
  if(reviewGroups.length)$('#duplicateReview').hidden=false;
  if(!$('#duplicateReview').hidden)renderDuplicateReview(allGroups);
}
function openPersonEditor(id){
  const person=latestPackage?.people.people.find(p=>p.id===id);if(!person)return;
  openPersonId=id;const asset=project.peoplePhotos?.[id],extra=(project.extraPeople||[]).some(x=>x.id===id);
  const input=(field,label,type='text',value=person[field]||'')=>`<label>${label}<input data-edit-field="${field}" type="${type}" value="${escapeHtml(value)}"></label>`;
  $('#personEditor').innerHTML=`<form id="personEditForm"><h3>Edit ${escapeHtml(person.name)}</h3><p class="muted">Person ID: ${escapeHtml(id)}</p><div class="entity-editor-grid">${input('name','Name')}${input('affiliation','Affiliation(s), separated by semicolons','text',(person.affiliations||[]).join('; '))}</div><details><summary>Additional details</summary><div class="entity-editor-grid">${input('position','Position')}${input('publicEmail','Public email','email')}${input('orcid','ORCID')}${input('website','Website','url',(person.links||[]).find(x=>x.label==='Website')?.url||'')}${input('photoUrl','Photo URL or asset path')}<label>Upload profile photograph<input id="personPhotoDraft" type="file" accept="image/png,image/jpeg,image/webp"><span class="muted">${escapeHtml(asset?.name||'No uploaded photograph')}</span></label></div></details><div class="person-editor-actions"><button class="primary-btn" type="submit">Save person</button><button class="secondary-btn" type="button" id="cancelPersonEdit">Cancel</button>${extra?'<button class="secondary-btn" type="button" id="removeExtraPerson">Delete added person</button>':''}</div></form>`;
  $('#personEditor').hidden=false;$('#personEditor').scrollIntoView({block:'nearest'});$('#personEditor [data-edit-field="name"]').focus();
}
const duplicateGroupKey=group=>JSON.stringify(group.candidates.map(person=>person.id).sort());
function personSourceContext(row){
  const source=row.source||{},references=[source.fileId,source.sourceId,...(source.contributors||[]),...(source.sources||[]),...(source.sourceRecords||[]),...(row.sources||[]),row.sourceFileId,row.fileId,source.id].filter(Boolean),ids=references.map(item=>typeof item==='string'?item:item.fileId||item.sourceId||item.id||'').filter(Boolean);
  const names=[...new Set(ids)].map(id=>project.sourceFiles?.find(item=>item.id===id||item.legacyId===id||item.fileId===id)?.name||id);
  if(source.row)return `${names.join(', ')||'source file'} · row ${source.row}${source.sheet?` · ${source.sheet}`:''}`;
  if(source.page)return `${names.join(', ')||'source file'} · page ${source.page}`;
  return names.join(', ')||'manual or restored record';
}
function personAppearances(group,person){
  return group.appearances.filter(item=>item.ids?.includes(person.id)||item.row.speakerEntityIds?.includes(person.id)||item.row.chairEntityIds?.includes(person.id)||item.row.authorEntityIds?.includes(person.id));
}
function renderDuplicateReview(groups){
  for(const url of duplicatePhotoUrls)URL.revokeObjectURL(url);duplicatePhotoUrls=[];
  const allKeys=new Set(groups.map(duplicateGroupKey));for(const key of duplicateSelections.keys())if(!allKeys.has(key))duplicateSelections.delete(key);
  const groupHtml=groups.map(group=>{
    const key=duplicateGroupKey(group),selected=duplicateSelections.get(key)||[],primary=selected[0]||'';
    const cards=group.candidates.map(person=>{
      const appearances=personAppearances(group,person),checked=selected.includes(person.id),isPrimary=person.id===primary;
      const photo=project.peoplePhotos?.[person.id];let photoMarkup='';
      if(photo?.bytes){const url=URL.createObjectURL(new Blob([photo.bytes],{type:photo.type||'image/png'}));duplicatePhotoUrls.push(url);photoMarkup=`<img class="duplicate-profile-photo" src="${escapeHtml(url)}" alt="Profile photograph of ${escapeHtml(person.name)}">`;}
      else if(person.photoUrl)photoMarkup=`<p class="duplicate-photo-note">${escapeHtml(photo?.name||'Profile photograph available')}</p>`;
      return `<article class="duplicate-profile ${isPrimary?'is-primary':''} ${checked&&!isPrimary?'is-merge-target':''}" data-profile-id="${escapeHtml(person.id)}"><label class="duplicate-profile-select"><input type="checkbox" data-merge-profile value="${escapeHtml(person.id)}" ${checked?'checked':''}><span><strong>${escapeHtml(person.name)}</strong><span class="duplicate-profile-affiliation">${escapeHtml((person.affiliations||[]).join('; ')||'Affiliation unknown')}</span></span>${isPrimary?'<b class="primary-profile-badge">Primary</b>':''}</label>${photoMarkup}<div class="duplicate-profile-meta">${person.position?`<p><strong>Position:</strong> ${escapeHtml(person.position)}</p>`:''}${person.publicEmail?`<p><strong>Email:</strong> ${escapeHtml(person.publicEmail)}</p>`:''}${person.orcid?`<p><strong>ORCID:</strong> ${escapeHtml(person.orcid)}</p>`:''}${(person.links||[]).map(link=>`<p><strong>${escapeHtml(link.label||'Link')}:</strong> ${escapeHtml(link.url||'')}</p>`).join('')}</div><h5>Programme appearances</h5><ul>${appearances.map(item=>`<li><strong>${escapeHtml(item.role)}:</strong> ${escapeHtml(item.row.title||item.row.session||'Untitled programme item')} · ${escapeHtml(item.row.session||'Session not specified')} · ${escapeHtml(item.row.date||'Date unknown')} ${escapeHtml(item.row.start||'')}${item.row.end?`–${escapeHtml(item.row.end)}`:''} · ${escapeHtml(item.row.location||'Room unknown')}${item.row.track?` · ${escapeHtml(item.row.track)}`:''} · ${escapeHtml(personSourceContext(item.row))}</li>`).join('')||'<li>No linked programme appearances.</li>'}</ul></article>`;
    }).join('');
    const selectedProfiles=selected.map(id=>group.candidates.find(person=>person.id===id)).filter(Boolean),survivor=selectedProfiles[0];
    const selectionSummary=selectedProfiles.length?`${selectedProfiles.length} selected · primary: ${survivor.name} (${(survivor.affiliations||[]).join('; ')||'Affiliation unknown'})`:'No profiles selected. The first profile you check becomes primary.';
    const pairs=group.pairDecisions.filter(pair=>pair.decision==='different').map(pair=>[group.candidates.find(person=>person.id===pair.firstId),group.candidates.find(person=>person.id===pair.secondId)]);
    const distinctDecisions=pairs.map(([first,second])=>`<li>${escapeHtml(first.name)} — ${escapeHtml((first.affiliations||[]).join('; ')||'Affiliation unknown')} and ${escapeHtml(second.name)} — ${escapeHtml((second.affiliations||[]).join('; ')||'Affiliation unknown')} <button class="text-btn" type="button" data-reopen-pair="${escapeHtml(JSON.stringify([first.id,second.id]))}">Reopen this decision</button></li>`).join('');
    const stateLabel=group.status==='confirmed-different'?'Confirmed different people':group.unresolved?'Needs review':'Resolved';
    return `<section class="duplicate-group" data-duplicate-group="${escapeHtml(key)}" data-unresolved="${group.unresolved}"><header class="duplicate-group-heading"><div><h3>${escapeHtml(group.name)} · ${group.candidates.length} possible profiles</h3><p class="muted">Compare affiliations and programme context. Similar names or schedules are clues, not proof.</p></div><span class="identity-state ${group.unresolved?'needs-review':'resolved'}">${stateLabel}</span></header><div class="merge-grid">${cards}</div><div class="duplicate-selection-controls"><p data-selection-summary aria-live="polite">${escapeHtml(selectionSummary)}</p><div class="duplicate-selection-actions"><button class="secondary-btn" type="button" data-clear-selection ${selected.length?'':'disabled'}>Clear selection</button><button class="secondary-btn" type="button" data-mark-different ${selected.length>=2?'':'disabled'}>Mark selected as different people</button><button class="primary-btn" type="button" data-merge-selected ${selected.length>=2?'':'disabled'}>${selected.length>=2?`Merge ${selected.length} selected → Keep ${escapeHtml(survivor.name)} (${escapeHtml((survivor.affiliations||[]).join('; ')||'Affiliation unknown')})`:'Select at least two profiles to merge'}</button></div></div>${distinctDecisions?`<details class="confirmed-distinct"><summary>${pairs.length} confirmed different-person decision${pairs.length===1?'':'s'}</summary><ul>${distinctDecisions}</ul></details>`:''}</section>`;
  }).join('');
  const merged=(project.personMergeHistory||[]).slice(-12).reverse().map(item=>`<li><span class="identity-state merged">Merged</span> ${escapeHtml(item.removedName||'Profile')} into ${escapeHtml(item.keptName||'the selected primary profile')}</li>`).join('');
  $('#duplicateReview').innerHTML=`<h3>Review possible duplicates</h3><p class="muted">Check the profiles you want to combine. The first checked profile survives; selections and decisions are saved independently for each name group.</p>${groupHtml||'<p class="muted">No possible duplicate profiles are currently available.</p>'}${merged?`<details class="merge-history"><summary>Recently merged profiles</summary><ul>${merged}</ul></details>`:''}`;
}
function duplicateFieldValue(person,field){return field==='website'?(person.links||[]).find(link=>link.label==='Website')?.url||person.website||'':person[field]||'';}
function selectedGroupProfiles(groupElement){const groupKey=groupElement.dataset.duplicateGroup;return duplicateSelections.get(groupKey)||[];}
function updateDuplicateSelection(groupElement){
  const groupKey=groupElement.dataset.duplicateGroup,selected=selectedGroupProfiles(groupElement),primaryId=selected[0],people=latestPackage?.people.people||[],primary=people.find(person=>person.id===primaryId);
  for(const card of groupElement.querySelectorAll('[data-profile-id]')){const id=card.dataset.profileId,isSelected=selected.includes(id),isPrimary=id===primaryId;card.classList.toggle('is-primary',isPrimary);card.classList.toggle('is-merge-target',isSelected&&!isPrimary);card.querySelector('.primary-profile-badge')?.remove();if(isPrimary){const badge=document.createElement('b');badge.className='primary-profile-badge';badge.textContent='Primary';card.querySelector('.duplicate-profile-select')?.append(badge);}}
  groupElement.querySelector('[data-selection-summary]').textContent=primary?`${selected.length} selected · primary: ${primary.name} (${(primary.affiliations||[]).join('; ')||'Affiliation unknown'})`:'No profiles selected. The first profile you check becomes primary.';
  const clear=groupElement.querySelector('[data-clear-selection]'),different=groupElement.querySelector('[data-mark-different]'),merge=groupElement.querySelector('[data-merge-selected]');clear.disabled=selected.length===0;different.disabled=selected.length<2;merge.disabled=selected.length<2;merge.textContent=selected.length>=2?`Merge ${selected.length} selected → Keep ${primary.name} (${(primary.affiliations||[]).join('; ')||'Affiliation unknown'})`:'Select at least two profiles to merge';
}
function renderPersonMergePreview(groupElement){
  const ids=selectedGroupProfiles(groupElement),groupKey=groupElement.dataset.duplicateGroup,people=latestPackage?.people.people||[],profiles=ids.map(id=>people.find(person=>person.id===id)).filter(Boolean),primary=profiles[0];
  if(profiles.length<2||profiles.length!==ids.length)throw new Error('Select at least two current profiles in this duplicate group');
  mergePersonProfilesMany(project,people,ids); // Fail early when the group contains a confirmed different-person pair.
  const fields=[['position','Position'],['publicEmail','Public email'],['orcid','ORCID'],['website','Website'],['photoUrl','Profile photo']];
  const conflictChoices=fields.map(([field,label])=>{
    const available=profiles.map(person=>({person,value:duplicateFieldValue(person,field)})).filter(item=>item.value),distinct=[...new Set(available.map(item=>String(item.value).trim().toLocaleLowerCase()))];
    if(distinct.length<2)return '';
    const preferred=available.find(item=>item.person.id===primary.id)||available[0];
    return `<label class="merge-field-choice">${escapeHtml(label)} differs between profiles<select data-merge-field="${field}">${available.map(item=>`<option value="${escapeHtml(item.person.id)}" ${item.person.id===preferred.person.id?'selected':''}>${escapeHtml(item.person.name)} — ${escapeHtml((item.person.affiliations||[]).join('; ')||'Affiliation unknown')} · ${escapeHtml(item.value)}</option>`).join('')}</select></label>`;
  }).filter(Boolean).join('');
  const removed=ids.slice(1),references=(project.rows||[]).reduce((sum,row)=>sum+['speakerEntityIds','chairEntityIds','authorEntityIds','personEntityIds'].reduce((n,field)=>n+(row[field]||[]).filter(id=>removed.includes(id)).length,0),0);
  const dialog=$('#personMergeDialog');pendingPersonMerge={groupKey,ids};
  $('#personMergePreview').innerHTML=`<h3>Merge ${profiles.length} profiles</h3><section class="merge-preview-primary"><h4>Primary profile</h4><p><strong>${escapeHtml(primary.name)}</strong> — ${escapeHtml((primary.affiliations||[]).join('; ')||'Affiliation unknown')}</p></section><section><h4>Profiles to merge</h4><ul>${profiles.slice(1).map(person=>`<li>${escapeHtml(person.name)} — ${escapeHtml((person.affiliations||[]).join('; ')||'Affiliation unknown')}</li>`).join('')}</ul></section><section class="merge-expected-result"><h4>Expected result</h4><ul><li>${profiles.length} profiles become 1; ${removed.length} redundant profiles are removed.</li><li>${references} programme references transfer to the primary identity.</li><li>Affiliations, associated papers, and role assignments are consolidated.</li><li>Uploaded photographs and existing metadata are preserved; the primary profile is preferred when a field is already populated.</li></ul></section>${conflictChoices?`<section class="merge-conflicting-fields"><h4>Choose values for conflicting fields</h4><p>Pick which selected profile supplies each single-value field. Other profile details remain available in this Builder project.</p>${conflictChoices}</section>`:''}`;
  dialog.showModal();
}
async function persistIdentityProject(next,{removedIds=[],expectedPrimaryId='',decisionCount=0,assignmentCheck=null}={}){
  const previous=structuredClone(project);let saved=false;
  try{
    validateBuilderProjectStructure(next);await buildPackage(next);
    clearTimeout(saveTimer);saveRevision++;await pendingSave.catch(()=>{});
    await saveProject(next);saved=true;
    const persisted=await loadProject();if(!persisted)throw new Error('The saved identity changes could not be read back from IndexedDB');
    if(decisionCount)for(const [pair,value] of Object.entries(next.identityDecisions?.pairs||{}))if(value!==persisted.identityDecisions?.pairs?.[pair])throw new Error('The identity decision did not persist correctly');
    if(assignmentCheck){const row=persisted.rows?.find(item=>item.id===assignmentCheck.rowId),field={speaker:'speakerEntityIds',chair:'chairEntityIds',author:'authorEntityIds'}[assignmentCheck.role];if(row?.[field]?.[assignmentCheck.index]!==assignmentCheck.personId||row?.personIdentityAssignments?.[assignmentCheck.role]?.[assignmentCheck.index]?.status!=='confirmed')throw new Error('The programme person assignment did not persist correctly');}
    const rebuilt=await buildPackage(persisted),remaining=new Set((rebuilt.pkg.people.people||[]).map(person=>person.id));
    if(removedIds.some(id=>remaining.has(id)))throw new Error('A merged profile still appears in the rebuilt people directory');
    if(expectedPrimaryId&&!remaining.has(expectedPrimaryId))throw new Error('The selected primary profile is missing from the rebuilt people directory');
    for(const row of persisted.rows||[])for(const field of ['speakerEntityIds','chairEntityIds','authorEntityIds','personEntityIds'])if((row[field]||[]).some(id=>removedIds.includes(id)))throw new Error('A programme entry still refers to a merged profile');
    if(assignmentCheck&&persisted.rows.find(item=>item.id===assignmentCheck.rowId)?.personIdentityIssues?.some(issue=>issue.role===assignmentCheck.role&&issue.index===assignmentCheck.index))throw new Error('The rebuilt programme still marks this assignment as ambiguous');
    project=next;openPersonId='';$('#personEditor').hidden=true;peopleListSignature='';
    return {rebuilt,referenceCount:decisionCount};
  }catch(error){
    if(saved){try{await saveProject(previous);}catch(restoreError){throw new Error(`Identity save verification failed (${error.message}); restoring the previous project also failed (${restoreError.message})`);}}
    throw error;
  }
}
async function confirmPersonMerge(){
  if(!pendingPersonMerge)return;
  const {ids,groupKey}=pendingPersonMerge,people=latestPackage?.people.people||[],choices=Object.fromEntries([...$('#personMergePreview').querySelectorAll('[data-merge-field]')].map(select=>[select.dataset.mergeField,select.value]));
  let next;try{next=mergePersonProfilesMany(project,people,ids,choices);validateBuilderProjectStructure(next);await buildPackage(next);}catch(error){toast(error.message||'These profiles cannot be merged');return;}
  const removedIds=ids.slice(1),referenceCount=(project.rows||[]).reduce((sum,row)=>sum+['speakerEntityIds','chairEntityIds','authorEntityIds','personEntityIds'].reduce((n,field)=>n+(row[field]||[]).filter(id=>removedIds.includes(id)).length,0),0);
  try{await persistIdentityProject(next,{removedIds,expectedPrimaryId:ids[0],decisionCount:referenceCount});duplicateSelections.delete(groupKey);pendingPersonMerge=null;$('#personMergeDialog').close();await renderDerived();toast(`${removedIds.length} profiles merged · ${referenceCount} programme references updated`);}catch(error){setSaveStatus('Identity merge was not saved; the previous project remains intact.',true);toast(error.message||'Could not save the profile merge');}
}
async function savePersonIdentityDecision(ids,decision){
  try{const next=applyPersonIdentityDecision(project,latestPackage?.people.people||[],ids,decision),pairs=ids.length*(ids.length-1)/2;await persistIdentityProject(next,{decisionCount:pairs});await renderDerived();if(!$('#duplicateReview').hidden&&latestPackage)renderDuplicateReview(identityReviewGroups(project,latestPackage.people.people,{includeResolved:true}));const pending=(project.rows||[]).reduce((count,row)=>count+(row.personIdentityIssues||[]).length,0);toast(decision==='different'?`${ids.length} profiles confirmed as different people${pending?`. ${pending} programme ${pending===1?'appearance still needs a person assignment':'appearances still need person assignments'}`:''}`:'Selected identity decisions reopened for review');}
  catch(error){setSaveStatus('Identity decisions were not saved; the previous project remains intact.',true);toast(error.message||'Could not save identity decisions');}
}
function initPeopleUi(){
  $('#peopleSearch').addEventListener('input',()=>{peopleListSignature='';if(latestPackage)renderPeopleDirectory(latestPackage);});
  $('#peopleRole').addEventListener('change',()=>{peopleListSignature='';if(latestPackage)renderPeopleDirectory(latestPackage);});
  $('#peoplePreview').addEventListener('click',event=>{const button=event.target.closest('[data-open-person]');if(button)openPersonEditor(button.dataset.openPerson);});
  $('#reviewDuplicates').addEventListener('click',()=>{const panel=$('#duplicateReview');panel.hidden=!panel.hidden;if(!panel.hidden&&latestPackage)renderDuplicateReview(identityReviewGroups(project,latestPackage.people.people,{includeResolved:true}));});
  $('#duplicateReview').addEventListener('change',event=>{
    const checkbox=event.target.closest('[data-merge-profile]');if(!checkbox)return;
    const groupElement=checkbox.closest('[data-duplicate-group]'),key=groupElement.dataset.duplicateGroup,current=duplicateSelections.get(key)||[];
    duplicateSelections.set(key,checkbox.checked?[...current.filter(id=>id!==checkbox.value),checkbox.value]:current.filter(id=>id!==checkbox.value));updateDuplicateSelection(groupElement);
  });
  $('#duplicateReview').addEventListener('click',event=>{
    const groupElement=event.target.closest('[data-duplicate-group]');if(!groupElement)return;
    if(event.target.closest('[data-clear-selection]')){duplicateSelections.set(groupElement.dataset.duplicateGroup,[]);groupElement.querySelectorAll('[data-merge-profile]').forEach(box=>box.checked=false);updateDuplicateSelection(groupElement);return;}
    if(event.target.closest('[data-merge-selected]')){try{renderPersonMergePreview(groupElement);}catch(error){toast(error.message);}return;}
    if(event.target.closest('[data-mark-different]')){const ids=selectedGroupProfiles(groupElement);if(ids.length<2)return;savePersonIdentityDecision(ids,'different');return;}
    const reopen=event.target.closest('[data-reopen-pair]');if(reopen){savePersonIdentityDecision(JSON.parse(reopen.dataset.reopenPair),'unresolved');}
  });
  $('#personMergeCancel').addEventListener('click',()=>{pendingPersonMerge=null;$('#personMergeDialog').close();});
  $('#personMergeDialog').addEventListener('cancel',()=>{pendingPersonMerge=null;});
  $('#personMergeConfirm').addEventListener('click',confirmPersonMerge);
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
  previewRequestRevision++;
  if(activeStep===6)updateBrandingPreviews();
  if(activeStep===8)setPreviewStatus('loading');
  let result;
  try{result=await buildPackage(project);}catch(error){if(revision===renderRevision){console.error(error);setPreviewStatus('failed');toast(error?.message||'Could not build preview');}return;}
  if(revision!==renderRevision)return;appliedRevision=revision;scheduleSave();const {pkg,report}=result;if(project.reimportConflicts?.length)report.warnings.push(...project.reimportConflicts);if(identityIssueSignature()!==renderedIdentitySignature)renderRows();
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
function renderReport(report){const el=$('#validationReport');if(!report.errors.length&&!report.warnings.length){el.innerHTML='<div class="validation-ok">Validation passed. Package is structurally ready to publish.</div>';return;}const issue=(message,severity)=>{const described=describeValidationMessage(message,latestPackage,project),target=described.target,step=target?.type==='person'?4:target?.type==='location'?5:target?3:errorStep(message);return `<div class="validation-${severity}">${escapeHtml(described.text)} <button class="secondary-btn" type="button" data-error-step="${step}" ${target?`data-target-type="${target.type}" data-target-id="${escapeHtml(target.id)}" ${target.role?`data-target-role="${target.role}" data-target-index="${target.index}"`:''}`:''}>${target?.type==='identity-assignment'?'Review assignment':`Go to ${escapeHtml(target?'record':STEP_NAMES[step-1])}`}</button></div>`;};const unique=(messages)=>[...new Set(messages)];el.innerHTML=[...unique(report.errors).map(x=>issue(x,'error')),...unique(report.warnings).map(x=>issue(x,'warning'))].join('');}

async function loadXlsxWorksheet(sheetName,importToken=importRevision){
  if(!pendingXlsxFile)return;
  const revision=++worksheetRevision,file=pendingXlsxFile,sourceId=pendingXlsxSourceId,status=$('#importStatus');worksheetLoading=true;status.textContent=`Loading worksheet ${sheetName}…`;
  const rows=await importXlsx(file,sheetName);
  if(revision!==worksheetRevision||importToken!==importRevision||file!==pendingXlsxFile)return;
  const staged=rows.map(row=>({...row,__sourceFileId:sourceId}));rawRows=staged;
  loadedWorksheetName=sheetName;worksheetLoading=false;
  rawHeaders=Object.keys(staged[0]||{}).filter(x=>!x.startsWith('__'));
  showMapping(guessMapping(rawHeaders));
  status.textContent=`${rawRows.length} rows loaded from ${sheetName}; apply mapping to save`;
}

function showPdfReview(analysis){
  pendingPdfAnalysis=analysis;const root=$('#pdfReview');root.hidden=false;const rows=[...analysis.confident,...analysis.needsReview];
  const rowCard=(row,index)=>`<article class="pdf-entry" data-pdf-entry="${index}"><label class="pdf-entry-select"><input type="checkbox" data-pdf-include ${analysis.confident.includes(row)?'checked':''}> Include this entry</label><span class="confidence-badge" data-confidence="${row.importConfidence>=0.7?'high':'review'}">${row.source.extraction==='ocr'?'OCR-derived':'Native PDF text'} · ${Math.round(row.importConfidence*100)}% · page ${row.source.page}, line ${row.source.line}</span><div class="pdf-entry-grid">${['date','start','end','type','session','title','speaker','chair','affiliation','location','track','posterNumber'].map(field=>`<label>${escapeHtml(LABELS[field]||field)}<input data-pdf-field="${field}" value="${escapeHtml(row[field]||'')}"></label>`).join('')}</div><p class="muted">${escapeHtml((row.importWarnings||[]).join(' '))}</p></article>`;
  const text=analysis.unrecognized.map((item,index)=>`<article class="pdf-unrecognized"><label><input type="checkbox" data-pdf-convert="${index}"> Convert to programme draft</label><span>Page ${item.page}, column ${item.column+1}, line ${item.line} · ${item.extraction==='ocr'?'OCR':'native text'} · not automatically treated as an event</span><p>${escapeHtml(item.text)}</p><label>Draft title<input data-pdf-unrecognized-title="${index}" value="${escapeHtml(item.text)}"></label></article>`).join('');
  const confident=analysis.confident.map(row=>rowCard(row,rows.indexOf(row))).join('');
  const needsReview=analysis.needsReview.map(row=>rowCard(row,rows.indexOf(row))).join('');
  const q=analysis.quality,large=analysis.needsReview.length>100||analysis.unrecognized.length>250;
  root.innerHTML=`<h3>PDF extraction review</h3><p class="muted">${q.pages} pages · ${q.extraction} extraction · ${q.ocrPages} OCR pages · ${rows.length} anchored entries (${analysis.confident.length} higher confidence, ${analysis.needsReview.length} need review) · ${q.unrecognizedCount} other text lines. Nothing has been added to the programme.</p>${q.failedPages?`<p class="import-warning">OCR failed on ${q.failedPages} page${q.failedPages===1?'':'s'}; review native text or enter missing information manually.</p>`:''}${large?'<p class="import-warning">This extraction contains unusually many uncertain entries or text lines. Review the extracted content and confirm below before proceeding.</p>':''}<section aria-labelledby="pdf-confident-heading"><h4 id="pdf-confident-heading">Confidently recognized (${analysis.confident.length})</h4><div class="pdf-entry-list">${confident||'<p>No entries meet the confidence threshold. Nothing will be preselected.</p>'}</div></section><details ${analysis.needsReview.length?'':'hidden'}><summary>Needs review (${analysis.needsReview.length})</summary><div class="pdf-entry-list">${needsReview}</div></details>${!rows.length?'<p>No time-anchored entries found. The current programme is unchanged; you can convert relevant text below or add rows manually.</p>':''}<details><summary>Unrecognized text (never imported automatically)</summary><div class="pdf-unrecognized-list">${text||'<p>No unrecognized text lines.</p>'}</div></details>${large?'<label class="pdf-confirm-volume"><input id="confirmPdfVolume" type="checkbox"> I reviewed this large extraction and want to preview selected entries</label>':''}<label class="import-mode">How should approved entries interact with the programme?<select id="pdfImportMode"><option value="merge">Merge with existing programme</option><option value="replace-source">Replace this source’s entries</option><option value="replace-programme">Replace entire programme</option></select></label><button id="previewPdfChanges" class="secondary-btn" type="button">Preview selected programme changes</button>`;
  root.querySelectorAll('[data-pdf-field]').forEach(input=>input.addEventListener('input',()=>{const row=rows[Number(input.closest('[data-pdf-entry]').dataset.pdfEntry)];row[input.dataset.pdfField]=input.value;row.manualFields={...(row.manualFields||{}),[input.dataset.pdfField]:true};}));
  $('#previewPdfChanges').addEventListener('click',()=>{
    if(large&&!$('#confirmPdfVolume').checked)return toast('Review the large extraction and confirm it before proceeding');
    const selected=[];for(const [index,row] of rows.entries()){if(root.querySelector(`[data-pdf-entry="${index}"] [data-pdf-include]`)?.checked)selected.push(row);}
    for(const input of root.querySelectorAll('[data-pdf-convert]:checked')){const item=analysis.unrecognized[Number(input.dataset.pdfConvert)],title=root.querySelector(`[data-pdf-unrecognized-title="${input.dataset.pdfConvert}"]`).value.trim();if(!title)continue;selected.push({id:crypto.randomUUID(),date:'',start:'',end:'',type:'talk',session:'',title,speaker:'',chair:'',affiliation:'',location:'',track:'',posterNumber:'',abstract:'',doi:'',manualEdited:true,importConfidence:0.2,importWarnings:['Organizer-created from unrecognized PDF text; fill the missing schedule and session fields.'],source:{id:`${pendingSourceFile.id}:pdf-manual:${item.page}:${item.line}`,fileId:pendingSourceFile.id,page:item.page,line:item.line,extraction:item.extraction,raw:item.text,contributors:[pendingSourceFile.id]}});}
    if(selected.length>300)return toast('More than 300 rows selected. Refine the PDF review before proceeding.');
    if(!selected.length)return toast('Select or convert at least one entry to preview changes');
    pendingMappedRows=selected;showImportComparison(compareProgrammeImport(selected,$('#pdfImportMode').value,pendingSourceFile));
  });
}

async function doImport(){
  const file=$('#programmeFile').files[0];if(!file)return toast('Choose a file first');const status=$('#importStatus'),revision=++importRevision;status.textContent='Importing…';rawRows=[];rawHeaders=[];pendingMappedRows=[];pendingPdfAnalysis=null;pendingStructuredPackage=null;$('#mappingCard').hidden=true;$('#importReview').hidden=true;$('#pdfReview').hidden=true;pendingXlsxFile=null;pendingXlsxSourceId='';loadedWorksheetName='';worksheetLoading=false;worksheetRevision++;
  try{
    const previousSource=(project.sourceFiles||[]).find(x=>x.name===file.name);
    const sourceFile={id:previousSource?.id||crypto.randomUUID(),name:file.name,type:file.type,lastModified:file.lastModified,blob:file,importedAt:previousSource?.importedAt||'',contributedRecords:previousSource?.contributedRecords||0,status:'Previewing'};
    pendingSourceFile=sourceFile;
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['xlsx','xls'].includes(ext)){pendingXlsxFile=null;pendingXlsxSourceId='';loadedWorksheetName='';worksheetLoading=false;worksheetRevision++;$('#sheetChooserWrap').hidden=true;}
    const tagSource=rows=>rows.map(row=>({...row,__sourceFileId:sourceFile.id}));
    if(ext==='csv'){const staged=tagSource(parseCSV(await file.text()));if(revision!==importRevision)return;rawRows=staged;rawHeaders=Object.keys(rawRows[0]||{}).filter(x=>!x.startsWith('__'));showMapping(guessMapping(rawHeaders));status.textContent=`${rawRows.length} CSV rows loaded; apply mapping to save`;}
    else if(ext==='xlsx'||ext==='xls'){const sheets=await listXlsxSheets(file);if(revision!==importRevision)return;if(!sheets.length)throw new Error('Workbook has no sheets');pendingXlsxFile=file;pendingXlsxSourceId=sourceFile.id;loadedWorksheetName='';worksheetLoading=false;const chooser=$('#xlsxSheet'),wrap=$('#sheetChooserWrap');chooser.innerHTML=sheets.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');const selected=sheets.includes(project.lastWorksheet)?project.lastWorksheet:sheets[0];chooser.value=selected;wrap.hidden=sheets.length<2;await loadXlsxWorksheet(selected,revision);}
    else if(ext==='json'){
      const json=JSON.parse(await file.text());
      if(Array.isArray(json)){const staged=tagSource(json);if(revision!==importRevision)return;rawRows=staged;rawHeaders=Object.keys(rawRows[0]||{}).filter(x=>!x.startsWith('__'));showMapping(guessMapping(rawHeaders));status.textContent=`${rawRows.length} JSON rows loaded; apply mapping to save`;}
      else if(json.programme&&json.conference){
        const schemaErrors=await validatePackageSchemas(json);if(schemaErrors.length)throw new Error(`Structured conference JSON failed schema validation: ${schemaErrors.join('; ')}`);
        const semantic=validatePackage(json);if(semantic.errors.length)throw new Error(`Structured conference JSON is invalid: ${semantic.errors.join('; ')}`);
        if(revision!==importRevision)return;
        pendingStructuredPackage=json;pendingMappedRows=rowsFromStructuredPackage(json,sourceFile.id);sourceFile.status='Awaiting import confirmation';showImportComparison(compareProgrammeImport(pendingMappedRows,$('#importMode').value,sourceFile));status.textContent=`Structured package preview ready: ${pendingMappedRows.length} entries; no project changes made`;
      }
      else if(Array.isArray(json.rows)){const staged=tagSource(json.rows);if(revision!==importRevision)return;rawRows=staged;rawHeaders=Object.keys(rawRows[0]||{}).filter(x=>!x.startsWith('__'));showMapping(guessMapping(rawHeaders));status.textContent=`${rawRows.length} JSON rows loaded; apply mapping to save`;}
      else throw new Error('JSON must be an array of rows or contain a rows array');
    }
    else if(ext==='pdf'){
      const pages=await importPdf(file,(p,n,mode)=>{if(revision===importRevision)status.textContent=mode==='ocr'?`OCR for scanned PDF page ${p}/${n}…`:`Reading PDF layout, page ${p}/${n}…`;});if(revision!==importRevision)return;if(!Array.isArray(pages)||!pages.length)throw new Error('PDF import returned no readable pages');
      pdfPages=pages;sourceFile.status='Awaiting review';const analysis=analyzePdfProgram(pages,sourceFile.id);analysis.pages=pages;showPdfReview(analysis);status.textContent=`PDF extraction ready for review: ${analysis.quality.entryCount} anchored entries; existing programme unchanged.`;
    } else throw new Error('Unsupported file type');
  }catch(err){if(revision===importRevision){pendingSourceFile=null;console.error(err);status.textContent='Import failed; existing project preserved';toast(err.message||'Import failed');}}
}

async function assetFromFile(file){if(!file)return null;const bytes=new Uint8Array(await file.arrayBuffer());const ext=file.type.includes('svg')?'.svg':file.type.includes('jpeg')?'.jpg':file.type.includes('webp')?'.webp':'.png';return{name:file.name,type:file.type,extension:ext,bytes};}
async function chooseLogo(file){pendingPreviewAssets++;try{project.logo=await assetFromFile(file);scheduleSave();toast(project.logo?'Logo stored in Builder project':'Logo cleared');}finally{finishPreviewAssetRead();}}
async function chooseAppIcon(file){project.appIcon=await assetFromFile(file);scheduleSave();syncBrandingControls();toast(project.appIcon?'App icon artwork stored':'App icon cleared');}
async function chooseSponsors(files){pendingPreviewAssets++;try{project.sponsorFiles=[];for(const file of files||[])project.sponsorFiles.push(await assetFromFile(file));scheduleSave();toast(`${project.sponsorFiles.length} sponsor asset${project.sponsorFiles.length===1?'':'s'} stored`);}finally{finishPreviewAssetRead();}}
async function exportBuilderProject(){try{const blob=await createBuilderProjectFile(project),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(project.conference?.shortName||project.conference?.name||'conference').replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-builder-project.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Builder project exported');}catch(err){console.error(err);toast('Could not export Builder project');}}
async function importBuilderProject(file){try{
  const revision=++importRevision;
  const incoming=await readBuilderProjectFile(file);
  if(revision!==importRevision)return;
  const nextProject={...structuredClone(defaults),...incoming,conference:{...defaults.conference,...incoming.conference},features:{...defaults.features,...incoming.features},policy:{...defaults.policy,...incoming.policy},branding:{...defaults.branding,...incoming.branding,trackColors:{...(incoming.branding?.trackColors||{})},locationColors:{...(incoming.branding?.locationColors||{})}}};
  normalizeBuilderProjectAssets(nextProject);
  nextProject.branding=normalizeBranding(incoming.branding);nextProject.logoLight=incoming.logoLight||null;nextProject.logoDark=incoming.logoDark||null;nextProject.sponsorFiles=normalizeSponsorFiles(incoming.sponsorFiles||[]);
  await validateBuilderProjectTrial(nextProject);
  if(revision!==importRevision)return;
  if(!confirm('Replace the current Builder project with this backup? The current project will be saved first.'))return;
  const previousInert=document.body.inert;document.body.inert=true;clearTimeout(saveTimer);saveRevision++;
  try{
    await pendingSave.catch(()=>{});
    await saveProject(structuredClone(project));
    await saveProject(structuredClone(nextProject));
    project=nextProject;location.reload();
  }finally{document.body.inert=previousInert;}
}catch(err){console.error(err);toast(err?.message||'Could not import Builder project');}}

async function download(){try{const {blob,report,pkg}=await packageZip(project);renderReport(report);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${pkg.conference.id||'conference'}-data-package-v${pkg.manifest.dataVersion}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);project.lastExportedVersion=Number(pkg.manifest.dataVersion||project.dataVersion||1);project.lastExportedAt=new Date().toISOString();project.lastExportedFingerprint=await packageContentFingerprint(pkg);scheduleSave();updateReleaseStatus();toast('Validated deployment ZIP downloaded; confirm publication after deploying it');}catch(err){console.error(err);toast(err?.message||'Fix validation errors before exporting');const result=await buildPackage(project);renderReport(result.report);}}
async function confirmPublication(){const {pkg,report}=await buildPackage(project);renderReport(report);if(report.errors.length){toast('Resolve validation errors before confirming publication');return;}if(!confirm(`Confirm that data version ${pkg.manifest.dataVersion} has been deployed to the conference website?`))return;try{await confirmProjectPublication(project,pkg);scheduleSave();updateReleaseStatus();renderDerived();toast(`Version ${pkg.manifest.dataVersion} confirmed as published`);}catch(error){toast(error.message||'Could not confirm publication');}}

async function init(){const saved=await loadProject();if(saved)project={...structuredClone(defaults),...saved,conference:{...defaults.conference,...saved.conference},features:{...defaults.features,...saved.features},policy:{...defaults.policy,...saved.policy},branding:{...defaults.branding,...saved.branding,trackColors:{...defaults.branding.trackColors,...saved.branding?.trackColors},locationColors:{...defaults.branding.locationColors,...saved.branding?.locationColors}},peopleOverrides:{...(saved.peopleOverrides||{})},identityDecisions:{pairs:{...(saved.identityDecisions?.pairs||{})}},locationOverrides:{...(saved.locationOverrides||{})},sessionOverrides:{...(saved.sessionOverrides||{})},peoplePhotos:{...(saved.peoplePhotos||{})},extraPeople:Array.isArray(saved.extraPeople)?saved.extraPeople:[],extraLocations:Array.isArray(saved.extraLocations)?saved.extraLocations:[],announcements:Array.isArray(saved.announcements)?saved.announcements:[],deletedSourceIds:Array.isArray(saved.deletedSourceIds)?saved.deletedSourceIds:[],changelog:Array.isArray(saved.changelog)?saved.changelog:[],lastPublishedVersion:Number(saved.lastPublishedVersion||0),lastExportedVersion:Number(saved.lastExportedVersion||0),confirmedPublications:Array.isArray(saved.confirmedPublications)?saved.confirmedPublications:[],identityRegistry:{people:{...(saved.identityRegistry?.people||{})},personRecords:{...(saved.identityRegistry?.personRecords||{})},autoConsolidatedIds:[...(saved.identityRegistry?.autoConsolidatedIds||[])],locations:{...(saved.identityRegistry?.locations||{})},tracks:{...(saved.identityRegistry?.tracks||{})}},logo:saved.logo||null,appIcon:saved.appIcon||null,sponsorFiles:Array.isArray(saved.sponsorFiles)?saved.sponsorFiles:[],sourceFiles:Array.isArray(saved.sourceFiles)?saved.sourceFiles:[]};project.branding=normalizeBranding(saved?.branding);project.logoLight=saved?.logoLight||null;project.logoDark=saved?.logoDark||null;project.sponsorFiles=normalizeSponsorFiles(saved?.sponsorFiles||[]);normalizeBuilderProjectAssets(project);bindConfig();initBulkEditor();renderRows();renderAnnouncementsBuilder();renderSourceManager();await renderDerived();
  $('#importProgramme').addEventListener('click',doImport);$('#xlsxSheet').addEventListener('change',e=>loadXlsxWorksheet(e.target.value).catch(err=>{console.error(err);toast(err.message||'Could not load worksheet');}));$('#applyMapping').addEventListener('click',applyMapping);$('#sourceManager').addEventListener('click',event=>{const button=event.target.closest('[data-remove-source]');if(button)openSourceRemoval(button.dataset.removeSource);});
  $('#sourceRemovalDialog').addEventListener('change',event=>{const strategy=event.target.value,plan=sourceRemovalPlans?.options[strategy];if(!plan)return;renderSourceRemovalImpact(plan);$('#sourceRemovalImpact').hidden=false;$('#confirmSourceRemoval').disabled=false;});
  $('#confirmSourceRemoval').addEventListener('click',confirmSourceRemoval);$('#cancelSourceRemoval').addEventListener('click',()=>$('#sourceRemovalDialog').close());$('#sourceRemovalDialog').addEventListener('close',()=>{if(!sourceRemovalBusy)sourceRemovalPlans=null;});$('#sourceRemovalDialog').addEventListener('cancel',()=>{sourceRemovalPlans=null;});
  $('#clearImportedProgramme').addEventListener('click',openClearProgramme);$('#cancelClearProgramme').addEventListener('click',()=>$('#clearProgrammeDialog').close());$('#confirmClearProgramme').addEventListener('click',confirmClearProgramme);$('#clearProgrammeDialog').addEventListener('change',()=>{const complete=clearProgrammePlan?.impact.uncertainRows.every(row=>!!$(`[name="uncertain-${CSS.escape(row.id)}"]:checked`));$('#confirmClearProgramme').disabled=!complete;});
  $('#addRow').addEventListener('click',()=>{project.rows.push({id:crypto.randomUUID(),date:'',start:'',end:'',type:'talk',session:'',title:'',speaker:'',chair:'',affiliation:'',location:'',track:'',posterNumber:'',abstract:'',doi:'',manualEdited:true});scheduleSave();renderRows();renderDerived();});$('#logoFile').addEventListener('change',e=>chooseLogo(e.target.files[0]));$('#appIconFile').addEventListener('change',e=>chooseAppIcon(e.target.files[0]));$('#sponsorFiles').addEventListener('change',e=>chooseSponsors([...e.target.files]));$('#exportBuilderProject').addEventListener('click',exportBuilderProject);$('#importBuilderProject').addEventListener('click',()=>$('#builderProjectInput').click());$('#builderProjectInput').addEventListener('change',e=>{if(e.target.files[0])importBuilderProject(e.target.files[0]);e.target.value='';});$('#addPerson').addEventListener('click',async()=>{const id=`person-extra-${crypto.randomUUID()}`;project.extraPeople=[...(project.extraPeople||[]),{id,name:'New person',position:'',affiliation:'',publicEmail:'',orcid:'',website:'',photoUrl:''}];scheduleSave();await renderDerived();openPersonEditor(id);});$('#addLocation').addEventListener('click',()=>{project.extraLocations=[...(project.extraLocations||[]),{id:`loc-extra-${crypto.randomUUID()}`,type:'venue',name:'New location',parentLocationId:'',address:'',mapUrl:'',lat:'',lon:''}];scheduleSave();renderDerived();});$('#addAnnouncement').addEventListener('click',()=>{project.announcements.push({id:crypto.randomUUID(),timestamp:new Date().toISOString(),message:'',affectedIds:[]});scheduleSave();renderAnnouncementsBuilder();});$('#validateProject').addEventListener('click',()=>refreshPreview());$('#downloadPackage').addEventListener('click',download);$('#confirmPublication').addEventListener('click',confirmPublication);$('#resetProject').addEventListener('click',async()=>{if(!confirm('Reset the entire Builder project?'))return;clearTimeout(saveTimer);saveRevision++;await pendingSave.catch(()=>{});await clearProject();location.reload();});
}
init().then(()=>{
  $('#addRow').addEventListener('click',()=>{const row=project.rows.at(-1);if(row)row.manuallyCreated=true;});
  setupPreview();initWizard();initPeopleUi();
  document.querySelector('.builder-topbar').inert=false;document.querySelector('.builder-shell').inert=false;document.body.setAttribute('aria-busy','false');document.body.dataset.builderReady='true';
  $('#validationReport').addEventListener('click',event=>{const button=event.target.closest('[data-error-step]');if(!button)return;const id=button.dataset.targetId,type=button.dataset.targetType;setStep(button.dataset.errorStep,{focus:!id});if(!id)return;if(type==='person'){openPersonEditor(id);return;}if(type==='identity-assignment'){requestAnimationFrame(()=>{const row=$$('#reviewTable tbody tr').find(el=>el.dataset.rowId===id);if(!row)return;row.classList.add('identity-target-highlight');row.scrollIntoView({block:'center'});row.querySelector(`[data-person-identity][data-person-role="${CSS.escape(button.dataset.targetRole)}"][data-person-index="${button.dataset.targetIndex}"]`)?.focus();});return;}const record=project.rows.find(x=>x.entityId===id||x.id===id);const target=type==='session'?$$('#sessionPreview [data-session-id]').find(el=>el.dataset.sessionId===id):record?$$('#reviewTable tbody tr').find(el=>el.dataset.rowId===record.id):null;if(target){target.scrollIntoView({block:'center'});target.querySelector('input,select,textarea')?.focus();}});
}).catch(error=>{console.error(error);setSaveStatus(`Builder could not load: ${error.message}`,true);document.querySelector('.builder-topbar').inert=false;document.querySelector('.builder-shell').inert=false;document.body.setAttribute('aria-busy','false');document.body.dataset.builderReady='error';});
