// Which screen the app is showing. The 56px icon row this file used to render
// on Home and the project page is gone since Phase 8: the always-on rail
// (components/Rail/) carries the Home and Workspace icons on every screen, so
// only the screen type is left here.

export type Screen = 'home' | 'workspace' | 'project';
