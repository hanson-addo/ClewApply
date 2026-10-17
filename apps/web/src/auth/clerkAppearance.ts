import { tokens } from "@clew/design-tokens";

/**
 * Clerk's sign-in widgets, themed to the design tokens. Clerk derives hover and pressed shades
 * from these, so it needs real color values rather than CSS variables.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: tokens.color.coral["500"],
    colorPrimaryForeground: tokens.color.ink["900"],
    colorForeground: tokens.color.ink["900"],
    colorMutedForeground: tokens.color.ink["600"],
    colorBackground: tokens.color.white,
    colorInput: tokens.color.white,
    colorInputForeground: tokens.color.ink["900"],
    colorDanger: tokens.color.berry["700"],
    colorRing: tokens.color.coral["600"],
    fontFamily: "Figtree, system-ui, sans-serif",
    fontFamilyButtons: "Figtree, system-ui, sans-serif",
    borderRadius: "14px",
  },
  layout: {
    socialButtonsVariant: "blockButton",
    logoPlacement: "none",
  },
} as const;
