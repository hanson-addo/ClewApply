// Generated from tokens.json by build.mjs. Do not edit by hand.
export const tokens = {
  "color": {
    "ink": {
      "50": "#F4F2FF",
      "100": "#EDEBF5",
      "150": "#E4E2EE",
      "200": "#DCDAE8",
      "300": "#C3C7DD",
      "400": "#7D82A0",
      "500": "#4A578A",
      "600": "#454B66",
      "700": "#2A3560",
      "800": "#1C2750",
      "900": "#101935"
    },
    "coral": {
      "100": "#FFE9E3",
      "400": "#FF8A6E",
      "500": "#FF6B4A",
      "600": "#D4421F",
      "700": "#B23A1E",
      "800": "#8A2A12"
    },
    "green": {
      "100": "#DDF1E4",
      "600": "#2E7D4F",
      "800": "#1F5E3A"
    },
    "amber": {
      "100": "#FBEEDC",
      "600": "#C77A1E",
      "800": "#7A3A05"
    },
    "berry": {
      "100": "#FCE8EE",
      "700": "#A3123A"
    },
    "blue": {
      "100": "#E3ECF8",
      "700": "#1E4E8C"
    },
    "white": "#FFFFFF"
  },
  "semantic": {
    "bg-page": "#EDEBF5",
    "bg-surface": "#FFFFFF",
    "bg-subtle": "#F4F2FF",
    "bg-sunken": "#E4E2EE",
    "bg-inverse": "#101935",
    "bg-inverse-raised": "#2A3560",
    "bg-selected": "#FFE9E3",
    "text-primary": "#101935",
    "text-secondary": "#454B66",
    "text-accent": "#B23A1E",
    "text-selected": "#8A2A12",
    "text-on-inverse": "#F4F2FF",
    "text-on-inverse-muted": "#C3C7DD",
    "text-link": "#B23A1E",
    "text-link-hover": "#8A2A12",
    "text-link-on-inverse": "#FF8A6E",
    "border-subtle": "#DCDAE8",
    "border-control": "#7D82A0",
    "border-strong": "#101935",
    "border-inverse": "#4A578A",
    "action-primary-bg": "#FF6B4A",
    "action-primary-bg-hover": "#FF8A6E",
    "action-primary-fg": "#101935",
    "action-secondary-bg": "#FFFFFF",
    "action-secondary-border": "#7D82A0",
    "action-secondary-fg": "#101935",
    "action-inverse-bg": "#101935",
    "action-inverse-fg": "#F4F2FF",
    "focus-ring": "#D4421F",
    "focus-ring-on-inverse": "#FF6B4A",
    "control-accent": "#D4421F",
    "status-success-bg": "#DDF1E4",
    "status-success-fg": "#1F5E3A",
    "status-success-edge": "#2E7D4F",
    "status-warning-bg": "#FBEEDC",
    "status-warning-fg": "#7A3A05",
    "status-warning-edge": "#C77A1E",
    "status-danger-bg": "#FCE8EE",
    "status-danger-fg": "#A3123A",
    "status-danger-edge": "#A3123A",
    "status-info-bg": "#E3ECF8",
    "status-info-fg": "#1E4E8C",
    "status-info-edge": "#1E4E8C"
  },
  "font": {
    "family": {
      "display": "'Syne', 'Figtree', system-ui, sans-serif",
      "body": "'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif",
      "mono": "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    },
    "weight": {
      "regular": "400",
      "semibold": "600",
      "bold": "700",
      "heavy": "800"
    },
    "size": {
      "xs": "0.8125rem",
      "sm": "0.875rem",
      "md": "1rem",
      "lg": "1.125rem",
      "xl": "1.25rem",
      "2xl": "1.5rem",
      "3xl": "clamp(1.75rem, 1.3rem + 1.8vw, 2.25rem)",
      "4xl": "clamp(2rem, 1.4rem + 2.6vw, 2.75rem)",
      "hero": "clamp(2.5rem, 1.5rem + 4.4vw, 3.75rem)"
    },
    "line-height": {
      "tight": "1.05",
      "snug": "1.2",
      "normal": "1.5"
    },
    "letter-spacing": {
      "display": "-0.02em",
      "normal": "0",
      "caps": "0.02em"
    }
  },
  "space": {
    "0": "0",
    "1": "0.25rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "8": "2rem",
    "10": "2.5rem",
    "12": "3rem",
    "16": "4rem"
  },
  "radius": {
    "sm": "8px",
    "md": "10px",
    "lg": "14px",
    "xl": "18px",
    "2xl": "24px",
    "pill": "999px"
  },
  "size": {
    "touch-target": "44px",
    "control-height": "48px",
    "control-height-lg": "56px",
    "icon": "20px",
    "avatar": "40px",
    "container": "1120px",
    "container-wide": "1280px",
    "reading": "680px"
  },
  "shadow": {
    "raised": "0 1px 2px rgba(16, 25, 53, 0.08), 0 4px 12px rgba(16, 25, 53, 0.06)",
    "overlay": "0 12px 40px rgba(16, 25, 53, 0.24)"
  },
  "motion": {
    "duration-fast": "120ms",
    "duration-base": "200ms",
    "easing": "cubic-bezier(0.2, 0, 0, 1)"
  },
  "breakpoint": {
    "sm": "480px",
    "md": "768px",
    "lg": "1024px",
    "xl": "1280px"
  },
  "z": {
    "header": "10",
    "drawer": "20",
    "dialog": "30",
    "toast": "40"
  }
} as const;

export type Tokens = typeof tokens;
export type SemanticColor = keyof Tokens["semantic"];

/** CSS custom property for a semantic color, e.g. cssVar("text-primary"). */
export const cssVar = (name: SemanticColor): string => `var(--clew-${name})`;
