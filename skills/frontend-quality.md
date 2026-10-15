---
name: frontend-quality
description: Build or review web UI with production quality - accessibility (WCAG 2.2 AA), responsive layout, performance, state handling and security.
triggers: ui, frontend, component, css, html, react, vue, svelte, next.js, accessib, a11y, wcag, responsive, layout, page, form, login, sign in, signup, sign up, button, modal, navbar
---
1. **Match the stack and design system** in use (framework, component library, CSS approach, tokens). Reuse existing components before creating new ones.
2. **Accessibility (WCAG 2.2 AA)**: semantic HTML first (button, nav, main, label), every input labelled, images with meaningful `alt` (empty for decorative), keyboard operable with a visible focus ring, logical focus order and focus management in dialogs, color contrast >= 4.5:1 for text, no information conveyed by color alone, `prefers-reduced-motion` respected, ARIA only when native semantics are insufficient.
3. **Responsive**: mobile-first layouts that work from 320px wide, no horizontal scroll, touch targets of at least 24x24 CSS px (44 recommended), fluid typography.
4. **States**: every async view has loading, empty, error and success states; forms show inline validation and preserve input on error; optimistic updates roll back on failure.
5. **Performance**: avoid layout shift (reserve image sizes), lazy-load below-the-fold media, memoize expensive renders only when measured, keep bundles small (dynamic import for heavy routes).
6. **Security**: never render untrusted HTML without sanitizing; no secrets in client code; validate on the server too.
7. **Verify** in a browser at mobile and desktop widths (and with the keyboard only) when tools are available; run the project's lint/type checks and component tests.
