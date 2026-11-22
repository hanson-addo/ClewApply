/** Injected into a LinkedIn profile tab only when the user presses Fill in the popup (#130 step 3). */

import { LINKEDIN } from "./linkedinForms";
import { listen } from "./listen";

listen("linkedin", LINKEDIN);
