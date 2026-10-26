export const synthetic91Headers=['date','start','end','type','session','title','speaker','chair','affiliation','room','track','posterNumber'];
const clock=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;

export function createSynthetic91Records(){
  const records=[];
  // 55 talks include four parallel talks in the same slots on each day.
  for(let i=0;i<55;i++){
    const day=i<28?'2031-06-10':'2031-06-11',slot=Math.floor((i%28)/4),start=9*60+slot*30;
    records.push({date:day,start:clock(start),end:clock(start+20),type:'talk',session:`Research track ${Math.floor((i%28)/14)+1}`,
      title:`Synthetic talk ${String(i+1).padStart(2,'0')}`,speaker:`Researcher ${String(i%22+1).padStart(2,'0')}`,
      chair:`Researcher ${String((i+7)%22+1).padStart(2,'0')}`,affiliation:`Institute ${i%22+1}`,room:`Room ${i%4+1}`,track:`Track ${i%4+1}`,posterNumber:''});
  }
  // Repeated breaks, meals and social items exercise ordinary repeated event names.
  for(let i=0;i<18;i++){
    const day=i<9?'2031-06-10':'2031-06-11',offset=i%9,start=11*60+offset*35;
    const type=offset<5?'break':offset<7?'meal':'social';
    const title=type==='break'?'Coffee break':type==='meal'?'Lunch':'Evening reception';
    records.push({date:day,start:clock(start),end:clock(start+(type==='break'?15:45)),type,session:`${type} ${offset+1}`,
      title,speaker:'',chair:'',affiliation:'',room:offset%2?'Foyer East':'Foyer West',track:'Common',posterNumber:''});
  }
  // All 18 posters share a session time and venue but are distinct records.
  for(let i=0;i<18;i++)records.push({date:'2031-06-11',start:'14:00',end:'16:00',type:'poster',session:'Poster Exhibition',
    title:`Synthetic poster ${String(i+1).padStart(2,'0')}`,speaker:'Researcher 23',chair:'',
    affiliation:'Poster institute',room:'Poster Hall',track:'Posters',posterNumber:`P${String(i+1).padStart(2,'0')}`});
  return records;
}

export function synthetic91Csv(records=createSynthetic91Records()){
  return [synthetic91Headers.join(','),...records.map(row=>synthetic91Headers.map(key=>`"${String(row[key]??'').replaceAll('"','""')}"`).join(','))].join('\n');
}
