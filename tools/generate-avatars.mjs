import {mkdir,writeFile} from 'node:fs/promises';
import {AVATAR_IDS} from '../src/avatars.js';

const backgrounds=['#e8ddfa','#d9eff0','#fae4d1','#e0ead8','#f9dce3','#dfe7fa','#f2e2ce','#d6e9e2'];
const skins=['#f6d4ba','#e9b98d','#d99c6d','#b97750','#8f573f','#6c4035'];
const hairs=['#2d2634','#553a31','#875a38','#bd814c','#302d3e','#5d3b55'];
const jackets=['#314e69','#66598c','#2e716e','#a85957','#655b51','#5069a1'];
const hairShapes=[
  '<path d="M35 63Q30 20 65 18Q98 19 94 66Q87 46 77 39Q58 47 37 43Z" fill="HAIR"/>',
  '<path d="M31 66Q31 27 48 24Q58 12 73 20Q91 18 98 49L93 70Q87 45 75 38Q48 52 36 45Z" fill="HAIR"/><circle cx="38" cy="31" r="9" fill="HAIR"/><circle cx="56" cy="21" r="9" fill="HAIR"/><circle cx="77" cy="22" r="10" fill="HAIR"/><circle cx="91" cy="37" r="8" fill="HAIR"/>',
  '<path d="M30 62Q28 18 64 17Q100 18 98 63L100 102Q90 107 85 96L84 42Q65 29 43 43L43 97Q35 107 27 100Z" fill="HAIR"/>',
  '<path d="M29 61Q28 19 64 18Q100 18 99 62L94 91Q87 95 80 88L84 43Q62 31 43 43L46 87Q37 96 31 89Z" fill="HAIR"/>',
  '<circle cx="67" cy="16" r="15" fill="HAIR"/><path d="M34 63Q30 24 61 23Q94 18 95 62L88 49Q76 39 66 34Q50 47 38 48Z" fill="HAIR"/>',
  '<path d="M33 60Q32 24 62 20Q92 20 97 54Q84 42 75 32Q59 47 37 48Z" fill="HAIR"/><path d="M91 44Q104 50 99 82Q97 94 88 96L83 42Z" fill="HAIR"/>',
  '<path d="M36 48Q40 23 63 22Q88 22 91 45Q78 39 66 31Q53 40 36 48Z" fill="HAIR"/>',
  '<path d="M35 62Q29 20 65 19Q96 20 95 61Q90 50 83 42Q58 51 38 44Z" fill="HAIR"/><path d="M88 50Q105 57 100 84Q96 95 90 92Z" fill="HAIR"/>'
];
const brow=(variant)=>variant%3===0?'<path d="M46 55l10-2M73 53l10 2" stroke="HAIR" stroke-width="2.5" stroke-linecap="round"/>':'<path d="M46 54q5-3 10-1M73 53q5-2 10 1" stroke="HAIR" stroke-width="2.5" fill="none" stroke-linecap="round"/>';

function artwork(index){
  const bg=backgrounds[index%backgrounds.length],skin=skins[(index*5+Math.floor(index/4))%skins.length],hair=hairs[(index*3+Math.floor(index/5))%hairs.length],jacket=jackets[(index*5)%jackets.length],style=index%hairShapes.length;
  const eyes=index%4===0?'<path d="M48 62q4 3 8 0M73 62q4 3 8 0" stroke="#3a3030" stroke-width="2.4" fill="none" stroke-linecap="round"/>':'<ellipse cx="52" cy="62" rx="2" ry="2.6" fill="#322a2c"/><ellipse cx="77" cy="62" rx="2" ry="2.6" fill="#322a2c"/>';
  const glasses=index%5===0?'<path d="M42 58q9-6 19 0v10q-9 8-19 0Zm26 0q9-6 19 0v10q-9 8-19 0ZM61 61h7" fill="none" stroke="#4b4d64" stroke-width="2.5"/>':'';
  const freckles=index%6===1?'<g fill="#9a5e4c" opacity=".65"><circle cx="43" cy="72" r="1"/><circle cx="47" cy="74" r="1"/><circle cx="82" cy="72" r="1"/><circle cx="86" cy="74" r="1"/></g>':'';
  const facialHair=index%7===3?'<path d="M48 76q16 21 32 0q-3 17-16 18Q52 92 48 76Z" fill="HAIR" opacity=".75"/>':'';
  const hairFront=hairShapes[style].replaceAll('HAIR',hair);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Illustrated profile avatar"><rect width="128" height="128" rx="26" fill="${bg}"/><circle cx="64" cy="57" r="51" fill="#fff" opacity=".22"/><path d="M24 128q3-34 27-38l13 9 13-9q24 4 27 38" fill="${jacket}"/><path d="M57 87h14v18q-7 9-14 0Z" fill="${skin}"/><path d="M55 94l9 12 9-12 7 34H48Z" fill="#f7f5f2"/><path d="M30 68Q25 23 63 17Q101 15 99 69L91 91H36Z" fill="${hair}"/><ellipse cx="35" cy="66" rx="5" ry="8" fill="${skin}"/><ellipse cx="93" cy="66" rx="5" ry="8" fill="${skin}"/><ellipse cx="64" cy="62" rx="29" ry="37" fill="${skin}"/>${hairFront}${brow(index).replaceAll('HAIR',hair)}${eyes}<path d="M64 65l-2 9q2 2 5 0" fill="none" stroke="#9a695b" stroke-width="1.7" stroke-linecap="round"/>${facialHair.replaceAll('HAIR',hair)}<path d="M57 81q7 5 14 0" fill="none" stroke="#954f58" stroke-width="2" stroke-linecap="round"/>${freckles}${glasses}<path d="M24 128q3-27 20-34l9 34M104 128q-3-27-20-34l-9 34" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="3"/></svg>\n`;
}

await mkdir('assets/avatars',{recursive:true});
for(const [index,id] of AVATAR_IDS.entries())await writeFile(`assets/avatars/${id}.svg`,artwork(index));
console.log(`Generated ${AVATAR_IDS.length} bundled avatars`);
