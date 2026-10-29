/** RFC4180-compatible CSV parser (quoted delimiters, escaped quotes, multiline cells). */
export function parseCSV(text){
  const input=String(text||'').replace(/^\uFEFF/,'');
  // Count separators in the first logical record, excluding quoted headers,
  // even if the header itself spans physical lines.
  let commas=0,semicolons=0,quotes=false;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(c==='"'){
      if(quotes&&input[i+1]==='"'){i++;continue;}
      quotes=!quotes;
    }else if(!quotes){
      if(c==='\n'||c==='\r')break;
      if(c===',')commas++;
      if(c===';')semicolons++;
    }
  }
  const delimiter=semicolons>commas?';':',';
  const rows=[];let row=[],cell='',quoted=false,rowStart=1;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(c==='"'){
      if(quoted&&input[i+1]==='"'){cell+='"';i++;}
      else if(quoted||cell==='')quoted=!quoted;
      else cell+=c;
    }else if(c===delimiter&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){
      row.push(cell);cell='';
      if(row.some(v=>v.trim()))rows.push({row,rowStart});
      row=[];if(c==='\r'&&input[i+1]==='\n')i++;
      rowStart=input.slice(0,i+1).split('\n').length;
    }else cell+=c;
  }
  if(quoted)throw new Error('CSV contains an unterminated quoted field');
  row.push(cell);if(row.some(v=>v.trim()))rows.push({row,rowStart});
  if(!rows.length)return [];
  const headers=rows[0].row.map(x=>x.trim());
  return rows.slice(1).map(({row,rowStart})=>({...Object.fromEntries(row.map((v,i)=>[headers[i]||`column_${i+1}`,v.trim()])),__sourceRow:rowStart}));
}

export function guessMapping(headers){
  const lower=headers.map(h=>[h,String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g,'')]);
  const pick=(...terms)=>lower.find(([,h])=>terms.some(t=>h===t))?.[0]||lower.find(([,h])=>terms.some(t=>h.includes(t))&&!h.endsWith('id'))?.[0]||'';
  return {
    date:pick('date','day'),start:pick('start','starttime','timefrom'),end:pick('end','endtime','timeto'),type:pick('type','kind'),
    session:pick('session','sessiontitle','topic'),title:pick('title','talk','presentation','name'),speaker:pick('speaker','presenter','author'),chair:pick('chair','sessionchair'),
    affiliation:pick('affiliation','organization','organisation','institution'),location:pick('room','location','venue'),track:pick('track','stream'),
    abstract:pick('abstract','description'),doi:pick('doi','url','link'),posterNumber:pick('posternumber','poster','number'),
    speakerId:pick('speakerid','presenterid','authorid','personid'),chairId:pick('chairid','sessionchairid')
  };
}

export function rowsFromMapping(raw,mapping){
  const val=(row,key)=>mapping[key]?String(row[mapping[key]]??'').trim():'';
  return raw.map((row,i)=>{
    const speakerEntityIds=val(row,'speakerId').split(';').map(x=>x.trim()).filter(Boolean),chairEntityIds=val(row,'chairId').split(';').map(x=>x.trim()).filter(Boolean);
    const personIdentityAssignments={};
    if(speakerEntityIds.length)personIdentityAssignments.speaker=Object.fromEntries(speakerEntityIds.map((personId,index)=>[index,{personId,status:'confirmed'}]));
    if(chairEntityIds.length)personIdentityAssignments.chair=Object.fromEntries(chairEntityIds.map((personId,index)=>[index,{personId,status:'confirmed'}]));
    return ({
    id:row.id||crypto.randomUUID(), date:val(row,'date'), start:val(row,'start'), end:val(row,'end'), type:val(row,'type')||'talk',
    session:val(row,'session'), title:val(row,'title'), speaker:val(row,'speaker'), chair:val(row,'chair'), affiliation:val(row,'affiliation'), location:val(row,'location'),
    track:val(row,'track'), abstract:val(row,'abstract'), doi:val(row,'doi'), posterNumber:val(row,'posterNumber'),
    speakerEntityIds,chairEntityIds,personIdentityAssignments,
    source:{id:`${row.__sourceFileId||'source'}:${row.__sheet||'source'}:${row.__sourceRow??i+1}`,fileId:row.__sourceFileId||'',contributors:[row.__sourceFileId||'source'],row:row.__sourceRow??i+1,sheet:row.__sheet||'',raw:row,
      matchData:Object.fromEntries(['date','start','end','type','session','title','speaker','chair','affiliation','location','track','posterNumber'].map(k=>[k,val(row,k)]))}
    });
  });
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

export function itemsToLines(items){
  const grouped=[];let lastY=null,line=[];
  const sorted=[...items].filter(x=>String(x.str||'').trim()).sort((a,b)=>{
    const ay=a.transform?.[5]||0,by=b.transform?.[5]||0;if(Math.abs(by-ay)>2)return by-ay;return (a.transform?.[4]||0)-(b.transform?.[4]||0);
  });
  for(const item of sorted){const y=item.transform?.[5]||0;if(lastY==null||Math.abs(y-lastY)<=2){line.push(item);}else{grouped.push(line);line=[item];}lastY=y;}if(line.length)grouped.push(line);
  return grouped.flatMap(xs=>{
    const segments=[];let segment=[],right=null;
    for(const item of xs.sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0))){
      const x=item.transform?.[4]||0;
      // A large gutter must not combine simultaneous presentations in adjacent columns.
      if(right!==null&&x-right>48){segments.push(segment);segment=[];}
      segment.push(item.str);right=x+Number(item.width||0);
    }
    if(segment.length)segments.push(segment);
    return segments.map(parts=>parts.join(' ').replace(/\s+/g,' ').trim());
  }).filter(Boolean);
}

