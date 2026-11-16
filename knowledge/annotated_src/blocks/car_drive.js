/* CLAUDE-MAP-BEGIN
 FILE: blocks/car_drive.js  (14 KB, 176 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Older car drive helper.
 IMPORTS: blocks/car_directions.js, blocks/rz_block_mass.js, blocks/rz_drive.js, blocks/vehicle_systems.js, blocks/wheel_surface.js
 IMPORTED BY: main.js
 EXPORTS: surfaceSpeedCapKmh, surfaceSpeedCap, carMovementInput, applySteeringWheelDrive
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): applySteeringWheelDrive@38(138L); surfaceSpeedCapKmh@18(7L); inputAxis@8(6L); carMovementInput@31(6L); surfaceSpeedCap@26(4L); clamp@7(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { carDriveCommand } from "./car_directions.js";
import { wheelCoastFactor } from "./wheel_surface.js";
import { rzCarDrive, rzTrackTurnScale, rzCanDrive, DRIVE as RZ_DRIVE } from "./rz_drive.js"; // RZ Lite: двигатели RZ
import { RZW } from "./rz_block_mass.js";
import { vehicleSystems } from "./vehicle_systems.js";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const inputAxis=value=>{
  const number=Number(value);
  if (!Number.isFinite(number)) return 0;
  const amount=clamp(number,-1,1);
  return Math.abs(amount)<=0.1 ? 0 : Math.sign(amount)*(Math.abs(amount)-0.1)/0.9;
};


// шаг 109: предел скорости по покрытию. Земля/песок/трава/снег - мягкие; бетон отдельно; остальное (камень, дерево и т.д.) - твёрдое.
const SOFT_GROUND=/(dirt|grass|sand|gravel|mud|snow|farmland|podzol|mycelium|clay|moss|powder|path|soul_soil|soul_sand)/;
export function surfaceSpeedCapKmh(typeId) {
  const id=String(typeId).replace(/^minecraft:/,"");
  if (/concrete/.test(id) && !/powder/.test(id)) return RZ_DRIVE.SURF_CONCRETE_KMH;
  if (/sandstone/.test(id)) return RZ_DRIVE.SURF_HARD_KMH;
  if (SOFT_GROUND.test(id)) return RZ_DRIVE.SURF_SOFT_KMH;
  return RZ_DRIVE.SURF_HARD_KMH;
}
/** Предел в м/с по покрытию под колёсами (среднее по колёсам); undefined - колёса ни на чём не стоят, не ограничиваем. */
export function surfaceSpeedCap(typeIds) {
  if (!typeIds?.length) return undefined;
  return typeIds.reduce((sum,id)=>sum+surfaceSpeedCapKmh(id),0)/typeIds.length/3.6;
}

export function carMovementInput(movement, armchair = false) {
  // шаг 108: знак одинаков для всех сидений; у кресла вместо этого развёрнут перёд машины (main.js, rzReversed)
  // шаг 113: W/S и A/D были перепутаны (проверено игроком): оба знака меняются разом. INVERT_INPUT 0 возвращает как в шаге 112.
  const k=(RZ_DRIVE.INVERT_INPUT===0 ? 1 : -1)*(RZ_DRIVE.STEER_V2 ? -1 : 1);   // шаг 118: вместе с развёрнутой рамкой (main.js rzReversed) W едет туда же, но рулят передние колёса и A/D не зеркальны
  return {forward:-k*inputAxis(movement?.y),turn:-k*inputAxis(movement?.x)};
}

