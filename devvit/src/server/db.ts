import {redis} from '@devvit/web/server'
import type {T3} from '@devvit/web/shared'

/**
 * A post's world, stored as the world code the moderator pasted into the create-post form. Redis
 * keyed by post ID is the whole persistence model for v1 (#26 Phase 2): the code is self-contained,
 * so there is nothing else to store and nothing to fetch at render time.
 */
export async function dbGetWorldCode(t3: T3): Promise<string | undefined> {
  return (await redis.get(worldKey(t3))) ?? undefined
}

export async function dbSetWorldCode(t3: T3, code: string): Promise<void> {
  await redis.set(worldKey(t3), code)
}

function worldKey(t3: T3): string {
  return `world:${t3}`
}
