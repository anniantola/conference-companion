function pad(n){return String(n).padStart(2,'0');}
function utcStamp(date=new Date()) { return `${date.getUTCFullYear()}${pad(date.getUTCMonth()+1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`; }
function localStamp(date, time) { return `${String(date).replaceAll('-','')}T${String(time || '00:00').replace(':','')}00`; }
function esc(text='') { return String(text).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function fold(line) {
  const chunks=[]; let rest=String(line);
  while (new TextEncoder().encode(rest).length > 73) {
    let i=Math.min(70, rest.length);
    while (i>1 && new TextEncoder().encode(rest.slice(0,i)).length>73) i--;
    chunks.push(rest.slice(0,i)); rest=rest.slice(i);
  }
  chunks.push(rest);
  return chunks.join('\r\n ');
}
function offsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const map=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const localAsUtc=Date.UTC(Number(map.year),Number(map.month)-1,Number(map.day),Number(map.hour),Number(map.minute),Number(map.second));
  return Math.round((localAsUtc-date.getTime())/60000);
}
function offsetText(mins) {
  const sign=mins<0?'-':'+'; const a=Math.abs(mins); return `${sign}${pad(Math.floor(a/60))}${pad(a%60)}`;
}
function localParts(timeZone,date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const m=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${m.year}${m.month}${m.day}T${m.hour}${m.minute}${m.second}`;
}
function wallStampFromUtcWithOffset(date,offset) {
  const d=new Date(date.getTime()+offset*60000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
function timezoneName(timeZone,date) {
  const part = new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'short'}).formatToParts(date).find(x=>x.type==='timeZoneName');
  return part?.value || timeZone;
}
function findTransitions(timeZone,startYear,endYear) {
  const transitions=[];
  let previousDate=new Date(Date.UTC(startYear,0,1,12));
  let previousOffset=offsetMinutes(timeZone,previousDate);
  const end=new Date(Date.UTC(endYear+1,0,2,12));
  for(let t=previousDate.getTime()+86400000;t<=end.getTime();t+=86400000){
    const d=new Date(t), off=offsetMinutes(timeZone,d);
    if(off!==previousOffset){
      let lo=t-86400000, hi=t;
      while(hi-lo>60000){
        const mid=Math.floor((lo+hi)/2/60000)*60000;
        if(offsetMinutes(timeZone,new Date(mid))===previousOffset) lo=mid+60000; else hi=mid;
      }
      const at=new Date(hi);
      transitions.push({at,from:previousOffset,to:off,name:timezoneName(timeZone,new Date(hi+60000))});
      previousOffset=off;
    }
    previousDate=d;
  }
  return transitions;
}
function timezoneComponent(timeZone,startYear,endYear) {
  const transitions=findTransitions(timeZone,startYear-1,endYear+1);
  const lines=['BEGIN:VTIMEZONE',`TZID:${timeZone}`,`X-LIC-LOCATION:${timeZone}`];
  if(!transitions.length){
    const d=new Date(Date.UTC(startYear,0,1,12));
    const off=offsetMinutes(timeZone,d);
    lines.push('BEGIN:STANDARD',`DTSTART:${startYear}0101T000000`,`TZOFFSETFROM:${offsetText(off)}`,`TZOFFSETTO:${offsetText(off)}`,`TZNAME:${esc(timezoneName(timeZone,d))}`,'END:STANDARD');
  } else {
    for(const tr of transitions){
      const type=tr.to>tr.from?'DAYLIGHT':'STANDARD';
      lines.push(`BEGIN:${type}`,`DTSTART:${wallStampFromUtcWithOffset(tr.at,tr.from)}`,`TZOFFSETFROM:${offsetText(tr.from)}`,`TZOFFSETTO:${offsetText(tr.to)}`,`TZNAME:${esc(tr.name)}`,`RDATE:${wallStampFromUtcWithOffset(tr.at,tr.from)}`,`END:${type}`);
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

function itemDescription(item, conference) {
  const bits=[];
  if(item.session && item.session!==item.title) bits.push(`Session: ${item.session}`);
  if(item.speaker) bits.push(`Speaker: ${item.speaker}`);
  if(item.affiliation) bits.push(`Affiliation: ${item.affiliation}`);
  if(item.abstract) bits.push(item.abstract);
  if(conference.officialWebsite) bits.push(conference.officialWebsite);
  return bits.join('\n\n');
}


export function calendarUidForEntity(entityId, conference={}) {
  const id=String(entityId||'event').trim()||'event';
  let domain='conference-companion.local';
  try {
    if (conference.officialWebsite) domain=new URL(conference.officialWebsite).hostname || domain;
  } catch {}
  if (domain==='conference-companion.local' && conference.id) {
    const slug=String(conference.id).toLowerCase().replace(/[^a-z0-9.-]+/g,'-').replace(/^-+|-+$/g,'');
    if (slug) domain=`${slug}.conference-companion.local`;
  }
  return `${id}@${domain}`;
}

export function buildICS({conference, manifest, items, locationLabel}) {
  const tz=conference.timezone;
  const years=(items||[]).map(x=>Number(String(x.date).slice(0,4))).filter(Number.isFinite);
  const startYear=Math.min(...years,Number(String(conference.startDate||new Date().getFullYear()).slice(0,4)));
  const endYear=Math.max(...years,Number(String(conference.endDate||startYear).slice(0,4)));
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Conference Companion//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${esc(conference.name||'Conference')}`,`X-WR-TIMEZONE:${tz}`,...timezoneComponent(tz,startYear,endYear)];
  const dtstamp=utcStamp();
  const lastModified=manifest?.publishedAt ? utcStamp(new Date(manifest.publishedAt)) : dtstamp;
  for(const item of items||[]){
    if(!item?.calendarUid || !item.date || !item.start || !item.end) continue;
    const location=locationLabel?.(item.locationId) || '';
    const description=itemDescription(item,conference);
    lines.push('BEGIN:VEVENT',`UID:${item.calendarUid}`,`DTSTAMP:${dtstamp}`,`LAST-MODIFIED:${lastModified}`,`SEQUENCE:${Number(item.sequence ?? manifest?.dataVersion ?? 0)}`,`DTSTART;TZID=${tz}:${localStamp(item.date,item.start)}`,`DTEND;TZID=${tz}:${localStamp(item.date,item.end)}`,`SUMMARY:${esc(item.title)}`);
    if(location) lines.push(`LOCATION:${esc(location)}`);
    if(description) lines.push(`DESCRIPTION:${esc(description)}`);
    if(conference.officialWebsite) lines.push(`URL:${conference.officialWebsite}`);
    if(item.status==='cancelled') lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n')+'\r\n';
}

export function downloadICS(filename, options) {
  const blob=new Blob([buildICS(options)],{type:'text/calendar;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
