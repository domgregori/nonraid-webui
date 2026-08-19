// Bump alongside package.json's "version" (and the frontend's) when cutting a release. Not read
// from package.json at runtime - the deployed rig only gets backend/dist/ rsynced over, no
// package.json alongside it, so a runtime file read would just fail there.
export const VERSION = '0.0.1';
