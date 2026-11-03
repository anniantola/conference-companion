// Versioned IDs are shared by every conference deployment. Never recycle an ID.
export const AVATAR_VERSION='av1';
export const AVATAR_IDS=Object.freeze(Array.from({length:24},(_,index)=>`av1-${String(index+1).padStart(2,'0')}`));
const known=new Set(AVATAR_IDS);

export function normalizeAvatarId(value){return typeof value==='string'&&known.has(value)?value:'';}
export function avatarAssetPath(value){const id=normalizeAvatarId(value);return id?`./assets/avatars/${id}.svg`:'';}
