/* CLAUDE-MAP-BEGIN
 FILE: blocks/car_directions.js  (2 KB, 48 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/wheel_mount_ids.js
 IMPORTED BY: blocks/car_drive.js, main.js
 EXPORTS: carDirectionFrame, carDriveCommand, carMountDirection, carDriveFrame
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): carDriveFrame@25(23L); carDriveCommand@14(6L); carDirectionFrame@10(3L); carMountDirection@21(3L); north@3(1L); south@4(1L); east@5(1L); west@6(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { isWheelMountId } from "./wheel_mount_ids.js";
// Each construction direction defines its own forward vector and wheel axle.
const north = () => ({facing:"north",axis:{x:0,y:0,z:-1},wheelAxis:"x",forwardInputSign:-1,controlInputSign:-1});
const south = () => ({facing:"south",axis:{x:0,y:0,z:1},wheelAxis:"x",forwardInputSign:-1,controlInputSign:-1});
const east = () => ({facing:"east",axis:{x:1,y:0,z:0},wheelAxis:"z",forwardInputSign:-1});
const west = () => ({facing:"west",axis:{x:-1,y:0,z:0},wheelAxis:"z",forwardInputSign:-1});
const directions = {north,south,east,west};
const CAR_SPEED_MULTIPLIER = 1.15;

export function carDirectionFrame(facing) {
  return (directions[facing] ?? south)();
}

export function carDriveCommand(frame, driver, controlSpeed) {
  if (driver) return driver.forward * frame.forwardInputSign * 8.5 * CAR_SPEED_MULTIPLIER;
  const speed = Number(controlSpeed);
  return Math.max(-16,Math.min(16,Number.isFinite(speed) ? speed : 0)) *
    (frame.controlInputSign ?? 1) * 0.85 * CAR_SPEED_MULTIPLIER;
}

export function carMountDirection(mount) {
  return mount.wheelDirection ?? mount.permutation.getState("minecraft:cardinal_direction") ?? "south";
}

export function carDriveFrame(snapshots, facing, steeringEnabled) {
  const wheels = snapshots.filter(s => isWheelMountId(s.typeId) && s.hasWheel);
  if (!wheels.length) return undefined;
  const compatible = frame => wheels.filter(s => {
    const side = carDirectionFrame(carMountDirection(s)).axis;
    return frame.wheelAxis === "x" ? side.x !== 0 : side.z !== 0;
  });
  let frame = carDirectionFrame(facing);
  let mounts = compatible(frame);
  if (!mounts.length) {
    // A sideways seat cannot change the axle on which the wheels roll.
    // Use the steering axle to choose the front when the seat is perpendicular.
    frame = carDirectionFrame(frame.wheelAxis === "x" ? "east" : "south");
    mounts = compatible(frame);
    const turning = mounts.filter(steeringEnabled), fixed = mounts.filter(s => !steeringEnabled(s));
    if (turning.length && fixed.length) {
      const coordinate = frame.axis.x ? "x" : "z";
      const average = group => group.reduce((sum,s) => sum+s.location[coordinate],0)/group.length;
      if (average(turning) < average(fixed)) frame = carDirectionFrame(coordinate === "x" ? "west" : "north");
    }
  }
  return {...frame,mounts,steerable:mounts.some(steeringEnabled)};
}
