/* CLAUDE-MAP-BEGIN
 FILE: cbc/config/materials.generated.js  (2 KB, 88 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) АВТОГЕНЕРАЦИЯ tools/gen_configs.py. Не править руками. Источник: big_cannon_materials
 IMPORTS: -
 IMPORTED BY: cbc/fire.js, cbc/multiblock.js
 EXPORTS: MATERIALS
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// АВТОГЕНЕРАЦИЯ tools/gen_configs.py. Не править руками. Источник: big_cannon_materials
export const MATERIALS = {
    "bronze": {
        "minimumVelocityPerBarrel": 1.332,
        "weight": 2.0,
        "maxSafePropellantStress": 4,
        "failureMode": "rupture",
        "connectsInSurvival": false,
        "isWeldable": true,
        "weldDamage": 1,
        "weldStressPenalty": 0,
        "minimumSpread": 0.03,
        "spreadReductionPerBarrel": 1.4
    },
    "cast_iron": {
        "minimumVelocityPerBarrel": 2.0,
        "weight": 3.0,
        "maxSafePropellantStress": 2,
        "failureMode": "fragment",
        "connectsInSurvival": false,
        "isWeldable": true,
        "weldDamage": 1,
        "weldStressPenalty": 1,
        "minimumSpread": 0.05,
        "spreadReductionPerBarrel": 2.0
    },
    "example": {
        "minimumVelocityPerBarrel": 0.5,
        "weight": 4.0,
        "maxSafePropellantStress": 9,
        "failureMode": "fragment",
        "connectsInSurvival": false,
        "isWeldable": true,
        "weldDamage": 1,
        "weldStressPenalty": 1,
        "minimumSpread": 0.1,
        "spreadReductionPerBarrel": 1.0
    },
    "log": {
        "minimumVelocityPerBarrel": -1,
        "weight": 1.0,
        "maxSafePropellantStress": 0,
        "failureMode": "fragment",
        "connectsInSurvival": true,
        "isWeldable": false,
        "weldDamage": 0,
        "weldStressPenalty": 0,
        "minimumSpread": 1.5,
        "spreadReductionPerBarrel": 1.0
    },
    "nethersteel": {
        "minimumVelocityPerBarrel": 0.65,
        "weight": 6.0,
        "maxSafePropellantStress": 10,
        "failureMode": "fragment",
        "connectsInSurvival": false,
        "isWeldable": false,
        "weldDamage": 0,
        "weldStressPenalty": 0,
        "minimumSpread": 0.02,
        "spreadReductionPerBarrel": 1.15
    },
    "steel": {
        "minimumVelocityPerBarrel": 1.0,
        "weight": 5.0,
        "maxSafePropellantStress": 8,
        "failureMode": "fragment",
        "connectsInSurvival": false,
        "isWeldable": true,
        "weldDamage": 2,
        "weldStressPenalty": 2,
        "minimumSpread": 0.025,
        "spreadReductionPerBarrel": 1.4
    },
    "wrought_iron": {
        "minimumVelocityPerBarrel": 2.0,
        "weight": 2.0,
        "maxSafePropellantStress": 1,
        "failureMode": "fragment",
        "connectsInSurvival": true,
        "isWeldable": false,
        "weldDamage": 0,
        "weldStressPenalty": 0,
        "minimumSpread": 0.1,
        "spreadReductionPerBarrel": 1.0
    }
};
