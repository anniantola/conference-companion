import assert from 'node:assert/strict';
import {createConferenceModel} from '../src/model.js';
import {AVATAR_PRESETS,DEFAULT_AVATAR_COLOR,avatarColors,cleanAvatarRecord,contrastRatio,normalizeAvatarColor} from '../src/avatar-color.js';
import {galleryForContact,coverPhoto,galleryChange} from '../src/friend-gallery.js';
import {aggregateFriendActivities} from '../src/friend-activities.js';
import {automaticIdentity} from '../src/friend-directory.js';
import {profileToVCard,parseVCard,sharedFieldLabels} from '../src/vcard.js';
import {createPersonalBackup,parsePersonalBackup} from '../src/backup.js';
import {encodeStoredValue,decodeStoredValue} from '../src/user-store.js';
import {createStoredZip} from '../src/zip.js';

assert.equal(AVATAR_PRESETS.length,10);
assert.equal(normalizeAvatarColor('#8264b5'),'#8264B5');
assert.equal(normalizeAvatarColor('#fff'),'#8264B5');
assert.equal(normalizeAvatarColor('red'),'#8264B5');
for(const color of ['#000000','#FFFFFF','#FF00FF','#00FFFF','#FFFF00',...AVATAR_PRESETS.map(row=>row.color)]){
  const avatar=avatarColors(color);
  assert.equal(avatar.background,normalizeAvatarColor(color));
  assert.ok(contrastRatio(avatar.background,avatar.silhouette)>=3,`${color} contrast was ${avatar.contrast}`);
  assert.deepEqual(avatarColors(color),avatarColors(color),'A color must render deterministically');
}
assert.ok(avatarColors('#000000').silhouette!=='#000000');
assert.ok(avatarColors('#FFFFFF').silhouette!=='#FFFFFF');
const source={name:'Example Scientist',avatarColor:'#397AA5',email:'scientist@demo.example',bio:'Materials & memory',papers:['Paper | 10.1000/abc']};
for(const compact of [true,false]){
  const card=profileToVCard(source,{compact});
  assert.match(card,/X-CONFERENCE-COMPANION-AVATAR-COLOR:#397AA5/);
  assert.equal(parseVCard(card).avatarColor,'#397AA5');
  assert.equal(card.includes('X-PAPER:'),!compact);
}
assert.ok(sharedFieldLabels(source,{compact:true}).includes('Avatar'));
assert.equal(parseVCard('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Old contact\r\nEND:VCARD').avatarColor,undefined);
assert.equal(parseVCard(profileToVCard(source).replace('#397AA5','#12AB')).avatarColor,DEFAULT_AVATAR_COLOR);
const oldCard=parseVCard('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Old contact\r\nX-CONFERENCE-COMPANION-AVATAR:av1-07\r\nEND:VCARD');
assert.equal(oldCard.avatarId,undefined);
assert.equal(oldCard.avatarColor,undefined);
assert.deepEqual(cleanAvatarRecord({name:'Kept',avatarId:'av1-07',privateNotes:'Private',privatePhotos:[{id:'photo'}]}),{
  name:'Kept',avatarColor:DEFAULT_AVATAR_COLOR,privateNotes:'Private',privatePhotos:[{id:'photo'}]
});

const conference={id:'meeting',timezone:'Europe/Helsinki'};
const people={people:[
  {id:'p1',name:'Same Name',affiliations:['North Lab'],orcid:'0000-0000-0000-001X',publicEmail:'a@demo.example'},
  {id:'p2',name:'Same Name',affiliations:['South Lab'],orcid:'0000-0000-0000-0028',publicEmail:'b@demo.example'}
]};
const programme={tracks:[],sessions:[{id:'s1',title:'Joint session',date:'2027-11-08',start:'09:00',end:'10:00',locationId:'room',chairIds:['p1'],presentationIds:['t1','t2']}],presentations:[
  {id:'t1',title:'Joint paper',speakerIds:['p1','p2'],start:'09:05',end:'09:30'},
  {id:'t2',title:'Second paper',speakerIds:['p1'],start:'09:35',end:'09:55'}
],posters:[]};
const pkg={conference,people,programme,locations:{locations:[{id:'room',name:'Room'}]}};
const model=createConferenceModel(pkg);
assert.deepEqual(automaticIdentity({orcid:'0000-0000-0000-001X',claimedConferenceIdentity:{conferenceId:'meeting',personId:'p1'}},conference,model,{external:true}),{conferenceId:'meeting',personId:'p1'});
assert.equal(automaticIdentity({orcid:'0000-0000-0000-001X',claimedConferenceIdentity:{conferenceId:'meeting',personId:'p2'}},conference,model,{external:true}),null);
assert.equal(automaticIdentity({name:'Same Name'},conference,model,{external:true}),null);
const friends=[{id:'f1',name:'Friend A',conferenceIdentity:{conferenceId:'meeting',personId:'p1'}},{id:'f2',name:'Friend B',conferenceIdentity:{conferenceId:'meeting',personId:'p2'}}];
let all=aggregateFriendActivities(friends,conference,model);
assert.equal(all.length,3);
assert.deepEqual(all.find(row=>row.id==='t1').friends.map(row=>row.name),['Friend A','Friend B']);
assert.equal(all.find(row=>row.id==='t2').friends.length,1);
assert.equal(aggregateFriendActivities([{id:'foreign',conferenceIdentity:{conferenceId:'other',personId:'p1'}}],conference,model).length,0);
programme.presentations[0].start='09:20';
all=aggregateFriendActivities(friends,conference,createConferenceModel(pkg));
assert.equal(all.find(row=>row.id==='t1').start,'09:20');

const legacyBlob=new Blob([Buffer.from('ffd8ffe00001','hex')],{type:'image/jpeg'});
const old={id:'legacy',name:'Met Scientist',privatePhotoBlob:legacyBlob,privateNotes:'Private',tags:['met'],conferenceIdentity:{conferenceId:'meeting',personId:'p1'}};
assert.equal(galleryForContact(old).length,1);
const migrated=galleryChange(old,galleryForContact(old),'legacy-cover');
assert.equal(galleryForContact(migrated).length,1);
assert.equal(coverPhoto(migrated).id,'legacy-cover');
const second={id:'photo-2',blob:legacyBlob,thumbnailBlob:legacyBlob,caption:'Conference dinner',createdAt:2};
const gallery=galleryChange(migrated,[...galleryForContact(migrated),second],second.id);
assert.equal(coverPhoto(gallery).id,second.id);
const stored=decodeStoredValue(await encodeStoredValue(gallery));
assert.equal((await stored.privatePhotos[1].blob.arrayBuffer()).byteLength,legacyBlob.size);
const backup=await createPersonalBackup({conferenceId:'meeting',state:{favorites:[],posterFavorites:[],notes:{}},profile:source,friends:[gallery],photos:[]});
const parsed=(await parsePersonalBackup(backup)).payload;
assert.equal(parsed.version,5);
assert.equal(parsed.friends[0].privatePhotos.length,2);
assert.equal(parsed.friends[0].privatePhotos[1].caption,'Conference dinner');
assert.equal(parsed.friends[0].privateCoverPhotoId,second.id);
assert.equal(parsed.friends[0].privateNotes,'Private');
assert.deepEqual(parsed.friends[0].conferenceIdentity,{conferenceId:'meeting',personId:'p1'});
const repeat=await createPersonalBackup({conferenceId:'meeting',state:parsed.state,profile:parsed.profile,friends:parsed.friends,photos:[]});
assert.equal((await parsePersonalBackup(repeat)).payload.friends[0].privatePhotos.length,2);
const oldBackup=createStoredZip([
  {name:'backup.json',data:JSON.stringify({format:'conference-companion-backup',version:4,conferenceId:'meeting',state:{favorites:[],posterFavorites:[],notes:{}},profile:{name:'Old',avatarId:'retired-value'},friends:[{id:'legacy',name:'Legacy',avatarId:'retired-value',privatePhoto:{file:'contacts/legacy.jpg',type:'image/jpeg'},privateNotes:'Do not lose'}],photos:[]})},
  {name:'contacts/legacy.jpg',data:new Uint8Array(await legacyBlob.arrayBuffer())}
]);
const oldRestored=(await parsePersonalBackup(oldBackup)).payload.friends[0];
assert.equal(galleryForContact(oldRestored).length,1);
assert.equal(galleryForContact(oldRestored)[0].id,'legacy-cover');
assert.equal(oldRestored.privateNotes,'Do not lose');
assert.equal(oldRestored.avatarId,undefined);
assert.equal(oldRestored.avatarColor,DEFAULT_AVATAR_COLOR);
const oldProfile=(await parsePersonalBackup(oldBackup)).payload.profile;
assert.equal(oldProfile.avatarId,undefined);
assert.equal(oldProfile.avatarColor,DEFAULT_AVATAR_COLOR);
await assert.rejects(createPersonalBackup({conferenceId:'meeting',state:{},profile:{},friends:[{id:'bad',name:'Bad photo',privatePhotos:[{id:'broken',blob:{}}]}],photos:[]}),/cannot be backed up/);
console.log('Friend avatar, gallery, identity, activity and backup improvements passed');
