import * as path from 'path';

/**
 * Canonical key for a filesystem path used as a Map/Set key or compared for identity.
 *
 * Hooks and VS Code may spell the same Windows working directory with different
 * casing. Normalize before comparing scope or using a directory as a Map/Set key.
 */
export function toPathKey(p: string): string {
  if (!p) return p;
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when both paths point at the same file/directory (case-insensitive on Windows). */
export function pathsMatch(left: string, right: string): boolean {
  return toPathKey(left) === toPathKey(right);
}

/**
 * Set of filesystem paths that normalizes every entry through {@link toPathKey}, so
 * membership survives the spelling differences described above. Drop-in for
 * `Set<string>`: callers keep passing raw paths to `add`/`has`/`delete`.
 *
 * Iteration yields canonical keys, not the original spellings — nothing reads entries
 * back out today, so keep it that way rather than reintroducing a raw-path round-trip.
 */
export class PathSet extends Set<string> {
  override add(value: string): this {
    return super.add(toPathKey(value));
  }

  override has(value: string): boolean {
    return super.has(toPathKey(value));
  }

  override delete(value: string): boolean {
    return super.delete(toPathKey(value));
  }
}
