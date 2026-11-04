import {personActivities,validConferenceIdentity} from './friend-directory.js';

export function aggregateFriendActivities(friends,conference,model){
  const rows=new Map();
  for(const friend of friends||[]){
    const identity=validConferenceIdentity(friend.conferenceIdentity,conference,model);
    if(!identity)continue;
    for(const activity of personActivities(identity.personId,model)){
      const key=`${activity.type}:${activity.id}`;
      if(!rows.has(key))rows.set(key,{...activity,friends:[]});
      if(!rows.get(key).friends.some(item=>item.id===friend.id))rows.get(key).friends.push({id:friend.id,name:friend.name||'Contact',avatarColor:friend.avatarColor,privateCoverPhotoId:friend.privateCoverPhotoId});
    }
  }
  return [...rows.values()].sort((a,b)=>`${a.date||'9999-12-31'}|${a.start||'99:99'}|${a.type}|${a.id}`.localeCompare(`${b.date||'9999-12-31'}|${b.start||'99:99'}|${b.type}|${b.id}`));
}
