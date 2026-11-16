/* CLAUDE-MAP-BEGIN
 FILE: blocks/articulated_pose_cache.js  (0 KB, 13 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/aircraft_motion.js
 EXPORTS: sameArticulatedPoses
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): sameArticulatedPoses@1(12L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function sameArticulatedPoses(previous,current) {
  if (!previous || previous.size!==current.size) return false;
  for (const [key,pose] of current) {
    const old=previous.get(key);
    if (!old || old.yaw!==pose.yaw || old.collisionResponse!==pose.collisionResponse) return false;
    for (const field of ["location","rotation","size"]) {
      const a=old[field],b=pose[field];
      if (!!a!==!!b || a && (a.x!==b.x || a.y!==b.y || a.z!==b.z)) return false;
    }
  }
  return true;
}
