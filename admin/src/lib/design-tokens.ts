import { serviceCenterDesignTokens } from '@service-center/shared';

const cssName = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** Install the main app's brand, scheme and radius tokens before the first render (as frontend does). */
export const applyDesignTokens = (): void => {
  const style = document.documentElement.style;
  for (const [shade, color] of Object.entries(serviceCenterDesignTokens.brand)) {
    style.setProperty(`--app-brand-${shade}`, color);
  }
  for (const [scheme, tokens] of Object.entries(serviceCenterDesignTokens.schemes)) {
    for (const [name, color] of Object.entries(tokens.color)) {
      style.setProperty(`--app-${scheme}-${cssName(name)}`, color);
    }
  }
  for (const [name, radius] of Object.entries(serviceCenterDesignTokens.radius)) {
    style.setProperty(`--app-radius-${name}`, `${radius}px`);
  }
};