export function applySteeringWheelDrive(sessions, services) {
  for (const session of sessions) {
    const assembly=session.assembly;
    if (!assembly?.isValid || session.streamingMotion || services.gravityGauntletHolding(assembly)) continue;
    if (vehicleSystems(session).rzAir) continue;   // шаг 147: пульт башни больше не отключает вождение машины
    if (session.rzFlipped || session.rzAirborne) { session.wheelAcceleration=0; continue; }   // RZ Lite: лежащая или летящая машина не рулит и не едет (колёса не касаются земли)
    const steering=services.rzCarSteering ? services.rzCarSteering(session) : session.snapshots.find(s=>s.typeId==="create_physics:steering_contro_wheel" && Number.isFinite(s.wheelDriveSpeed));
    const frame=steering && services.carWheelDriveFrame(session,steering);
    if (!frame) continue;
    try {
      const driver=services.carDriverInput(session);
      services.syncCarSteeringPose(session);
      const body=assembly.body;
      const grip=services.carSurfaceGrip?.(assembly) ?? 1;
      const heading=()=>{
        const origin=body.localPointToWorld({x:0,y:0,z:0});
        const point=body.localPointToWorld(frame.axis);
        const length=Math.hypot(point.x-origin.x,point.z-origin.z);
        return length>0.01 ? {x:(point.x-origin.x)/length,z:(point.z-origin.z)/length} : undefined;
      };
      let forward=heading();
      if (!forward) continue;
      let velocity=body.velocity;
      let speed=velocity.x*forward.x+velocity.z*forward.z;
      const points=frame.mounts.map(m=>{
        const side=services.wheelMountFront(m.wheelDirection ?? m.permutation.getState("minecraft:cardinal_direction"));
        return {x:m.location.x-session.location.x+side.x,y:m.location.y-session.location.y-1,z:m.location.z-session.location.z+side.z};
      });
      const distance=p=>p.x*frame.axis.x+p.z*frame.axis.z;
      const distances=points.map(distance);
      const minimum=Math.min(...distances),maximum=Math.max(...distances);
      const average=group=>group.reduce((sum,p)=>({x:sum.x+p.x/group.length,y:sum.y+p.y/group.length,z:sum.z+p.z/group.length}),{x:0,y:0,z:0});
      const fixed=points.filter((p,i)=>!services.wheelMountSteeringEnabled(frame.mounts[i]));
      const steeringPoints=points.filter((p,i)=>services.wheelMountSteeringEnabled(frame.mounts[i]));
      // Turn around the actual fixed axle, not the assembly origin or a tire
      // selected only by its position. The front tires sweep around this axle.
      const pivot=average(fixed.length ? fixed : points.filter(p=>distance(p)<minimum+0.25));
      const steeringCenter=steeringPoints.length ? average(steeringPoints) : pivot;
      const axleSpan=distance(steeringCenter)-distance(pivot);
      const wheelbase=Math.max(2,Math.abs(axleSpan)>0.25 ? Math.abs(axleSpan) : maximum-minimum);
      const steeringAxleSign=axleSpan < -0.25 ? -1 : 1;
      const requested=frame.steerable ? (driver ? driver.turn*45 : Number(steering.wheelSteeringAngle)||0) : 0;
      const limit=Math.min(30,Math.atan(5*wheelbase/Math.max(1,speed*speed))*180/Math.PI);
      const target=clamp(requested,-limit,limit);
      const previous=Number.isFinite(session.wheelSteeringAngle) ? session.wheelSteeringAngle : 0;
      session.wheelSteeringAngle=frame.steerable ? previous+clamp((target-previous)*0.08,-1,1) : 0;
      services.syncSteeringWheelAngle(session,session.wheelSteeringAngle,"create_physics:steering_contro_wheel");
      let turn=Math.abs(speed)>0.05 ? clamp(-speed*steeringAxleSign*Math.tan(session.wheelSteeringAngle*Math.PI/180)/wheelbase*180/Math.PI/20,-2.5,2.5) : 0;
      // RZ Lite: центр масс влияет на руление (только при весах RZ). Центр масс - настоящий (main.js), расчёт один раз за тик из готовых чисел.
      const com=RZW.ON ? body.getCenterOfMass() : undefined;
      if (com && frame.steerable && turn!==0 && Math.abs(axleSpan)>0.25) {
        // 1) нагрузка на рулевую ось по правилу рычага: развесовка с перегрузом сзади даёт недоповорот, на рулевой оси - лучший отклик
        const frontLoad=clamp((distance(com)-distance(pivot))/axleSpan,0,1);
        turn*=clamp(frontLoad/0.5,0.55,1.2);
        // 2) опрокидывание: боковое ускорение v^2*tg(угол)/база не должно превышать g*полуширина/высота центра масс (g Lite = 11)
        const lateral={x:-frame.axis.z,z:frame.axis.x};
        const sides=points.map(p=>p.x*lateral.x+p.z*lateral.z);
        const halfTrack=Math.max(0.5,(Math.max(...sides)-Math.min(...sides))/2+0.4);
        const groundY=points.reduce((sum,p)=>sum+p.y,0)/points.length-0.5;
        const heightCom=Math.max(0.4,com.y-groundY);
        const lateralAcc=speed*speed*Math.abs(Math.tan(session.wheelSteeringAngle*Math.PI/180))/wheelbase;
        const limit=11*halfTrack/heightCom*0.9;
        if (lateralAcc>limit) turn*=limit/lateralAcc;   // высокий груз: машина не вписывается в поворот и идёт шире (заносит)
      }
      // RZ Lite: гусеницы (>= половины колёс — варианты 4-7, минимум 2) поворачивают бортами на месте вокруг центра катков:
      // 2.4° за тик при полном A/D, плавное нарастание. Знак поворота и пивот не проверены в игре.
      const trackedPoints=points.filter((p,i)=>(frame.mounts[i].wheelVariant ?? 0)>=4);
      const tracked=trackedPoints.length>=2 && trackedPoints.length*2>=points.length;
      let turnPivot=pivot;
      if (tracked) {
        const input=driver ? clamp((Number(driver.turn)||0)*(RZ_DRIVE.STEER_V2 ? -1 : 1)*(RZ_DRIVE.TRACK_TURN_V2 ? -1 : 1),-1,1) : 0;   // шаг 121: лево/право танка были перепутаны   // шаг 118: гусеницы не зависят от рамки, знак поворота прежний
        const prevRamp=Number.isFinite(session.rzTrackTurn) ? session.rzTrackTurn : 0;
        session.rzTrackTurn=prevRamp+clamp((input-prevRamp)*0.25,-0.12,0.12);
        if (Math.abs(session.rzTrackTurn)<0.005 && input===0) session.rzTrackTurn=0;
        session.wheelSteeringAngle=0;
        turn=-session.rzTrackTurn*2.4*rzTrackTurnScale(session);   // RZ Lite: тяжёлая машина со слабым двигателем разворачивается медленнее
        if (session.rz?.info?.brokenTrack || !rzCanDrive(session)) { turn=0; session.rzTrackTurn=0; }   // шаг 121: без тяги (нет топлива/двигателя) танк тоже не крутится на месте   // шаг 111: с разорванной гусеницей танк не разворачивается на месте
        turnPivot=average(trackedPoints);
        if (RZW.ON) { const c=body.getCenterOfMass(); turnPivot={x:c.x,y:turnPivot.y,z:c.z}; }   // RZ Lite: поворот вокруг центра масс, как в RZ
      } else session.rzTrackTurn=0;
      if (Math.abs(turn)>0.0001) {
        const anchor=body.localPointToWorld(turnPivot);
        const rotation=body.getRotation();
        body.setRotation({...rotation,y:rotation.y+turn});
        const after=body.localPointToWorld(turnPivot);
        const position=body.location;
        body.teleport({x:position.x+anchor.x-after.x,y:position.y+anchor.y-after.y,z:position.z+anchor.z-after.z},{velocity:body.getVelocity(),angularVelocity:{...body.angularVelocity}});
        const newForward=heading();
        const cosine=forward.x*newForward.x+forward.z*newForward.z;
        const sine=forward.x*newForward.z-forward.z*newForward.x;
        const rotated={x:velocity.x*cosine-velocity.z*sine,z:velocity.x*sine+velocity.z*cosine};
        velocity={x:velocity.x+(rotated.x-velocity.x)*grip,y:velocity.y,z:velocity.z+(rotated.z-velocity.z)*grip};
        body.setVelocity(velocity);
        forward=newForward;
        speed=velocity.x*forward.x+velocity.z*forward.z;
      }
      let targetSpeed=carDriveCommand(frame,driver,driver || RZ_DRIVE.ALLOW_CRUISE ? steering.wheelDriveSpeed : 0);   // RZ Lite: без водителя круиз CM выключен
      // RZ Lite: есть двигатель RZ -> предел скорости и ускорение от его мощности/топлива (нет тяги = накат)
      const rz=rzCarDrive(session,targetSpeed);
      if (rz) targetSpeed=rz.target;
      // шаг 109: предел скорости по покрытию; поворот снижает его (максимум только по прямой), на склоне скорость не растёт
      const surfaceCap=tracked ? undefined : surfaceSpeedCap(services.carGroundTypeIds?.(assembly));   // гусеничные машины не ограничиваются: едут как раньше
      let cap;
      if (surfaceCap!==undefined) {
        const steerAmount=Math.abs(session.wheelSteeringAngle||0)/12+Math.abs(turn)/1.5;
        const straight=Number.isFinite(session.rzStraight) ? session.rzStraight : 1;
        session.rzStraight=steerAmount>0.15 ? Math.max(0,straight-RZ_DRIVE.STRAIGHT_FALL) : Math.min(1,straight+RZ_DRIVE.STRAIGHT_RISE);
        cap=surfaceCap*(RZ_DRIVE.STRAIGHT_MIN+(1-RZ_DRIVE.STRAIGHT_MIN)*session.rzStraight);
        targetSpeed=clamp(targetSpeed,-cap,cap);
      }
      if (Math.abs(targetSpeed)<=0.01) {
        session.wheelAcceleration=0;
        if (!services.ropeTowingCars.has(assembly)) {
          const factor=wheelCoastFactor(velocity,grip);
          body.setVelocity({x:velocity.x*factor,y:velocity.y,z:velocity.z*factor});
        }
        continue;
      }
      // RZ Lite (шаг 108): предел ускорения двигателя действует в сторону цели и вперёд, и назад; торможение против движения остаётся 0.32.
      // Раньше назад предел был -0.32 независимо от мощности: тяжёлая машина разгонялась назад быстрее, чем вперёд.
      const accelCap=rz ? rz.maxAccelTick : 0.32;
      const desired=clamp((targetSpeed-speed)*0.18,targetSpeed<0 ? -accelCap : -0.32,targetSpeed<0 ? 0.32 : accelCap)*Math.sqrt(grip);
      const previousAcceleration=Number.isFinite(session.wheelAcceleration) ? session.wheelAcceleration : 0;
      let acceleration=previousAcceleration+clamp((desired-previousAcceleration)*0.3,-0.045,0.045);
      // шаг 109: на подъёмах и спусках разгон отключается, а скорость сверх предела покрытия гасится (иначе на холмах машину уносит)
      // шаг 118: разгон отключается только на спуске. Раньше на подъёме тоже (|vy| > HILL_VY): машина теряла скорость на любом склоне, застревала и не выезжала из воды
      const hillDown=!tracked && velocity.y<-RZ_DRIVE.HILL_VY;
      if (hillDown && acceleration*Math.sign(speed||targetSpeed)>0) acceleration=0;
      if (cap!==undefined && Math.abs(speed)>cap*1.02) acceleration=Math.sign(speed)*-Math.min(0.2,(Math.abs(speed)-cap)*0.15);
      session.wheelAcceleration=acceleration;
      body.setVelocity({x:forward.x*(speed+acceleration)+(velocity.x-forward.x*speed)*(1-grip),y:velocity.y,z:forward.z*(speed+acceleration)+(velocity.z-forward.z*speed)*(1-grip)});
      body.setAngularVelocity({...body.angularVelocity,y:body.angularVelocity.y*0.25});
      body.wakeUp();
    } catch(error) {
      if (services.system7.currentTick%100===0) console.warn(`[Create Physics] Car drive: ${error}`);
    }
  }
}
