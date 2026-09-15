const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const metaFile = path.join(dataDir, 'meta.js');

const files = fs.readdirSync(dataDir).filter(
  f => f.endsWith('.js') && f !== 'meta.js'
);

let latestMtime = 0;
const colors = {};

for (const file of files) {
  const filePath = path.join(dataDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const mtime = fs.statSync(filePath).mtimeMs;

  if (mtime > latestMtime) latestMtime = mtime;

  const matches = content.match(/\{\s*"?id"?\s*:/g);
  const count = matches ? matches.length : 0;
  const key = path.basename(file, '.js');
  colors[key] = { count };
}

const lastUpdated = new Date(latestMtime).toISOString().slice(0, 10);

const output = `const CATALOG_META = ${JSON.stringify({ lastUpdated, colors }, null, 2)};\n`;
fs.writeFileSync(metaFile, output, 'utf8');

console.log(`Written data/meta.js — lastUpdated: ${lastUpdated}`);
