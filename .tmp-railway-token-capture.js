const http = require('http');
const fs = require('fs');
const path = require('path');
const out = path.join(process.env.TEMP, 'railway-project-token-capture.txt');
http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    fs.writeFileSync(out, body);
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('ok');
  });
}).listen(52156, '127.0.0.1', () => console.log('LISTENING 52156'));
setInterval(() => {}, 1 << 30);
