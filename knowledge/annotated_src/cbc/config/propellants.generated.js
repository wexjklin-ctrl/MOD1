/* CLAUDE-MAP-BEGIN
 FILE: cbc/config/propellants.generated.js  (0 KB, 23 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) АВТОГЕНЕРАЦИЯ tools/gen_configs.py. Не править руками. Источник: munition_properties/block_propellant
 IMPORTS: -
 IMPORTED BY: cbc/fire.js
 EXPORTS: PROPELLANTS
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// АВТОГЕНЕРАЦИЯ tools/gen_configs.py. Не править руками. Источник: munition_properties/block_propellant
export const PROPELLANTS = {
    "big_cartridge": {
        "strength": 2,
        "addedStress": 0.5,
        "addedRecoil": 2,
        "addedSpread": 2,
        "explosionPower": 1.5,
        "dampAmmoStrengthDebuff": 0.5,
        "dampAmmoDoesntIgniteAsStarter": true,
        "maximumPowerLevels": 4
    },
    "powder_charge": {
        "strength": 2,
        "addedStress": 1,
        "addedRecoil": 2,
        "addedSpread": 2,
        "explosionPower": 6,
        "dampAmmoStrengthDebuff": 0.5,
        "dampAmmoDoesntIgniteAsStarter": true
    }
};
