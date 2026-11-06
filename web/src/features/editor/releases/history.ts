// Release-history badges. History is append-only: a restore of vK publishes a
// new release vN with `restoredFrom: K`, so every release strictly between K
// and N was rolled back by it (its document stopped being served). The live
// release is never shown as rolled back even if an older restore covered it.
import type { Release } from '../../../api/types'

export type ReleaseBadge = 'live' | 'rolledBack' | null

/** Badge per release number. */
export function releaseBadges(releases: readonly Release[]): Map<number, ReleaseBadge> {
  const badges = new Map<number, ReleaseBadge>()
  for (const release of releases) badges.set(release.number, release.live ? 'live' : null)
  for (const restore of releases) {
    if (restore.restoredFrom === null) continue
    for (const release of releases) {
      if (release.live) continue
      if (release.number > restore.restoredFrom && release.number < restore.number) badges.set(release.number, 'rolledBack')
    }
  }
  return badges
}
