import assert from 'node:assert/strict';
import {publicationParts,publicationText} from '../src/publications.js';
import {profileToVCard,compactProfileVCard,parseVCard,sharedFieldLabels} from '../src/vcard.js';
import {qrDetails,qrMatrix,MAX_QR_VERSION} from '../src/qrcode.js';
import {findMatchingFriend,mergeFriendContact} from '../src/friend-contact.js';
import {createPersonalBackup,parsePersonalBackup} from '../src/backup.js';

for(const reference of ['10.1234/alpha.beta','doi:10.1234/alpha.beta','https://doi.org/10.1234/alpha.beta'])
  assert.equal(publicationParts(reference).url,'https://doi.org/10.1234/alpha.beta');
assert.equal(publicationParts('https://publisher.example/paper?q=1').url,'https://publisher.example/paper?q=1');
assert.deepEqual(publicationParts('A titled paper | doi:10.1234/alpha.beta'),{label:'A titled paper',url:'https://doi.org/10.1234/alpha.beta'});
assert.equal(publicationParts('A plain title').url,'');
for(const unsafe of ['javascript:alert(1)','http://publisher.example/paper','https://user:pass@publisher.example/paper','https://publisher.example/\nscript'])
  assert.equal(publicationParts(unsafe).url,'');
assert.equal(publicationParts({title:'Safe label',url:'javascript:alert(1)'}).url,'');
assert.equal(publicationText({title:'Named result',doi:'10.1234/alpha.beta'}),'Named result | https://doi.org/10.1234/alpha.beta');

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const profile={name:'Zoë Ångström',position:'Senior Researcher',affiliation:'Université des Sciences',affiliations:['Université des Sciences','Second Lab'],email:'zoe@example.org',emails:['zoe@example.org','zoe2@example.org'],orcid:'0000-0000-0000-0001',website:'https://example.org/zoe',linkedin:'https://www.linkedin.com/in/zoe',bio:'Studies λ networks; private? No, public bio.',papers:['A titled paper | doi:10.1234/alpha.beta','https://publisher.example/paper','A plain title'],links:[{label:'Lab profile',url:'https://lab.example/zoe'}],privateNotes:'Never share this',tags:['secret'],metAt:'Private meeting',photoBlob:new Blob([png],{type:'image/png'})};
const compact=compactProfileVCard(profile),full=profileToVCard(profile);
assert.ok(new TextEncoder().encode(compact).length>134,'Compact QR tests should exceed the old encoder limit');
for(const text of [compact,full]){
  assert.ok(text.includes('FN:Zoë Ångström'));
  assert.ok(!/Never share this|secret|Private meeting|image/.test(text));
  if(text===compact||new TextEncoder().encode(text).length<700){
    assert.ok(qrDetails(text).version<=MAX_QR_VERSION);
    assert.equal(qrMatrix(text).length,qrDetails(text).qr.getModuleCount());
  }else assert.throws(()=>qrDetails(text),/reliably scannable|too large/,'An oversized Full card must offer vCard export rather than truncate');
}
assert.ok(!/LinkedIn|NOTE:|X-PAPER|Second Lab|zoe2@example/.test(compact));
assert.ok(/LinkedIn|NOTE:|X-PAPER|Second Lab|zoe2@example/.test(full));
assert.deepEqual(sharedFieldLabels(profile,{compact:true}),['Name','Avatar','Position','Affiliation','Email','ORCID','Website']);
assert.ok(sharedFieldLabels(profile).includes('Selected papers'));
const received=parseVCard(full),compactReceived=parseVCard(compact);
for(const field of ['name','position','email','orcid','website','linkedin','bio'])assert.equal(received[field],profile[field]);
assert.deepEqual(received.emails,profile.emails);
assert.deepEqual(received.affiliations,profile.affiliations);
assert.deepEqual(received.papers,['A titled paper | https://doi.org/10.1234/alpha.beta','https://publisher.example/paper','A plain title']);
assert.deepEqual(received.links,profile.links);
assert.equal(compactReceived.position,profile.position);
assert.equal(compactReceived.affiliation,profile.affiliation);
assert.equal(compactReceived.orcid,profile.orcid);
assert.equal(compactReceived.linkedin,undefined);
assert.throws(()=>profileToVCard({...profile,papers:[{title:'Malicious',url:'javascript:alert(1)'}]}),/Paper link/);
assert.throws(()=>qrDetails('A'.repeat(2000)),/reliably scannable/);
const longCompact=compactProfileVCard({...profile,name:'A'.repeat(2000)});
assert.ok(longCompact.includes('A'.repeat(2000)),'Compact card must not silently truncate required fields');
assert.throws(()=>qrDetails(longCompact),/reliably scannable|too large/);

const first=mergeFriendContact(null,received,{conferenceId:'sample',conferenceName:'Sample event'});
first.privateNotes='Keep my notes';first.tags=['collaborator'];first.metAt='Dinner';first.metAtEventId='talk-1';
const same=findMatchingFriend([first],compactReceived);
assert.equal(same?.id,first.id);
const afterCompact=mergeFriendContact(same,compactReceived);
for(const field of ['linkedin','bio','website','position','orcid'])assert.equal(afterCompact[field],first[field]);
assert.deepEqual(afterCompact.papers,first.papers);
assert.equal(afterCompact.privateNotes,'Keep my notes');
assert.deepEqual(afterCompact.tags,['collaborator']);
assert.equal(afterCompact.metAt,'Dinner');
assert.equal(afterCompact.metAtEventId,'talk-1');
assert.equal(afterCompact.id,first.id);
const afterFull=mergeFriendContact(afterCompact,received);
assert.deepEqual(afterFull.papers,received.papers);
assert.deepEqual(afterFull.emails,received.emails);
assert.equal(findMatchingFriend([first],{name:first.name,affiliation:first.affiliation,email:'different@example.org'}),null);
assert.equal(findMatchingFriend([first],{name:'Another person',email:first.email}),null);
assert.equal(findMatchingFriend([first,{...first,id:'another'}],{name:first.name,affiliation:first.affiliation}),null);
assert.equal(findMatchingFriend([first],{name:first.name,affiliation:'Different Lab'}),null);
assert.equal(findMatchingFriend([first],{name:first.name,orcid:first.orcid,email:'new@example.org'})?.id,first.id);

const legacy=parseVCard('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Legacy Person\r\nORG:Old Lab\r\nEMAIL:legacy@example.org\r\nURL:https://example.org\r\nX-PAPER:10.1234/old\r\nEND:VCARD');
assert.equal(legacy.website,'https://example.org/');
assert.equal(publicationParts(legacy.papers[0]).url,'https://doi.org/10.1234/old');
const backup=await createPersonalBackup({conferenceId:'sample',state:{favorites:[],notes:{}},profile,friends:[afterCompact],photos:[]});
const restored=await parsePersonalBackup(backup);
assert.equal(restored.payload.friends[0].privateNotes,'Keep my notes');
assert.deepEqual(restored.payload.friends[0].papers,received.papers);
assert.equal(restored.payload.profile.name,profile.name);
console.log('Friend card, QR capacity, merge and backup regressions passed');
