import { ASSIGNMENT_STATUS_ACCENTS, serviceCenterDesignTokens } from '@service-center/shared';

const cssName = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** Install the same tokens native consumes before the first React render. */
export const applyDesignTokens = (): void => {
  const style = document.documentElement.style;
  for (const [shade, color] of Object.entries(serviceCenterDesignTokens.brand)) {
    style.setProperty(`--app-brand-${shade}`, color);
  }
  for (const [scheme, tokens] of Object.entries(serviceCenterDesignTokens.schemes)) {
    for (const [name, color] of Object.entries(tokens.color)) {
      style.setProperty(`--app-${scheme}-${cssName(name)}`, color);
    }
    for (const [name, accent] of Object.entries(tokens.accent)) {
      style.setProperty(`--app-${scheme}-${name}-bg`, accent.bg);
      style.setProperty(`--app-${scheme}-${name}-fg`, accent.fg);
    }
  }
  // Indirect through the scheme-switched accent variables, so `.dark` still applies.
  for (const [status, accent] of Object.entries(ASSIGNMENT_STATUS_ACCENTS)) {
    style.setProperty(`--app-status-${status}-bg`, `var(--app-${accent}-bg)`);
    style.setProperty(`--app-status-${status}-fg`, `var(--app-${accent}-fg)`);
  }
  for (const [name, radius] of Object.entries(serviceCenterDesignTokens.radius)) {
    style.setProperty(`--app-radius-${name}`, `${radius}px`);
  }
};
