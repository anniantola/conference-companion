// Shared conference color rules for Builder, the attendee app, and presentations.
export const DAY_PALETTE=['#397AA5','#2F806B','#9A6240','#725AA5','#A94E62','#6B772D','#A36A1E','#327F91'];

export function hexColor(value,fallback=''){
  const text=String(value||'').trim();
  return /^#[0-9a-f]{6}$/i.test(text)?text.toUpperCase():fallback;
}

export function automaticDayColor(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return DAY_PALETTE[0];
  const day=Math.floor(Date.parse(`${date}T00:00:00Z`)/86400000);
  return Number.isFinite(day)?DAY_PALETTE[((day%DAY_PALETTE.length)+DAY_PALETTE.length)%DAY_PALETTE.length]:DAY_PALETTE[0];
}

export function resolveDayColor(branding,date){
  return hexColor(branding?.dayColors?.[date],automaticDayColor(date));
}

export function conferenceDates(conference){
  const start=String(conference?.startDate||''),end=String(conference?.endDate||start);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return[];
  const first=Date.parse(`${start}T00:00:00Z`),last=Date.parse(`${end}T00:00:00Z`);
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<first||last-first>90*86400000)return[];
  return Array.from({length:(last-first)/86400000+1},(_,index)=>new Date(first+index*86400000).toISOString().slice(0,10));
}

function channels(color){const hex=hexColor(color,'#000000');return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function rgbHex(rgb){return '#'+rgb.map(value=>Math.max(0,Math.min(255,Math.round(value))).toString(16).padStart(2,'0')).join('').toUpperCase();}
export function blendColor(a,b,t){const x=channels(a),y=channels(b);return rgbHex(x.map((value,i)=>value+(y[i]-value)*t));}
export function contrastRatio(a,b){
  const luminance=color=>{const [r,g,b]=channels(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
  const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function readableColor(color,background,minimum=4.5){
  const original=hexColor(color,'#667085'),bg=hexColor(background,'#FFFFFF');
  if(contrastRatio(original,bg)>=minimum)return original;
  const toward=contrastRatio('#FFFFFF',bg)>contrastRatio('#000000',bg)?'#FFFFFF':'#000000';
  let low=0,high=1;
  for(let i=0;i<18;i++){const middle=(low+high)/2;if(contrastRatio(blendColor(original,toward,middle),bg)>=minimum)high=middle;else low=middle;}
  return blendColor(original,toward,high);
}
export function foregroundOn(background){return contrastRatio(background,'#FFFFFF')>=contrastRatio(background,'#111827')?'#FFFFFF':'#111827';}

const FONT_NAMES={inter:'Inter','source-sans-3':'Source Sans 3','space-grotesk':'Space Grotesk','ibm-plex-sans':'IBM Plex Sans','ibm-plex-sans-condensed':'IBM Plex Sans Condensed','noto-serif':'Noto Serif'};
export function brandingFont(key,fallback='Aptos'){return FONT_NAMES[key]||fallback;}

export function presentationPalette(branding,appearance='light'){
  const dark=appearance==='dark';
  const bg=dark?'#111820':'#F7F9FB',surface=dark?'#1C2730':'#FFFFFF';
  const ink=dark?'#F7FAFC':'#17232C',muted=dark?'#C1CCD4':'#4A5B67';
  const primary=hexColor(branding?.primary,'#5B4B9A'),secondary=hexColor(branding?.secondary,'#2F7D68'),accent=hexColor(branding?.accent,primary);
  const header=hexColor(dark?branding?.headerBackgroundDark:branding?.headerBackgroundLight,dark?'#191A1D':'#FFFFFF');
  return {appearance,dark,bg,surface,ink,muted,header,headerInk:foregroundOn(header),primary,secondary,accent,
    primaryText:readableColor(primary,surface),secondaryText:readableColor(secondary,surface),accentText:readableColor(accent,surface),
    headingFont:brandingFont(branding?.headingFont,'Aptos Display'),bodyFont:brandingFont(branding?.bodyFont,'Aptos')};
}
