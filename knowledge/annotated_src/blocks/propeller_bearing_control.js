/* CLAUDE-MAP-BEGIN
 FILE: blocks/propeller_bearing_control.js  (1 KB, 41 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, @minecraft/server-ui
 IMPORTED BY: main.js
 EXPORTS: registerPropellerBearingControl, showPropellerBearingControl
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): showPropellerBearingControl@15(26L); registerPropellerBearingControl@7(8L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { system } from "@minecraft/server";
import { CustomForm, ObservableBoolean } from "@minecraft/server-ui";

const TYPE = "create_physics:propeller_bearing";
const STATE = "create_physics:push_forward";
// шаг 138: «Башня конструкции». Физика включается рычагом контроллера, поставленного на башню (как у обычной конструкции).
export function registerPropellerBearingControl(registry) {
  registry.registerCustomComponent("create_physics:propeller_bearing_control", {
    onPlayerInteract({ block, player }) {
      if (!player || !block) return;
      system.run(() => { try { player.onScreenDisplay.setActionBar("§7Башня: поставьте на неё контроллер и включите рычаг"); } catch {} });
    }
  });
}
export async function showPropellerBearingControl(player, session, bearing, persist = () => {}) {
  let forward, subscription;
  try {
    forward = new ObservableBoolean(bearing.permutation.getState(STATE) !== false, { clientWritable: true });
    const apply = () => {
      if (!player.isValid || (session && (!session.assembly?.isValid || !session.snapshots.includes(bearing)))) return;
      if (bearing.typeId !== TYPE) return;
      const permutation = bearing.permutation.withState(STATE, forward.getData() === true);
      if (session) {
        bearing.permutation = permutation;
        session.assembly.body.wakeUp();
        persist(session);
      } else bearing.setPermutation(permutation);
    };
    subscription = forward.subscribe(apply);
    const form = new CustomForm(player, "Propeller Bearing");
    form.label("Enabled: forward thrust. Disabled: reverse thrust.");
    form.toggle("Forward thrust", forward);
    form.closeButton();
    await form.show();
  } catch (error) {
    console.warn(`[Create Physics] propeller bearing control: ${error}`);
  } finally {
    if (forward && subscription) forward.unsubscribe(subscription);
  }
}
