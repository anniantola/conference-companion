import assert from 'node:assert/strict';
import {createConferenceModel} from '../src/model.js';
import {identityCandidates,automaticIdentity,personActivities,validConferenceIdentity} from '../src/friend-directory.js';
import {findMatchingFriend,mergeFriendContact} from '../src/friend-contact.js';
import {profileToVCard,parseVCard} from '../src/vcard.js';
import {createPersonalBackup,parsePersonalBackup} from '../src/backup.js';
import {encodeStoredValue,decodeStoredValue} from '../src/user-store.js';
import {galleryForContact} from '../src/friend-gallery.js';

const conference={id:'meeting-a',timezone:'Europe/Helsinki'};
const people={people:[
  {id:'p-1',name:'Alex Example',affiliations:['Science Lab'],orcid:'0000-0000-0000-0001',publicEmail:'alex@example.org',photoUrl:'assets/person-p-1.jpg'},
  {id:'p-2',name:'Alex Example',affiliations:['Science Lab'],orcid:'0000-0000-0000-0002',publicEmail:'alex.other@example.org'},
  {id:'p-3',name:'Robin Example',affiliations:['Other Lab'],orcid:'0000-0000-0000-0003',publicEmail:'robin@example.org'}
]};
const programme={tracks:[],sessions:[
  {id:'s-1',title:'Science session',date:'2027-10-01',start:'10:00',end:'11:00',chairIds:['p-1'],presentationIds:['t-1'],locationId:'hall'},
  {id:'s-2',title:'Poster session',type:'poster-session',date:'2027-10-01',start:'14:00',end:'15:00',chairIds:[],presentationIds:[],locationId:'lobby'}
],presentations:[{id:'t-1',title:'Talk',speakerIds:['p-1'],start:'10:15',end:'10:45'}],posters:[{id:'o-1',title:'Poster',number:'42',authorIds:['p-1'],posterSessionId:'s-2'}]};
const pkg={conference,people,programme,locations:{locations:[{id:'hall',name:'Hall'},{id:'lobby',name:'Lobby'}]}};
const model=createConferenceModel(pkg);
const contact={name:'Alex Example',affiliation:'Science Lab',email:'alex@example.org',orcid:'0000-0000-0000-0001'};
assert.deepEqual(automaticIdentity(contact,conference,model),{conferenceId:'meeting-a',personId:'p-1'});
assert.equal(automaticIdentity({name:'Alex Example',affiliation:'Science Lab'},conference,model),null);
assert.equal(automaticIdentity({name:'Alex Example',affiliation:'Science Lab',claimedConferenceIdentity:{conferenceId:'meeting-a',personId:'p-1'}},conference,model,{external:true}),null);
assert.equal(identityCandidates({name:'Alex Example',affiliation:'Science Lab'},conference,model).length,2);
assert.equal(automaticIdentity({...contact,claimedConferenceIdentity:{conferenceId:'meeting-a',personId:'p-2'}},conference,model,{external:true}),null);
assert.equal(validConferenceIdentity({conferenceId:'another-meeting',personId:'p-1'},conference,model),null);
assert.equal(validConferenceIdentity({conferenceId:'meeting-a',personId:'unknown'},conference,model),null);
const activities=personActivities('p-1',model);
assert.deepEqual(activities.map(activity=>activity.role),['Session chair','Oral presentation','Poster presentation']);
assert.equal(activities.find(x=>x.type==='poster').posterNumber,'42');
assert.equal(activities.find(x=>x.type==='event').locationId,'hall');
programme.presentations[0].start='10:30';
assert.equal(personActivities('p-1',createConferenceModel(pkg)).find(x=>x.type==='event').start,'10:30');
assert.deepEqual(personActivities('p-3',model),[]);

const identity={conferenceId:'meeting-a',personId:'p-1'};
const card=profileToVCard(contact,{conferenceIdentity:identity});
assert.deepEqual(parseVCard(card).claimedConferenceIdentity,identity);
assert.ok(!profileToVCard(contact).includes('X-CONFERENCE-COMPANION'));
const first=mergeFriendContact(null,{...contact,conferenceIdentity:identity});
first.privateNotes='Met after talk';first.tags=['friend'];first.privatePhotoBlob=new Blob([Buffer.from('ffd8ffe0','hex')],{type:'image/jpeg'});
const compact=parseVCard(profileToVCard({name:contact.name,email:contact.email},{compact:true}));
const matched=findMatchingFriend([first],compact);
assert.equal(matched?.id,first.id);
const rescanned=mergeFriendContact(matched,compact);
assert.deepEqual(rescanned.conferenceIdentity,identity);
assert.equal(rescanned.privateNotes,'Met after talk');
assert.equal(rescanned.privatePhotoBlob,first.privatePhotoBlob);
assert.equal(findMatchingFriend([first],{name:contact.name,affiliation:contact.affiliation}),null);
const stored=decodeStoredValue(await encodeStoredValue(rescanned));
assert.deepEqual(new Uint8Array(await stored.privatePhotoBlob.arrayBuffer()),new Uint8Array(await first.privatePhotoBlob.arrayBuffer()));
const backup=await createPersonalBackup({conferenceId:conference.id,state:{favorites:[],posterFavorites:[],notes:{}},profile:{name:'Me'},friends:[rescanned],photos:[]});
const restored=(await parsePersonalBackup(backup)).payload.friends[0];
assert.deepEqual(restored.conferenceIdentity,identity);
assert.equal(restored.privateNotes,'Met after talk');
assert.deepEqual(new Uint8Array(await galleryForContact(restored)[0].blob.arrayBuffer()),new Uint8Array(await first.privatePhotoBlob.arrayBuffer()));
console.log('Friend directory identity, live activities, vCard, binary storage and backup regressions passed');
