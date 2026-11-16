/* CLAUDE-MAP-BEGIN
 FILE: blocks/block_orientation.js  (32 KB, 549 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/armchair.js, blocks/symmetric_sails.js
 IMPORTED BY: main.js
 EXPORTS: addonBlockRotation, addonFacingPlayer, restoredAddonDirection
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): addonFacingPlayer@498(28L); restoredAddonDirection@527(20L); entityRuleRotation@481(9L); addonBlockRotation@490(7L); orientationBlockBase@548(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { isArmchairBlock } from "./armchair.js";
import { SYMMETRIC_SAIL_IDS, symmetricSailBase } from "./symmetric_sails.js";
// Rotation definitions copied from this pack's placed blocks.
const orientations = {
    "create_physics:propeller_bearing":  [
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  180,
                                                                  0
                                                              ],
                                                 "value":  "north",
                                                 "state":  "minecraft:cardinal_direction"
                                             },
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  90,
                                                                  0
                                                              ],
                                                 "value":  "east",
                                                 "state":  "minecraft:cardinal_direction"
                                             },
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  0,
                                                                  0
                                                              ],
                                                 "value":  "south",
                                                 "state":  "minecraft:cardinal_direction"
                                             },
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  -90,
                                                                  0
                                                              ],
                                                 "value":  "west",
                                                 "state":  "minecraft:cardinal_direction"
                                             }
                                         ],
    "create_physics:airplane_throttle":  [
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  180,
                                                                  0
                                                              ],
                                                 "value":  "north",
                                                 "state":  "minecraft:cardinal_direction"
                                             },
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  90,
                                                                  0
                                                              ],
                                                 "value":  "east",
                                                 "state":  "minecraft:cardinal_direction"
                                             },
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  0,
                                                                  0
                                                              ],
                                                 "value":  "south",
                                                 "state":  "minecraft:cardinal_direction"
                                             },
                                             {
                                                 "rotation":  [
                                                                  0,
                                                                  -90,
                                                                  0
                                                              ],
                                                 "value":  "west",
                                                 "state":  "minecraft:cardinal_direction"
                                             }
                                         ],
    "create_physics:airplane_wing_control":  [
                                                 {
                                                     "rotation":  [
                                                                      0,
                                                                      180,
                                                                      0
                                                                  ],
                                                     "value":  "north",
                                                     "state":  "minecraft:cardinal_direction"
                                                 },
                                                 {
                                                     "rotation":  [
                                                                      0,
                                                                      90,
                                                                      0
                                                                  ],
                                                     "value":  "east",
                                                     "state":  "minecraft:cardinal_direction"
                                                 },
                                                 {
                                                     "rotation":  [
                                                                      0,
                                                                      0,
                                                                      0
                                                                  ],
                                                     "value":  "south",
                                                     "state":  "minecraft:cardinal_direction"
                                                 },
                                                 {
                                                     "rotation":  [
                                                                      0,
                                                                      -90,
                                                                      0
                                                                  ],
                                                     "value":  "west",
                                                     "state":  "minecraft:cardinal_direction"
                                                 }
                                             ],
    "create_physics:steering_wheel":  [
                                          {
                                              "rotation":  [
                                                               0,
                                                               180,
                                                               0
                                                           ],
                                              "value":  "north",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               90,
                                                               0
                                                           ],
                                              "value":  "east",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               0,
                                                               0
                                                           ],
                                              "value":  "south",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               -90,
                                                               0
                                                           ],
                                              "value":  "west",
                                              "state":  "minecraft:cardinal_direction"
                                          }
                                      ],
    "create_physics:andesite_propeller":  [
                                              {
                                                  "rotation":  [
                                                                   0,
                                                                   180,
                                                                   0
                                                               ],
                                                  "value":  "north",
                                                  "state":  "minecraft:cardinal_direction"
                                              },
                                              {
                                                  "rotation":  [
                                                                   0,
                                                                   90,
                                                                   0
                                                               ],
                                                  "value":  "east",
                                                  "state":  "minecraft:cardinal_direction"
                                              },
                                              {
                                                  "rotation":  [
                                                                   0,
                                                                   0,
                                                                   0
                                                               ],
                                                  "value":  "south",
                                                  "state":  "minecraft:cardinal_direction"
                                              },
                                              {
                                                  "rotation":  [
                                                                   0,
                                                                   -90,
                                                                   0
                                                               ],
                                                  "value":  "west",
                                                  "state":  "minecraft:cardinal_direction"
                                              }
                                          ],
    "create_physics:guiding_wind":  [
                                        {
                                            "rotation":  [
                                                             0,
                                                             180,
                                                             0
                                                         ],
                                            "value":  "north",
                                            "state":  "minecraft:cardinal_direction"
                                        },
                                        {
                                            "rotation":  [
                                                             0,
                                                             90,
                                                             0
                                                         ],
                                            "value":  "east",
                                            "state":  "minecraft:cardinal_direction"
                                        },
                                        {
                                            "rotation":  [
                                                             0,
                                                             0,
                                                             0
                                                         ],
                                            "value":  "south",
                                            "state":  "minecraft:cardinal_direction"
                                        },
                                        {
                                            "rotation":  [
                                                             0,
                                                             -90,
                                                             0
                                                         ],
                                            "value":  "west",
                                            "state":  "minecraft:cardinal_direction"
                                        }
                                    ],
    "create_physics:symmetric_sail_side":  [
                                               {
                                                   "rotation":  [
                                                                    0,
                                                                    270,
                                                                    0
                                                                ],
                                                   "value":  "north",
                                                   "state":  "minecraft:cardinal_direction"
                                               },
                                               {
                                                   "rotation":  [
                                                                    0,
                                                                    180,
                                                                    0
                                                                ],
                                                   "value":  "east",
                                                   "state":  "minecraft:cardinal_direction"
                                               },
                                               {
                                                   "rotation":  [
                                                                    0,
                                                                    90,
                                                                    0
                                                                ],
                                                   "value":  "south",
                                                   "state":  "minecraft:cardinal_direction"
                                               },
                                               {
                                                   "rotation":  [
                                                                    0,
                                                                    0,
                                                                    0
                                                                ],
                                                   "value":  "west",
                                                   "state":  "minecraft:cardinal_direction"
                                               }
                                           ],
    "create_physics:controller":  [
                                      {
                                          "rotation":  [
                                                           0,
                                                           180,
                                                           0
                                                       ],
                                          "value":  "north",
                                          "state":  "minecraft:cardinal_direction"
                                      },
                                      {
                                          "rotation":  [
                                                           0,
                                                           90,
                                                           0
                                                       ],
                                          "value":  "east",
                                          "state":  "minecraft:cardinal_direction"
                                      },
                                      {
                                          "rotation":  [
                                                           0,
                                                           0,
                                                           0
                                                       ],
                                          "value":  "south",
                                          "state":  "minecraft:cardinal_direction"
                                      },
                                      {
                                          "rotation":  [
                                                           0,
                                                           -90,
                                                           0
                                                       ],
                                          "value":  "west",
                                          "state":  "minecraft:cardinal_direction"
                                      }
                                  ],
    "create_physics:throttle_lever":  [
                                          {
                                              "rotation":  [
                                                               0,
                                                               180,
                                                               0
                                                           ],
                                              "value":  "north",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               90,
                                                               0
                                                           ],
                                              "value":  "east",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               0,
                                                               0
                                                           ],
                                              "value":  "south",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               -90,
                                                               0
                                                           ],
                                              "value":  "west",
                                              "state":  "minecraft:cardinal_direction"
                                          }
                                      ],
    "create_physics:handles":  [
                                   {
                                       "rotation":  [
                                                        0,
                                                        0,
                                                        0
                                                    ],
                                       "value":  "up",
                                       "state":  "minecraft:block_face"
                                   },
                                   {
                                       "rotation":  [
                                                        180,
                                                        0,
                                                        0
                                                    ],
                                       "value":  "down",
                                       "state":  "minecraft:block_face"
                                   },
                                   {
                                       "rotation":  [
                                                        -90,
                                                        0,
                                                        0
                                                    ],
                                       "value":  "north",
                                       "state":  "minecraft:block_face"
                                   },
                                   {
                                       "rotation":  [
                                                        90,
                                                        0,
                                                        0
                                                    ],
                                       "value":  "south",
                                       "state":  "minecraft:block_face"
                                   },
                                   {
                                       "rotation":  [
                                                        0,
                                                        0,
                                                        -90
                                                    ],
                                       "value":  "east",
                                       "state":  "minecraft:block_face"
                                   },
                                   {
                                       "rotation":  [
                                                        0,
                                                        0,
                                                        90
                                                    ],
                                       "value":  "west",
                                       "state":  "minecraft:block_face"
                                   }
                               ],
    "create_physics:symmetric_sail":  [
                                          {
                                              "rotation":  [
                                                               0,
                                                               180,
                                                               0
                                                           ],
                                              "value":  "north",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               90,
                                                               0
                                                           ],
                                              "value":  "east",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               0,
                                                               0
                                                           ],
                                              "value":  "south",
                                              "state":  "minecraft:cardinal_direction"
                                          },
                                          {
                                              "rotation":  [
                                                               0,
                                                               -90,
                                                               0
                                                           ],
                                              "value":  "west",
                                              "state":  "minecraft:cardinal_direction"
                                          }
                                      ],
    "create_physics:armchair":  [
                                    {
                                        "rotation":  [
                                                         0,
                                                         180,
                                                         0
                                                     ],
                                        "value":  "north",
                                        "state":  "minecraft:cardinal_direction"
                                    },
                                    {
                                        "rotation":  [
                                                         0,
                                                         90,
                                                         0
                                                     ],
                                        "value":  "east",
                                        "state":  "minecraft:cardinal_direction"
                                    },
                                    {
                                        "rotation":  [
                                                         0,
                                                         0,
                                                         0
                                                     ],
                                        "value":  "south",
                                        "state":  "minecraft:cardinal_direction"
                                    },
                                    {
                                        "rotation":  [
                                                         0,
                                                         -90,
                                                         0
                                                     ],
                                        "value":  "west",
                                        "state":  "minecraft:cardinal_direction"
                                    }
                                ]
};

function entityRuleRotation(rule, typeId) {
  const [x,y,z] = rule.rotation;
  // Cardinal block models and entity models have opposite north/south bases.
  // This maps north to 0 and south to 180 without swapping east/west.
  const yaw = rule.state.endsWith('cardinal_direction') ? y - 180 : -y;
  // Handles use their block model directly; their side-mounted roll needs
  // the original sign rather than the generic entity conversion.
  return {x, y:((yaw+180)%360+360)%360-180, z:typeId === 'create_physics:handles' ? z : -z};
}
export function addonBlockRotation(snapshot) {
  const rules = orientations[orientationBlockBase(snapshot.typeId)];
  if (!rules) return undefined;
  const rule = rules.find(rule => snapshot.permutation.getState(rule.state) === rule.value);
  if (!rule) return undefined;
  return entityRuleRotation(rule, snapshot.typeId);
}

export function addonFacingPlayer(typeId, towardPlayer) {
  if (typeId === 'create:mechanical_harvester' || typeId === 'create:mechanical_saw') {
    if (Math.hypot(towardPlayer.x,towardPlayer.z)<0.0001) return undefined;
    // Present the blade side to the player rather than the wooden back.
    return Math.abs(towardPlayer.x)>Math.abs(towardPlayer.z)
      ? (towardPlayer.x>0 ? 'west' : 'east')
      : (towardPlayer.z>0 ? 'north' : 'south');
  }
  if (typeId === 'create_physics:steering_contro_wheel') {
    if (Math.hypot(towardPlayer.x,towardPlayer.z)<0.0001) return undefined;
    // The wheel is on the negative-Z face of the unrotated block model.
    // Pick the block state that turns that face toward the local player.
    return Math.abs(towardPlayer.x)>Math.abs(towardPlayer.z)
      ? (towardPlayer.x>0 ? 'west' : 'east')
      : (towardPlayer.z>0 ? 'north' : 'south');
  }
  const rules = orientations[orientationBlockBase(typeId)]?.filter(rule => rule.state.endsWith('cardinal_direction'));
  if (!rules?.length || Math.hypot(towardPlayer.x,towardPlayer.z)<0.0001) return undefined;
  let best, score=-Infinity;
  for (const rule of rules) {
    const yaw=entityRuleRotation(rule, typeId).y*Math.PI/180;
    const sail=SYMMETRIC_SAIL_IDS.has(typeId);
    const front=sail ? {x:Math.cos(yaw),z:-Math.sin(yaw)} : {x:Math.sin(yaw),z:Math.cos(yaw)};
    const candidate=front.x*towardPlayer.x+front.z*towardPlayer.z;
    if(candidate>score){score=candidate;best=rule.value;}
  }
  return best;
}

export function restoredAddonDirection(snapshot, state, orientation) {
  const rules = orientations[orientationBlockBase(snapshot.typeId)]?.filter(rule => rule.state === state);
  if (!rules?.length) return undefined;
  const current = rules.find(rule => snapshot.permutation.getState(state) === rule.value);
  if (!current) return undefined;
  const direction = rule => {
    const rotation = entityRuleRotation(rule, snapshot.typeId);
    const [rx,ry,rz] = [rotation.x,rotation.y,rotation.z].map(n=>n*Math.PI/180);
    const v = state.endsWith('block_face') ? {x:0,y:1,z:0} : {x:0,y:0,z:1};
    const y=v.y*Math.cos(rx)-v.z*Math.sin(rx), z=v.y*Math.sin(rx)+v.z*Math.cos(rx);
    const x=v.x*Math.cos(rz)-y*Math.sin(rz), yz=v.x*Math.sin(rz)+y*Math.cos(rz);
    return {x:x*Math.cos(ry)+z*Math.sin(ry),y:yz,z:-x*Math.sin(ry)+z*Math.cos(ry)};
  };
  const v=direction(current);
  const transformed={x:orientation.x.x*v.x+orientation.y.x*v.y+orientation.z.x*v.z,
    y:orientation.x.y*v.x+orientation.y.y*v.y+orientation.z.y*v.z,
    z:orientation.x.z*v.x+orientation.y.z*v.y+orientation.z.z*v.z};
  const match=rules.find(rule=>{const d=direction(rule);return d.x*transformed.x+d.y*transformed.y+d.z*transformed.z>0.999;});
  return match?.value ?? current.value;
}

function orientationBlockBase(typeId) { return isArmchairBlock(typeId) ? 'create_physics:armchair' : symmetricSailBase(typeId); }
