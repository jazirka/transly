import { mergeProjects } from './project';
import type { SavedProject } from './project';

/**
 * Put the result of a network round trip (a sync) into the app.
 *
 * The round trip started from the project as it was before the request, and the translator may have typed while it ran.
 * Taking the result as it is would drop those edits (they live in the object that is being replaced). So the result is
 * merged with the project as it is now: the merge keeps the newer version of every row, which means edits typed during the
 * request win over what was synced before them, and what other devices sent stays. A reset made during the request wins too.
 */
export const adoptSynced = (live: SavedProject, synced: SavedProject): SavedProject => (live === synced ? synced : mergeProjects(live, synced).project);