/** Infer columns only from repeated timed anchors; uncertain layouts stay review drafts. */
export function pdfTextRegions(items){
  const timed=items.filter(item=>/\b\d{1,2}:\d{2}\s*[-–—]/.test(item.str||''));
  const anchors=[];
  for(const item of timed){const x=item.transform?.[4]||0;let anchor=anchors.find(a=>Math.abs(a.x-x)<24);if(!anchor){anchor={x,count:0};anchors.push(anchor);}anchor.count++;}
  const columns=anchors.filter(a=>a.count>=2).sort((a,b)=>a.x-b.x);
  if(columns.length<2||columns.some((a,i)=>i&&a.x-columns[i-1].x<120))return [itemsToLines(items)];
  const top=Math.max(...timed.map(item=>item.transform?.[5]||0));
  const shared=items.filter(item=>(item.transform?.[5]||0)>top&&/\b20\d{2}\b/.test(item.str||''));
  return columns.map((column,index)=>itemsToLines([...shared,...items.filter(item=>!shared.includes(item)&&(item.transform?.[4]||0)>= (index?column.x-12:-Infinity)&&(item.transform?.[4]||0)<(columns[index+1]?.x-12||Infinity))]));
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
    const page=await doc.getPage(p),content=await page.getTextContent();let columns=pdfTextRegions(content.items),lines=columns.flat(),ocr=false,ocrError='';
    const nativeQuality=lines.filter(line=>/\b\d{1,2}:\d{2}\s*[-–—]/.test(line)).length;
    if(lines.join(' ').trim().length<30||(!nativeQuality&&lines.length>0&&lines.every(line=>line.length<3))){
      try{onProgress(p,doc.numPages,'ocr');lines=await ocrPdfPage(page);ocr=true;}catch(err){ocrError=err?.message||String(err);}
    }
    pages.push({page:p,lines,columns:ocr?[lines]:columns,ocr,ocrError,extraction:ocr?'ocr':'native',nativeTextLength:content.items.map(item=>item.str||'').join(' ').trim().length});
  }
  return pages;
}

