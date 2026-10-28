import { readFileSync } from 'node:fs';

// Fixed local assets only. The same relative paths work in source and dist/server.
const font = readFileSync(new URL('../../client/assets/bricolage-grotesque-latin-variable.woff2', import.meta.url));
const license = readFileSync(new URL('../../client/assets/BricolageGrotesque-OFL.txt', import.meta.url), 'utf8');

export const DISPLAY_FONT_CSS = `/* ${license} */
@font-face{font-family:"Bricolage Grotesque";src:url(data:font/woff2;base64,${font.toString('base64')}) format("woff2");font-style:normal;font-weight:200 800;font-display:swap}
h1,h2,h3,.wordmark{font-family:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif}`;
