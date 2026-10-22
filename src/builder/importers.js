function parseCsvLine(line,delimiter=','){
  const out=[];let cur='',quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){
      if(quoted&&line[i+1]==='"'){cur+='"';i++;}else quoted=!quoted;
    }else if(c===delimiter&&!quoted){out.push(cur);cur='';}else cur+=c;
  }
  out.push(cur);return out;
}
export function parseCSV(text){
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return [];
  const delimiter=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
  const headers=parseCsvLine(lines[0],delimiter).map(x=>x.trim());
  return lines.slice(1).map((line,rowIndex)=>Object.fromEntries(parseCsvLine(line,delimiter).map((v,i)=>[headers[i]||`column_${i+1}`,v.trim()]))).map((x,i)=>({...x,__sourceRow:i+2}));
}

export function guessMapping(headers){
  const lower=headers.map(h=>[h,String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g,'')]);
  const pick=(...terms)=>lower.find(([,h])=>terms.some(t=>h===t||h.includes(t)))?.[0]||'';
  return {
    date:pick('date','day'),start:pick('start','starttime','timefrom'),end:pick('end','endtime','timeto'),type:pick('type','kind'),
    session:pick('session','sessiontitle','topic'),title:pick('title','talk','presentation','name'),speaker:pick('speaker','presenter','author'),chair:pick('chair','sessionchair'),
    affiliation:pick('affiliation','organization','organisation','institution'),location:pick('room','location','venue'),track:pick('track','stream'),
    abstract:pick('abstract','description'),doi:pick('doi','url','link'),posterNumber:pick('posternumber','poster','number')
  };
}

export function rowsFromMapping(raw,mapping){
  const val=(row,key)=>mapping[key]?String(row[mapping[key]]??'').trim():'';
  return raw.map((row,i)=>({
    id:row.id||crypto.randomUUID(), date:val(row,'date'), start:val(row,'start'), end:val(row,'end'), type:val(row,'type')||'talk',
    session:val(row,'session'), title:val(row,'title'), speaker:val(row,'speaker'), chair:val(row,'chair'), affiliation:val(row,'affiliation'), location:val(row,'location'),
    track:val(row,'track'), abstract:val(row,'abstract'), doi:val(row,'doi'), posterNumber:val(row,'posterNumber'),
    source:{id:`${row.__sourceFileId||'source'}:${row.__sheet||'source'}:${row.__sourceRow??i+1}`,fileId:row.__sourceFileId||'',row:row.__sourceRow??i+1,sheet:row.__sheet||'',raw:row}
  }));
}

async function readWorkbook(file){
  const XLSX=await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
  return {XLSX,wb};
}

export async function listXlsxSheets(file){
  const {wb}=await readWorkbook(file);
  return [...wb.SheetNames];
}

export async function importXlsx(file,sheetName=''){
  const {XLSX,wb}=await readWorkbook(file);
  const name=sheetName&&wb.SheetNames.includes(sheetName)?sheetName:wb.SheetNames[0];
  if(!name)throw new Error('Workbook has no sheets');
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:false});
  return rows.map((x,i)=>({...x,__sourceRow:i+2,__sheet:name}));
}

function itemsToLines(items){
  const grouped=[];let lastY=null,line=[];
  const sorted=[...items].filter(x=>String(x.str||'').trim()).sort((a,b)=>{
    const ay=a.transform?.[5]||0,by=b.transform?.[5]||0;if(Math.abs(by-ay)>2)return by-ay;return (a.transform?.[4]||0)-(b.transform?.[4]||0);
  });
  for(const item of sorted){const y=item.transform?.[5]||0;if(lastY==null||Math.abs(y-lastY)<=2){line.push(item);}else{grouped.push(line);line=[item];}lastY=y;}if(line.length)grouped.push(line);
  return grouped.map(xs=>xs.sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0)).map(x=>x.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}

let tesseractModule=null;
async function ocrPdfPage(page){
  if(!tesseractModule)tesseractModule=await import('https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.esm.min.js');
  const viewport=page.getViewport({scale:1.8}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport}).promise;
  const result=await tesseractModule.recognize(canvas,'eng');
  return String(result?.data?.text||'').split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
}

export async function importPdf(file,onProgress=()=>{}){
  const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.mjs';
  const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const pages=[];
  for(let p=1;p<=doc.numPages;p++){
    onProgress(p,doc.numPages,'text');
    const page=await doc.getPage(p),content=await page.getTextContent();let lines=itemsToLines(content.items),ocr=false,ocrError='';
    if(lines.join(' ').trim().length<12){
      try{onProgress(p,doc.numPages,'ocr');lines=await ocrPdfPage(page);ocr=true;}catch(err){ocrError=err?.message||String(err);}
    }
    pages.push({page:p,lines,ocr,ocrError});
  }
  return pages;
}

