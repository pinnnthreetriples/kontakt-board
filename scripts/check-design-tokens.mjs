import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const roots = ['src/entities', 'src/features', 'src/pages', 'src/widgets', 'src/app'];
const extensions = new Set(['.ts', '.tsx', '.css']);
const colorPattern = /#[0-9a-f]{3,8}\b|rgba?\s*\(/gi;
const rawVisualValuePattern = /(?:fontWeight|fontSize|borderRadius|width|minWidth|maxWidth|height|minHeight|maxHeight|top|right|bottom|left)\s*:\s*(?:-?\d+(?:\.\d+)?|['"`](?:\d|calc\(|50%|100vh|92vw))/g;
const rawVisualPropPattern = /(?:fontWeight|width|minWidth|maxWidth|height|minHeight|maxHeight)=\{\d+(?:\.\d+)?\}/g;
// В sx числовой borderRadius умножается на shape.borderRadius темы: tokens.radius.md
// превращается в 144px. В компонентах радиус берётся только из tokens.radiusCss.
const themeScaledRadiusPattern = /borderRadius:\s*tokens\.radius\./g;
const separatorDots = ['·', '•', '∙', '‧'];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  }));
  return groups.flat();
}

const files = (await Promise.all(roots.map((root) => collect(root)))).flat().filter((file) => extensions.has(extname(file)));
const violations = [];
for (const file of files) {
  const content = await readFile(file, 'utf8');
  if (colorPattern.test(content) || rawVisualValuePattern.test(content) || rawVisualPropPattern.test(content) || themeScaledRadiusPattern.test(content)) violations.push(file);
  colorPattern.lastIndex = 0;
  rawVisualValuePattern.lastIndex = 0;
  rawVisualPropPattern.lastIndex = 0;
  themeScaledRadiusPattern.lastIndex = 0;
}

// Точка-разделитель ищется по всему src, а не только в UI-слоях: строку с ней
// легко собрать в shared и вывести в интерфейс уже готовой.
const dotFiles = (await collect('src')).filter((file) => extensions.has(extname(file)));
const dotViolations = [];
for (const file of dotFiles) {
  const content = await readFile(file, 'utf8');
  if (separatorDots.some((dot) => content.includes(dot))) dotViolations.push(file);
}

if (violations.length > 0) console.error(`Цвета, размеры, радиусы и веса должны идти через design tokens (радиус в sx — только tokens.radiusCss):\n${violations.join('\n')}`);
if (dotViolations.length > 0) console.error(`Точка-разделитель (${separatorDots.join(' ')}) запрещена, разделяйте запятой:\n${dotViolations.join('\n')}`);
if (violations.length > 0 || dotViolations.length > 0) process.exit(1);
console.log(`Design tokens: OK (${files.length} файлов, точки-разделители: ${dotFiles.length})`);
