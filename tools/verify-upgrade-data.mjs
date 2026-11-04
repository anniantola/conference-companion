import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const mode=process.argv[2];
if(!['prepare','verify'].includes(mode))throw new Error('Usage: node tools/verify-upgrade-data.mjs prepare|verify');
const profilePath='/tmp/conference-companion-v1217-upgrade-profile';
const urls=['https://anniantola.github.io/conference-companion/','https://anniantola.github.io/conference-test/'];
const context=await chromium.launchPersistentContext(profilePath,{headless:true});
try{
  const page=await context.newPage();
  for(const url of urls){
    await page.goto(url);
    await page.waitForFunction(()=>window.CONFERENCE_SERVICES?.userStore&&window.CONFERENCE_PACKAGE?.conference?.id);
    if(mode==='prepare'){
      await page.evaluate(async()=>{
        const store=window.CONFERENCE_SERVICES.userStore;
        await store.saveProfile({name:'v1.2.17 upgrade verification',email:'upgrade@example.org',avatarId:'av1-07'});
        const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),char=>char.charCodeAt(0));
        await store.saveFriend({id:'v1216-upgrade-contact',name:'Upgrade Friend',avatarId:'av1-12',privateNotes:'Private note survives engine update',tags:['retained'],privatePhotoBlob:new Blob([bytes],{type:'image/png'})});
      });
    }else{
      const saved=await page.evaluate(async()=>{
        const store=window.CONFERENCE_SERVICES.userStore,profile=await store.getProfile(),friends=await store.listFriends(),friend=friends.find(row=>row.id==='v1216-upgrade-contact');
        return {version:window.CONFERENCE_CONFIG.engineVersion,profile:profile.name,profileAvatarId:profile.avatarId,profileAvatarColor:profile.avatarColor,friend:friend?.name,friendAvatarId:friend?.avatarId,friendAvatarColor:friend?.avatarColor,note:friend?.privateNotes,tags:friend?.tags,photoSize:friend?.privatePhotos?.[0]?.blob?.size,cover:friend?.privateCoverPhotoId};
      });
      assert.equal(saved.version,'1.2.19');
      assert.equal(saved.profile,'v1.2.17 upgrade verification');
      assert.equal(saved.profileAvatarId,undefined);
      assert.equal(saved.profileAvatarColor,'#8264B5');
      assert.equal(saved.friend,'Upgrade Friend');
      assert.equal(saved.friendAvatarId,undefined);
      assert.equal(saved.friendAvatarColor,'#8264B5');
      assert.equal(saved.note,'Private note survives engine update');
      assert.deepEqual(saved.tags,['retained']);
      assert.ok(saved.photoSize>60);
      assert.equal(saved.cover,'legacy-cover');
    }
    console.log(`${mode}: ${url} personal profile, contact and photo ${mode==='prepare'?'saved':'preserved'}`);
  }
  await page.close();
}finally{await context.close();}
