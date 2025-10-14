// netlify/functions/_utils.js
const fs = require('fs'); const path = require('path');
function saveJSON(name, data){
  const dir = path.join(__dirname, '..', '..', 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}
module.exports = { saveJSON };
