import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist/server/shared', { recursive: true });
copyFileSync('src/shared/scoreStructural.js', 'dist/server/shared/scoreStructural.js');
mkdirSync('dist/server/client/assets', { recursive: true });
for (const name of ['bricolage-grotesque-latin-variable.woff2', 'BricolageGrotesque-OFL.txt']) copyFileSync('src/client/assets/' + name, 'dist/server/client/assets/' + name);