export function heuristicRowsFromPdf(pages,_defaultDate='',sourceFileId='pdf'){
  const rows=[];let currentDate='';
  const dateIso=/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/;
  const euroDate=/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/;
  const time=/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:[-–—]|to)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i;
  for(const page of pages.flatMap(page=>(page.columns||[page.lines]).map((lines,column)=>({...page,lines,column})))){
    // Context is deliberately page-local: a new page/column may belong to another track.
    let context={location:'',track:'',session:''},posterWindow=null,lastRow=null;
    for(const [lineIndex,raw] of page.lines.entries()){
      const line=String(raw).trim(),dm=dateIso.exec(line),em=euroDate.exec(line);
      if(dm||em){currentDate=dm?`${dm[1]}-${dm[2].padStart(2,'0')}-${dm[3].padStart(2,'0')}`:`${em[3]}-${em[2].padStart(2,'0')}-${em[1].padStart(2,'0')}`;posterWindow=null;lastRow=null;}
      const heading=/^(Room|Location|Venue|Track|Stream|Session)\s*:\s*(.+)$/i.exec(line);
      if(heading){const field=/track|stream/i.test(heading[1])?'track':/session/i.test(heading[1])?'session':'location';context[field]=heading[2];posterWindow=null;lastRow=null;continue;}
      const tm=time.exec(line),poster=/^(?:Poster\s+|P)([A-Za-z]?\d+[A-Za-z]?)\s*[:.\-–]?\s+(.+)$/i.exec(line);
      if(!tm&&!poster){
        // Unanchored text is kept in extraction review separately. It may be
        // an author, heading, footer, or wrapped title; assigning it silently
        // would create convincing but unsupported programme data.
        continue;
      }
      const warnings=['PDF assignment is provisional; verify session, room, track and authors.'];
      let title=poster?poster[2]:line.replace(dm?.[0]||em?.[0]||'','').replace(tm[0],'').replace(/^\s*[-–—:|]\s*/,'').trim();
      let speaker='';const split=title.split(/\s+(?:—|–|\|)\s+/);
      if(split.length===2){[title,speaker]=split.map(x=>x.trim());}else if(split.length>2)warnings.push('Multiple separators: author assignment is ambiguous.');
      const start=tm?`${tm[1].padStart(2,'0')}:${tm[2]}`:posterWindow?.start||'',end=tm?`${tm[3].padStart(2,'0')}:${tm[4]}`:posterWindow?.end||'';
      if(tm&&/^(?:poster session|posters)\b/i.test(title)){
        posterWindow={start,end};context.session=title;lastRow=null;continue;
      }
      if(poster&&!posterWindow)warnings.push('Poster has no explicit session time; assign it before publishing.');
      if(page.ocr)warnings.push('OCR text requires organizer review.');
      if(!currentDate)warnings.push('Missing date.');
      const confidence=page.ocr?0.45:currentDate&&context.location&&context.session?0.8:0.62;
      if(page.ocr)warnings.push('OCR-derived text; verify every field.');
      if(!currentDate)warnings.push('Missing date.');
      const row={id:crypto.randomUUID(),date:currentDate,start,end,type:poster?'poster':'talk',...context,title,speaker,chair:'',affiliation:'',abstract:'',doi:'',posterNumber:poster?.[1]||'',importConfidence:confidence,importWarnings:warnings,source:{id:`${sourceFileId}:pdf:${page.page}:${page.column?`column-${page.column}:`:''}${lineIndex+1}`,fileId:sourceFileId,page:page.page,column:page.column,line:lineIndex+1,extraction:page.extraction|| (page.ocr?'ocr':'native'),confidence,raw:line}};
      rows.push(row);lastRow=row;
    }
  }
  // Overlapping entries without explicit context must remain visible as ambiguous drafts.
  for(const row of rows)if(rows.some(other=>other!==row&&other.date===row.date&&other.start<row.end&&row.start<other.end&&(!row.location||!row.track)))row.importWarnings.push('Overlapping entries may belong to parallel columns/tracks; assign context manually.');
  return rows;
}

/** Review-oriented PDF result: only anchored programme entries are proposed. */
export function analyzePdfProgram(pages,sourceFileId='pdf'){
  const rows=heuristicRowsFromPdf(pages,'',sourceFileId);
  const datePattern=/\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]20\d{2})\b/;
  const heading=/^(?:room|location|venue|track|stream|session)\s*:/i, timed=/\b\d{1,2}:\d{2}\s*[-–—]/;
  const unrecognized=[];
  for(const page of pages)for(const [columnIndex,column] of (page.columns||[page.lines]).entries())for(const [lineIndex,text] of column.entries()){
    const value=String(text||'').trim();if(!value||datePattern.test(value)||heading.test(value)||timed.test(value)||/^(?:poster\s+|P)[A-Za-z]?\d+\s*[:.\-–]/i.test(value))continue;
    unrecognized.push({text:value,page:page.page,column:columnIndex,line:lineIndex+1,extraction:page.extraction|| (page.ocr?'ocr':'native'),confidence:page.ocr?0.35:0.2});
  }
  const confident=rows.filter(row=>row.importConfidence>=0.7&&!row.importWarnings.some(warning=>/ambiguous|missing|OCR/i.test(warning)));
  const needsReview=rows.filter(row=>!confident.includes(row));
  const ocrPages=pages.filter(page=>page.ocr).length,failedPages=pages.filter(page=>page.ocrError).length;
  return {confident,needsReview,unrecognized,quality:{pages:pages.length,ocrPages,failedPages,entryCount:rows.length,lowConfidence:needsReview.length,unrecognizedCount:unrecognized.length,extraction:ocrPages?'mixed/native+OCR':'native'}};
}

