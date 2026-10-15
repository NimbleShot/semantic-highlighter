// The heat scale, cool → warm. The build writes content.css from this, and the minimap
// uses the same hues at full opacity.

export const HEAT = [
  [59, 130, 246, 0.1],
  [59, 130, 246, 0.22],
  [45, 212, 191, 0.28],
  [163, 230, 53, 0.34],
  [250, 204, 21, 0.42],
  [251, 146, 60, 0.5],
  [239, 68, 68, 0.5],
  [220, 38, 38, 0.68],
];
export const SOURCE = [147, 51, 234, 0.28];

export const rgba = ([r, g, b, a], alpha = a) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export function highlightCss() {
  const rules = HEAT.map((c, i) => `::highlight(semhl-${i}) { background-color: ${rgba(c)}; }`);
  rules.push(
    `::highlight(semhl-source) { background-color: ${rgba(SOURCE)}; text-decoration: underline dotted ${rgba(SOURCE, 1)} 2px; }`,
    `::highlight(semhl-focus) { text-decoration: underline solid ${rgba(HEAT[7], 1)} 3px; text-underline-offset: 3px; }`,
  );
  return `/* Generated from src/content/colors.js */\n${rules.join('\n')}\n`;
}
