import qrcode from './vendor/qrcode-generator/qrcode.js';

export const MAX_QR_VERSION=18;
export const QR_ERROR_CORRECTION='M';
qrcode.stringToBytes=value=>[...new TextEncoder().encode(value)];

export function qrDetails(text,{maxVersion=MAX_QR_VERSION}={}){
  const value=String(text),qr=qrcode(0,QR_ERROR_CORRECTION);
  qr.addData(value,'Byte');
  try{qr.make();}catch{throw new Error('Card is too large for a QR code. Export the full vCard instead.');}
  const version=(qr.getModuleCount()-17)/4;
  if(version>maxVersion)throw new Error('Card is too large for a reliably scannable QR code at this screen size. Export the full vCard instead.');
  return {qr,version,bytes:new TextEncoder().encode(value).length};
}

export function qrMatrix(text){
  const {qr}=qrDetails(text),size=qr.getModuleCount();
  return Array.from({length:size},(_,y)=>Array.from({length:size},(_,x)=>qr.isDark(y,x)));
}

export function drawQr(canvas,text,{scale=6,margin=4}={}){
  const matrix=qrMatrix(text), size=matrix.length, px=(size+margin*2)*scale;
  canvas.width=px;canvas.height=px;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#fff';ctx.fillRect(0,0,px,px);ctx.fillStyle='#000';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(matrix[y][x])ctx.fillRect((x+margin)*scale,(y+margin)*scale,scale,scale);
  return canvas;
}
