// Keep the old single photograph until a successful save of the migrated gallery.
export function galleryForContact(contact){
  const photos=Array.isArray(contact?.privatePhotos)?contact.privatePhotos.filter(photo=>photo?.id&&photo.blob instanceof Blob):[];
  if(contact?.privatePhotoBlob instanceof Blob&&!photos.some(photo=>photo.id==='legacy-cover')){
    photos.unshift({id:'legacy-cover',blob:contact.privatePhotoBlob,thumbnailBlob:contact.privatePhotoBlob,caption:'',createdAt:contact.savedAt||0});
  }
  return photos.slice().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||String(a.id).localeCompare(String(b.id)));
}

export function coverPhoto(contact){
  const photos=galleryForContact(contact);
  return photos.find(photo=>photo.id===contact?.privateCoverPhotoId)||photos[0]||null;
}

export function galleryChange(contact,photos,coverId){
  const ids=new Set(photos.map(photo=>photo.id));
  return {...contact,privatePhotos:photos,privateCoverPhotoId:ids.has(coverId)?coverId:photos[0]?.id||'',privatePhotoBlob:null};
}
