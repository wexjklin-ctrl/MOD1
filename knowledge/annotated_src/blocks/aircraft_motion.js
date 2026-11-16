/* CLAUDE-MAP-BEGIN
 FILE: blocks/aircraft_motion.js  (7 KB, 105 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/articulated_pose_cache.js, blocks/tower.js, blocks/vehicle_systems.js
 IMPORTED BY: main.js
 EXPORTS: applyGuidingWindSteering
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): applyGuidingWindSteering@4(101L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { vehicleSystems } from "./vehicle_systems.js";
import { sameArticulatedPoses } from "./articulated_pose_cache.js";
import { addTowerMotion } from "./tower.js";   // шаг 138
export function applyGuidingWindSteering(sessions, services) {
  const { syncPhysicsAirplaneSailOrientation, guidingWindSailGroups, syncSteeringWheelAngle, guidingWindFrontPivot, guidingWindSailTransform, ropeDownwardLoadByBody, addAirplaneFlight, addPropellerBearingMotion, isHotAirBalloonActive, applyGuidingWindHullTurn, world8 } = services;
  for (const session of sessions) {
    if (!session.assembly?.isValid || session.streamingMotion) continue;
    syncPhysicsAirplaneSailOrientation(session);
    const assembly = session.assembly;
    if (session.guidingWindTopology !== session.snapshots || session.guidingWindCount !== session.snapshots.length || session.guidingWindAssembly !== assembly) {
      session.guidingWindTopology = session.snapshots;
      session.guidingWindCount = session.snapshots.length;
      session.guidingWindAssembly = assembly;
      session.guidingWindGroups = guidingWindSailGroups(session);
      session.guidingWindSignature = void 0;
      session.guidingWindPreviousPoses = undefined;
      session.guidingWindVisuals = undefined;
    }
    const groups = session.guidingWindGroups;
    // шаг 135: на шаре/дирижабле (не самолёт) руль Guiding Wind держит и рычаг тяги (Throttle Lever), не только штурвал
    const steeringWheel = session.snapshots.some(s => s.typeId === "create_physics:steering_wheel");
    const leverRudder = !steeringWheel && !vehicleSystems(session).airplane && session.snapshots.some(s => s.typeId === "create_physics:throttle_lever");
    const hasWheel = steeringWheel || leverRudder;
    // шаг 136: руль от рычага поворачивает корпус зависимо от скорости хода (как судно), штурвал - как раньше
    session.guidingWindLeverMode = leverRudder;
    if (hasWheel) syncSteeringWheelAngle(session, groups.length ? groups[0].wind.guidingWindAngle : 0);
    const transforms = new Map();
    for (const {wind,members} of groups) {
      const target = hasWheel ? Math.max(-50,Math.min(50,Number(wind.guidingWindAngle)||0)) : 0;
      const previous = Number.isFinite(wind.guidingWindCurrentAngle) ? wind.guidingWindCurrentAngle : target;
      wind.guidingWindCurrentAngle = previous + Math.max(-1,Math.min(1,target-previous));
      const pivot = guidingWindFrontPivot(wind, session.location);
      for (const snapshot of members) {
        const local = {x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
        transforms.set(`${local.x},${local.y},${local.z}`,guidingWindSailTransform(local,pivot,wind.guidingWindCurrentAngle));
      }
    }
    session.ropeDownwardLoad = Math.max(0, ropeDownwardLoadByBody.get(assembly.body.id) ?? 0);
    if (vehicleSystems(session).airplane) addAirplaneFlight(session, transforms);
    else {
      session.airplaneWingDriveActive = false;
      session.airplaneHandlesPropulsion = false;
      session.airplaneLiftAcceleration = 0;
    }
    addPropellerBearingMotion(session, transforms, isHotAirBalloonActive(session));
    addTowerMotion(session, transforms);
    applyGuidingWindHullTurn(session, groups, hasWheel);
    // шаг 137: визуальные позы рулей самолёта RZ (без коллайдеров) идут отдельной картой
    const flaps = session.rzAirInfo ? session.rzFlapPoses : undefined;
    if (!transforms.size && !session.guidingWindVisuals?.size && !flaps?.size) continue;
    const ids = assembly.visualEntityIds;
    session.guidingWindVisuals ??= new Map();
    const anchor = assembly.visualAnchor ?? {x:0,y:0,z:0};
    session.guidingWindVisualAudit=(session.guidingWindVisualAudit ?? 0)+1;
    const audit=!session.guidingWindVisuals.size || session.guidingWindVisualBlocks!==assembly.blocks || session.guidingWindVisualCount!==ids.length || session.guidingWindVisualAudit>=20;
    if (audit || !session.guidingWindVisualIds) {
    session.guidingWindVisualBlocks=assembly.blocks;
    session.guidingWindVisualCount=ids.length;
    session.guidingWindVisualAudit=0;
    session.guidingWindVisualIds=new Set(ids);
    for (const id of ids) {
      if (session.guidingWindVisuals.has(id)) continue;
      try {
        const entity = world8.getEntity(id);
        if (!entity?.isValid || typeof entity.getProperty("create_physics:local_x") !== "number") continue;
        const block = assembly.getVisualBlock(id);
        if (!block) continue;
        const local = { ...block.localLocation };
        // шаг 141: на башне трогаем только блоки, которым башня или руль дают позу. Остальные (колёса, части пушки на корпусе) пишут свои свойства сами;
        // раньше этот проход затирал их значениями по умолчанию: колёса вверх ногами, дуло оставалось в воздухе.
        if (session.towerGroups?.length) {
          const pk = `${local.x},${local.y},${local.z}`;
          if (!transforms.has(pk) && !flaps?.has(pk) && !session.towerKeys?.has(pk)) continue;
        }
        session.guidingWindVisuals.set(id,{entity,local,yaw:block.rotation?.y??0,pitch:block.rotation?.x??0,roll:block.rotation?.z??0});
      } catch {}
    }
    }
    const posesChanged = !sameArticulatedPoses(session.guidingWindPreviousPoses,transforms);
    const flapsChanged = (session.rzFlapShown ?? 0) !== (flaps ? (session.rzFlapVersion ?? 0) : 0);
    if (!audit && !posesChanged && !flapsChanged) continue;
    for (const [id,record] of session.guidingWindVisuals) {
      if (!record.entity?.isValid || !session.guidingWindVisualIds.has(id)) {session.guidingWindVisuals.delete(id);continue;}
      const poseKey = `${record.local.x},${record.local.y},${record.local.z}`;
      const pose = transforms.get(poseKey) ?? flaps?.get(poseKey);
      const local = pose?.location ?? record.local;
      try {
        const values=[local.x-anchor.x,local.y-anchor.y,local.z-anchor.z,
          pose?.rotation?.y ?? (record.yaw+(pose?.yaw??0)),pose?.rotation?.x ?? record.pitch,pose?.rotation?.z ?? record.roll];
        const properties=["local_x","local_y","local_z","local_yaw","local_pitch","local_roll"];
        for(let i=0;i<values.length;i++) {
          if(record.lastValues?.[i]!==values[i]) record.entity.setProperty(`create_physics:${properties[i]}`,values[i]);
        }
        record.lastValues=values;
      } catch {}
    }
    session.rzFlapShown = flaps ? (session.rzFlapVersion ?? 0) : 0;
    // коллайдеры пересобираются только при смене поз articulated блоков, а не при каждом движении руля
    if (audit || posesChanged) {
      assembly.setArticulatedBlockTransforms(transforms);
      session.guidingWindPreviousPoses = transforms;
    }
  }
}
