const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function (file) {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('src/components');
let count = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Skip if we already added useBackButton
  if (content.includes('useBackButton')) {
    continue;
  }

  // Find the effect that attaches escape
  const effectRegex = /const handler = \(e: KeyboardEvent\) => \{ if \(e\.key === "Escape"\) onClose\(\); \};[\r\n\s]+window\.addEventListener\("keydown", handler\);[\r\n\s]+return \(\) => window\.removeEventListener\("keydown", handler\);[\r\n\s]+\}, \[onClose\]\);/ms;

  if (effectRegex.test(content)) {
    console.log('Patching: ' + file);

    // Auto-add import
    const importRegex = /^import.+?;$/gm;
    let match;
    let lastMatch;
    while ((match = importRegex.exec(content)) !== null) {
      lastMatch = match;
    }

    if (lastMatch) {
      const idx = lastMatch.index + lastMatch[0].length;
      content = content.slice(0, idx) + '\nimport { useBackButton } from "@/hooks/useBackButton";' + content.slice(idx);
    }

    // Apply hook replacement
    content = content.replace(effectRegex, (match) => {
      return match + '\n\n  useBackButton(() => { onClose(); return true; }, true);';
    });

    // Check if we also need useCallback inside useBackButton
    // The previous replace was just an inline arrow function, but wait, `useBackButton`'s dependencies
    // useEffect in useBackButton uses `handler` as a dep.
    // If we pass an inline `() => { onClose(); return true; }`, it re-renders and re-registers the listener every time it renders.
    // So we should wrap it in `useCallback`.
    if (!content.includes('useCallback')) {
      // add useCallback import
      content = content.replace(/import \{.*?\} from "react";/, (m) => {
        if (m.includes('useCallback')) return m;
        return m.replace('import { ', 'import { useCallback, ');
      });
    }

    content = content.replace(
      /useBackButton\(\(\) => \{ onClose\(\); return true; \}, true\);/,
      'useBackButton(\n    useCallback(() => {\n      onClose();\n      return true;\n    }, [onClose])\n  );'
    );

    fs.writeFileSync(file, content);
    count++;
  }
}

console.log('Total patched: ' + count);
