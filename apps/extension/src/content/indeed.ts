/** Injected into an Indeed profile tab only when the user presses Fill in the popup (#130 step 3b). */

import { INDEED } from "./indeedForms";
import { listen } from "./listen";

listen("indeed", INDEED);
