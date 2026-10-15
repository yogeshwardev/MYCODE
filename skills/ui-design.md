---
name: ui-design
description: Design polished, modern interfaces - layout, typography, color, spacing, components, design systems, landing pages and dashboards - and implement them faithfully in code.
triggers: design, redesign, make it look, ui looks, beautiful, modern ui, landing page, dashboard, design system, styling, theme, dark mode, tailwind, figma, polish the ui
---
1. **Start from the product**: who uses it, for how long, on which devices, and the one primary action per screen. Long-session tools need calm, low-contrast surfaces; marketing pages need a strong hierarchy and a clear call to action.
2. **Foundations first**: a type scale (2–3 sizes per screen, generous line height), a 4/8-px spacing scale, a restrained palette (neutrals plus one accent; color for status only), consistent radii and borders, and design tokens as CSS variables or theme config.
3. **Layout**: a clear grid, aligned edges, enough whitespace, and content-first widths (about 60–80 characters for text). Group related controls; remove anything that doesn't earn its place.
4. **Components**: consistent states for every interactive element (hover, focus-visible, active, disabled, loading), empty and error states, and accessible contrast (WCAG AA). Reuse the project's component library before creating new ones.
5. **Motion**: short (120–200 ms), purposeful transitions; respect `prefers-reduced-motion`.
6. **Verify visually**: run the app and inspect it with the browser tools at mobile and desktop widths, take screenshots, and iterate on spacing, alignment and contrast until it looks deliberate.
