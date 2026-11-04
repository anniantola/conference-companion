export const DEFAULT_AVATAR_COLOR = '#8264B5';
export const AVATAR_PRESETS = Object.freeze([
  {name:'Iris',color:'#8264B5'},
  {name:'Ocean',color:'#397AA5'},
  {name:'Teal',color:'#287F78'},
  {name:'Jade',color:'#4E8A5B'},
  {name:'Citrus',color:'#A07A24'},
  {name:'Coral',color:'#B65F56'},
  {name:'Rose',color:'#A95078'},
  {name:'Berry',color:'#765495'},
  {name:'Slate',color:'#526579'},
  {name:'Graphite',color:'#565A60'}
]);

export function normalizeAvatarColor(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : DEFAULT_AVATAR_COLOR;
}

function rgb(hex) {
  const color = normalizeAvatarColor(hex);
  return [1,3,5].map(index => parseInt(color.slice(index,index+2),16)/255);
}

export function relativeLuminance(hex) {
  const channels = rgb(hex).map(value => value <= 0.04045 ? value/12.92 : ((value+0.055)/1.055)**2.4);
  return 0.2126*channels[0]+0.7152*channels[1]+0.0722*channels[2];
}

export function contrastRatio(first,second) {
  const a=relativeLuminance(first),b=relativeLuminance(second);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}

function toHsl(hex) {
  const [r,g,b]=rgb(hex),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  let h=0;
  if(delta){
    if(max===r)h=((g-b)/delta)%6;
    else if(max===g)h=(b-r)/delta+2;
    else h=(r-g)/delta+4;
    h=(h*60+360)%360;
  }
  return [h,(max===0||max===1)?0:delta/(1-Math.abs(2*((max+min)/2)-1)),(max+min)/2];
}

function fromHsl(h,s,l) {
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
  const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return '#'+[r,g,b].map(value=>Math.round((value+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}

export function avatarColors(value) {
  const background=normalizeAvatarColor(value),[h,s,l]=toHsl(background);
  const lighten=relativeLuminance(background)<=0.30;
  let silhouette='';
  for(let step=1;step<=200;step++){
    const next=Math.max(0,Math.min(1,l+(lighten?1:-1)*step/200));
    const candidate=fromHsl(h,s,next);
    if(contrastRatio(background,candidate)>=3){silhouette=candidate;break;}
  }
  if(!silhouette)silhouette=lighten?'#FFFFFF':'#000000';
  return {background,silhouette,contrast:contrastRatio(background,silhouette)};
}

// Strip only the retired avatar key; keep every unrelated profile/contact field intact.
export function cleanAvatarRecord(record) {
  if(!record||typeof record!=='object'||Array.isArray(record))return record;
  const clean={...record};
  delete clean.avatarId;
  clean.avatarColor=normalizeAvatarColor(record.avatarColor);
  return clean;
}
