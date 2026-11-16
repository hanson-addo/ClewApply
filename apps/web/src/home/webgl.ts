/** Whether this browser can draw the map. Without WebGL, Home shows the list instead. */
export function canDrawMap(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