export function rowsFromStructuredPackage(json,sourceFileId='package'){
  const programme=json.programme||{},people=json.people?.people||json.people||[],locations=json.locations?.locations||json.locations||[];
  const personById=new Map((people||[]).map(p=>[p.id,p]));const locationById=new Map((locations||[]).map(l=>[l.id,l]));const sessionById=new Map((programme.sessions||[]).map(s=>[s.id,s]));
  const referencedPosterSessionIds=new Set((programme.posters||[]).map(p=>p.posterSessionId).filter(Boolean));
  const rows=[];
  for(const p of programme.presentations||[]){const s=sessionById.get(p.sessionId)||{};const speakers=(p.speakerIds||[]).map(id=>personById.get(id)).filter(Boolean);rows.push({id:crypto.randomUUID(),entityId:p.id,sessionId:s.id,locationEntityId:s.locationId,trackEntityId:s.trackId,speakerEntityIds:[...(p.speakerIds||[])],chairEntityIds:[...(s.chairIds||[])],date:s.date||'',start:p.start||'',end:p.end||'',type:p.type||'talk',session:s.title||'',title:p.title||'',speaker:speakers.map(x=>x.name).join('; '),chair:(s.chairIds||[]).map(id=>personById.get(id)?.name).filter(Boolean).join('; '),affiliation:speakers.flatMap(x=>x.affiliations||[]).filter(Boolean).join('; '),location:locationById.get(s.locationId)?.name||'',track:(programme.tracks||[]).find(t=>t.id===s.trackId)?.name||s.trackId||'',posterNumber:'',abstract:p.abstract||'',doi:(p.links||[])[0]?.url||'',calendarUid:p.calendarUid,sequence:p.sequence||0,source:{id:`${sourceFileId}:package:presentation:${p.id}`,fileId:sourceFileId,raw:p}});}
  for(const s of programme.sessions||[]){if((s.presentationIds||[]).length||(s.type==='poster-session'&&referencedPosterSessionIds.has(s.id)))continue;rows.push({id:crypto.randomUUID(),sessionId:s.id,locationEntityId:s.locationId,trackEntityId:s.trackId,chairEntityIds:[...(s.chairIds||[])],date:s.date||'',start:s.start||'',end:s.end||'',type:s.type||'special',session:s.title||'',title:s.title||'',speaker:'',chair:(s.chairIds||[]).map(id=>personById.get(id)?.name).filter(Boolean).join('; '),affiliation:'',location:locationById.get(s.locationId)?.name||'',track:(programme.tracks||[]).find(t=>t.id===s.trackId)?.name||s.trackId||'',posterNumber:'',abstract:s.description||'',doi:(s.links||[])[0]?.url||'',calendarUid:s.calendarUid,sequence:s.sequence||0,source:{id:`${sourceFileId}:package:session:${s.id}`,fileId:sourceFileId,raw:s}});}
  for(const p of programme.posters||[]){const s=sessionById.get(p.posterSessionId)||{};const authors=(p.authorIds||[]).map(id=>personById.get(id)).filter(Boolean);rows.push({id:crypto.randomUUID(),entityId:p.id,posterSessionId:s.id,posterSessionCalendarUid:s.calendarUid,locationEntityId:s.locationId,trackEntityId:s.trackId,speakerEntityIds:[...(p.authorIds||[])],date:s.date||'',start:s.start||'',end:s.end||'',type:'poster',session:s.title||'',title:p.title||'',speaker:authors.map(x=>x.name).join('; '),chair:'',affiliation:authors.flatMap(x=>x.affiliations||[]).filter(Boolean).join('; '),location:locationById.get(s.locationId)?.name||'',track:(programme.tracks||[]).find(t=>t.id===s.trackId)?.name||s.trackId||'',posterNumber:p.number||'',abstract:p.abstract||'',doi:(p.links||[])[0]?.url||'',calendarUid:p.calendarUid,sequence:p.sequence||0,source:{id:`${sourceFileId}:package:poster:${p.id}`,fileId:sourceFileId,raw:p}});}
  return rows;
}
