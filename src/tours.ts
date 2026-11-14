// The one-time tours (AFT-103): which ones this copy has already shown, kept in
// prefs.json as `toursSeen: ["loops"]`. Pure, so main (which reads and writes
// prefs.json) and the tests share it.
//
// A tour shows once, on the first launch of a version that has it (an update or a
// fresh install), and never again after Done or Skip. Quitting in the middle of a
// tour does not count as seen: it shows again on the next launch. "Take the tour"
// in the About window replays it whatever this list says.

export type TourId = 'loops';
export const TOUR_IDS: readonly TourId[] = ['loops'];

// What prefs.json says, cleaned: only known tour ids, each once, in order. Anything
// else (a hand edit, a missing key, a wrong type) is read as nothing seen yet for
// that tour.
export function toursSeenFrom(prefs: { toursSeen?: unknown } | null | undefined): TourId[] {
  const raw = prefs?.toursSeen;
  if (!Array.isArray(raw)) return [];
  const out: TourId[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && (TOUR_IDS as readonly string[]).includes(v) && !out.includes(v as TourId)) out.push(v as TourId);
  }
  return out;
}

// What main answers when the app asks which tours were seen: the list, or null when
// prefs.json could not be read (AFT-111). A file that does not parse is never
// overwritten, so Done or Skip could not be saved and the tour would show at every
// launch; null means "unknown", and the tour does not show.
export function seenAnswer(read: { prefs: { toursSeen?: unknown }; usable: boolean }): TourId[] | null {
  return read.usable ? toursSeenFrom(read.prefs) : null;
}

// null (prefs.json unreadable) never shows a tour.
export function shouldShowTour(seen: readonly string[] | null, id: TourId): boolean {
  return seen !== null && !seen.includes(id);
}

// The list to write after Done or Skip. Keeps unknown entries already in the file
// (a later version's tour, written by a newer copy) so going back a version and
// forward again never replays a tour.
export function withTourSeen(raw: unknown, id: TourId): string[] {
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  return list.includes(id) ? list : [...list, id];
}
