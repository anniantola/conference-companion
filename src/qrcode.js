const VERSION_INFO = {
  1:{size:21,data:19,ecc:7,blocks:[19],align:[]},
  2:{size:25,data:34,ecc:10,blocks:[34],align:[6,18]},
  3:{size:29,data:55,ecc:15,blocks:[55],align:[6,22]},
  4:{size:33,data:80,ecc:20,blocks:[80],align:[6,26]},
  5:{size:37,data:108,ecc:26,blocks:[108],align:[6,30]},
  6:{size:41,data:136,ecc:18,blocks:[68,68],align:[6,34]}
};
const CAPACITY={1:17,2:32,3:53,4:78,5:106,6:134};

const EXP=new Uint8Array(512), LOG=new Uint8Array(256);
let x=1;
for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}
for(let i=255;i<512;i++)EXP[i]=EXP[i-255];
function gfMul(a,b){return !a||!b?0:EXP[LOG[a]+LOG[b]];}

function generator(degree){
  let poly=[1];
  for(let i=0;i<degree;i++){
    const next=new Array(poly.length+1).fill(0);
    for(let j=0;j<poly.length;j++){
      next[j]^=poly[j];
      next[j+1]^=gfMul(poly[j],EXP[i]);
    }
    poly=next;
  }
  return poly;
}
function rsRemainder(data,eccCount){
  const gen=generator(eccCount), msg=[...data,...new Array(eccCount).fill(0)];
  for(let i=0;i<data.length;i++){
    const factor=msg[i]; if(!factor) continue;
    for(let j=0;j<gen.length;j++) msg[i+j]^=gfMul(gen[j],factor);
  }
  return msg.slice(data.length);
}

function pushBits(out,value,length){for(let i=length-1;i>=0;i--)out.push((value>>>i)&1);}
function chooseVersion(length){for(let v=1;v<=6;v++)if(length<=CAPACITY[v])return v;throw new Error('Contact card is too large for the built-in QR encoder');}
function makeData(text,version){
  const info=VERSION_INFO[version], input=[...new TextEncoder().encode(text)], bits=[];
  pushBits(bits,0b0100,4); pushBits(bits,input.length,8);
  for(const b of input)pushBits(bits,b,8);
  const maxBits=info.data*8;
  for(let i=0;i<Math.min(4,maxBits-bits.length);i++)bits.push(0);
  while(bits.length%8)bits.push(0);
  const data=[]; for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|(bits[i+j]||0);data.push(b);}
  let pad=0; while(data.length<info.data){data.push(pad++%2?0x11:0xec);}
  const blocks=[], eccBlocks=[]; let pos=0;
  for(const len of info.blocks){const block=data.slice(pos,pos+len);pos+=len;blocks.push(block);eccBlocks.push(rsRemainder(block,info.ecc));}
  const out=[];
  const maxData=Math.max(...blocks.map(b=>b.length));
  for(let i=0;i<maxData;i++)for(const b of blocks)if(i<b.length)out.push(b[i]);
  for(let i=0;i<info.ecc;i++)for(const e of eccBlocks)out.push(e[i]);
  return out;
}

function bchDigit(data){let digit=0;while(data){digit++;data>>>=1;}return digit;}
function formatBits(mask=0){
  const G15=0x537, MASK=0x5412;
  const data=(1<<3)|mask; // EC level L = 01
  let d=data<<10;
  while(bchDigit(d)-bchDigit(G15)>=0)d^=G15<<(bchDigit(d)-bchDigit(G15));
  return ((data<<10)|d)^MASK;
}
function setFormat(m,mask=0){
  const size=m.length,bits=formatBits(mask);
  for(let i=0;i<15;i++){
    const mod=((bits>>i)&1)===1;
    if(i<6)m[i][8]=mod; else if(i<8)m[i+1][8]=mod; else m[size-15+i][8]=mod;
    if(i<8)m[8][size-i-1]=mod; else if(i<9)m[8][15-i]=mod; else m[8][15-i-1]=mod;
  }
  m[size-8][8]=true;
}
function finder(m,row,col){
  const size=m.length;
  for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){
    const y=row+r,x=col+c;if(y<0||x<0||y>=size||x>=size)continue;
    const dark=r>=0&&r<=6&&c>=0&&c<=6&&(r===0||r===6||c===0||c===6||(r>=2&&r<=4&&c>=2&&c<=4));
    m[y][x]=!!dark;
  }
}
function alignment(m,centerY,centerX){
  if(m[centerY][centerX]!==null)return;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)m[centerY+dy][centerX+dx]=Math.max(Math.abs(dx),Math.abs(dy))!==1;
}
function setupPatterns(m,version){
  const size=m.length, info=VERSION_INFO[version];
  finder(m,0,0);finder(m,size-7,0);finder(m,0,size-7);
  for(let i=8;i<size-8;i++){
    if(m[6][i]===null)m[6][i]=i%2===0;
    if(m[i][6]===null)m[i][6]=i%2===0;
  }
  for(const y of info.align)for(const x of info.align)alignment(m,y,x);
  m[4*version+9][8]=true;
  setFormat(m,0);
}
function mapData(m,codewords){
  const size=m.length;let bitIndex=0,row=size-1,inc=-1;
  for(let col=size-1;col>0;col-=2){
    if(col===6)col--;
    while(true){
      for(let c=0;c<2;c++){
        const x=col-c;
        if(m[row][x]!==null)continue;
        const byte=codewords[bitIndex>>>3]||0;
        let dark=((byte>>>(7-(bitIndex&7)))&1)===1;
        if((row+x)%2===0)dark=!dark; // mask pattern 0
        m[row][x]=dark;bitIndex++;
      }
      row+=inc;
      if(row<0||row>=size){row-=inc;inc=-inc;break;}
    }
  }
}

export function qrMatrix(text){
  const length=new TextEncoder().encode(String(text)).length,version=chooseVersion(length),info=VERSION_INFO[version];
  const m=Array.from({length:info.size},()=>Array(info.size).fill(null));
  setupPatterns(m,version);mapData(m,makeData(String(text),version));setFormat(m,0);
  return m;
}

export function drawQr(canvas,text,{scale=6,margin=4}={}){
  const matrix=qrMatrix(text), size=matrix.length, px=(size+margin*2)*scale;
  canvas.width=px;canvas.height=px;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#fff';ctx.fillRect(0,0,px,px);ctx.fillStyle='#000';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(matrix[y][x])ctx.fillRect((x+margin)*scale,(y+margin)*scale,scale,scale);
  return canvas;
}
