const fs = require('fs');

const file = 'src/stores/chat-actions.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /const ([\w_]+) = \(?await res\.json\(\)\)? as (.*?);/g,
  "const __json_$1 = await res.json();\n    const $1 = (__json_$1.data ?? __json_$1) as $2;"
);

fs.writeFileSync(file, content);
console.log('Done');