export function heuristicRowsFromPdf(pages,defaultDate='',sourceFileId='pdf'){
  const rows=[];let currentDate=defaultDate;
  const dateIso=/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/;
  const time=/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:[-–—]|to)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i;
  for(const page of pages){for(const [lineIndex,line] of page.lines.entries()){const dm=dateIso.exec(line);if(dm){currentDate=`${dm[1]}-${String(dm[2]).padStart(2,'0')}-${String(dm[3]).padStart(2,'0')}`;continue;}const tm=time.exec(line);if(!tm)continue;const start=`${String(tm[1]).padStart(2,'0')}:${tm[2]}`,end=`${String(tm[3]).padStart(2,'0')}:${tm[4]}`;let title=line.replace(tm[0],'').replace(/^\s*[-–—:|]\s*/,'').trim();let speaker='';const split=title.split(/\s+(?:—|–|\|)\s+/);if(split.length>1){title=split[0].trim();speaker=split.slice(1).join(' — ').trim();}const confidence=Math.min(0.95,0.45+(currentDate?0.2:0)+(title.length>3?0.2:0)+(speaker?0.1:0));rows.push({id:crypto.randomUUID(),date:currentDate,start,end,type:'talk',session:'',title,speaker,chair:'',affiliation:'',location:'',track:'',abstract:'',doi:'',posterNumber:'',importConfidence:confidence,source:{id:`${sourceFileId}:pdf:${page.page}:${lineIndex+1}`,fileId:sourceFileId,page:page.page,line:lineIndex+1,confidence,raw:line}});}}
  return rows;
}

export function rowsFromStructuredPackage(json,sourceFileId='package'){
  const programme=json.programme||{},people=json.people?.people||json.people||[],locations=json.locations?.locations||json.locations||[];
  const personById=new Map((people||[]).map(p=>[p.id,p]));const locationById=new Map((locations||[]).map(l=>[l.id,l]));const sessionById=new Map((programme.sessions||[]).map(s=>[s.id,s]));
  const rows=[];
  for(const p of programme.presentations||[]){const s=sessionById.get(p.sessionId)||{};const speakers=(p.speakerIds||[]).map(id=>personById.get(id)).filter(Boolean);rows.push({id:crypto.randomUUID(),entityId:p.id,sessionId:s.id,locationEntityId:s.locationId,trackEntityId:s.trackId,speakerEntityIds:[...(p.speakerIds||[])],chairEntityIds:[...(s.chairIds||[])],date:s.date||'',start:p.start||s.start||'',end:p.end||s.end||'',type:p.type||'talk',session:s.title||'',title:p.title||'',speaker:speakers.map(x=>x.name).join('; '),chair:(s.chairIds||[]).map(id=>personById.get(id)?.name).filter(Boolean).join('; '),affiliation:speakers.flatMap(x=>x.affiliations||[]).filter(Boolean).join('; '),location:locationById.get(s.locationId)?.name||'',track:(programme.tracks||[]).find(t=>t.id===s.trackId)?.name||s.trackId||'',posterNumber:'',abstract:p.abstract||'',doi:(p.links||[])[0]?.url||'',calendarUid:p.calendarUid,sequence:p.sequence||0,source:{id:`${sourceFileId}:package:presentation:${p.id}`,fileId:sourceFileId,raw:p}});}
  for(const s of programme.sessions||[]){if((s.presentationIds||[]).length)continue;rows.push({id:crypto.randomUUID(),sessionId:s.id,locationEntityId:s.locationId,trackEntityId:s.trackId,chairEntityIds:[...(s.chairIds||[])],date:s.date||'',start:s.start||'',end:s.end||'',type:s.type||'special',session:s.title||'',title:s.title||'',speaker:'',chair:(s.chairIds||[]).map(id=>personById.get(id)?.name).filter(Boolean).join('; '),affiliation:'',location:locationById.get(s.locationId)?.name||'',track:(programme.tracks||[]).find(t=>t.id===s.trackId)?.name||s.trackId||'',posterNumber:'',abstract:s.description||'',doi:(s.links||[])[0]?.url||'',calendarUid:s.calendarUid,sequence:s.sequence||0,source:{id:`${sourceFileId}:package:session:${s.id}`,fileId:sourceFileId,raw:s}});}
  for(const p of programme.posters||[]){const s=sessionById.get(p.posterSessionId)||{};const authors=(p.authorIds||[]).map(id=>personById.get(id)).filter(Boolean);rows.push({id:crypto.randomUUID(),entityId:p.id,posterSessionId:s.id,posterSessionCalendarUid:s.calendarUid,locationEntityId:s.locationId,trackEntityId:s.trackId,speakerEntityIds:[...(p.authorIds||[])],date:s.date||'',start:s.start||'',end:s.end||'',type:'poster',session:s.title||'Poster session',title:p.title||'',speaker:authors.map(x=>x.name).join('; '),chair:'',affiliation:authors.flatMap(x=>x.affiliations||[]).filter(Boolean).join('; '),location:locationById.get(s.locationId)?.name||'',track:(programme.tracks||[]).find(t=>t.id===s.trackId)?.name||s.trackId||'',posterNumber:p.number||'',abstract:p.abstract||'',doi:(p.links||[])[0]?.url||'',calendarUid:p.calendarUid,sequence:p.sequence||0,source:{id:`${sourceFileId}:package:poster:${p.id}`,fileId:sourceFileId,raw:p}});}
  return rows;
}
