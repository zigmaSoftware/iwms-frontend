import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Evaluate only the plain resource objects, never application modules.
function resource(lang) {
  const source = fs.readFileSync(`src/locales/${lang}.ts`, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', compiled)(exports);
  return exports.default.translation;
}
function flatten(value, prefix = '', result = new Set()) {
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object') flatten(item, name, result);
    else result.add(name);
  }
  return result;
}
const keys = Object.fromEntries(['en', 'ta', 'hi'].map(lang => [lang, flatten(resource(lang))]));
const findings = [];
for (const lang of ['ta', 'hi']) {
  for (const key of keys.en) {
    if (!keys[lang].has(key)) findings.push({ type: 'missing-translation', lang, key });
  }
}
function visitDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (file !== 'src/locales') visitDirectory(file); continue; }
    if (!/\.tsx?$/.test(file)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) &&
          (ts.isIdentifier(node.expression) && node.expression.text === 't' ||
           ts.isPropertyAccessExpression(node.expression) && node.expression.getText(source) === 'i18n.t')) {
        const key = node.arguments[0];
        if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
            !keys.en.has(key.text)) {
          findings.push({ type: 'undefined-key', file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, key: key.text });
        }
      }
      if (ts.isJsxText(node) && /[A-Za-z]{2}/.test(node.text.trim())) {
        findings.push({ type: 'literal-jsx-text', file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: node.text.trim().replace(/\s+/g, ' ') });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
visitDirectory('src');
if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 2));
else {
  const counts = {};
  for (const finding of findings) counts[finding.type] = (counts[finding.type] || 0) + 1;
  console.log(JSON.stringify(counts, null, 2));
  console.log('Run node scripts/audit-locales.mjs --json for locations. Dynamic keys and attributes also require review.');
}
process.exitCode = findings.length ? 1 : 0;
