const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(v) { return new Uint8Array([v & 255, (v >>> 8) & 255]); }
function u32(v) { return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]); }
function concat(parts) {
  const len = parts.reduce((n,p)=>n+p.length,0), out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p,o); o += p.length; }
  return out;
}
function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Blob) throw new Error('Blob must be converted before ZIP creation');
  return encoder.encode(String(value));
}
function dosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),
    day:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()
  };
}

export function createStoredZip(entries) {
  const locals=[], centrals=[];
  let offset = 0;
  const stamp = dosTimeDate();
  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/^\/+/,''));
    const data = bytes(entry.data);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
    ]);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
    ]);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralBytes = concat(centrals);
  const end = concat([
    u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(centralBytes.length),u32(offset),u16(0)
  ]);
  return new Blob([...locals, centralBytes, end], {type:'application/zip'});
}

function readU16(v,o){return v[o]|(v[o+1]<<8);}
function readU32(v,o){return (v[o]|(v[o+1]<<8)|(v[o+2]<<16)|(v[o+3]<<24))>>>0;}

export async function readStoredZip(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length > 512 * 1024 * 1024) throw new Error('ZIP file is too large');
  const entries = new Map();
  let o = 0;
  while (o + 30 <= data.length && readU32(data,o) === 0x04034b50) {
    const method = readU16(data,o+8);
    const flags = readU16(data,o+6);
    if (method !== 0 || (flags & 0x0009)) throw new Error('This ZIP uses unsupported entry encoding');
    const expectedCrc = readU32(data,o+14);
    const compressedSize = readU32(data,o+18);
    const uncompressedSize = readU32(data,o+22);
    const nameLen = readU16(data,o+26), extraLen = readU16(data,o+28);
    if (compressedSize !== uncompressedSize) throw new Error('Invalid stored ZIP entry size');
    const name = decoder.decode(data.slice(o+30,o+30+nameLen));
    const start = o+30+nameLen+extraLen, end = start+compressedSize;
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part=>part==='..') || end > data.length || start < o+30) {
      throw new Error('ZIP contains an invalid entry path or truncated file');
    }
    if (entries.has(name)) throw new Error(`ZIP contains a duplicate entry: ${name}`);
    const content=data.slice(start,end);
    if (crc32(content)!==expectedCrc) throw new Error(`ZIP entry failed its integrity check: ${name}`);
    entries.set(name, content);
    o = end;
  }
  if (!entries.size || o+4>data.length || readU32(data,o)!==0x02014b50) throw new Error('Invalid or incomplete ZIP archive');
  return entries;
}

export function textEntry(entries, name) {
  const value = entries.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return decoder.decode(value);
}
