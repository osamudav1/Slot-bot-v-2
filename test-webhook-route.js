const express = require('express');
const request = require('http');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json());
const bot = new Telegraf('123456:TEST_TOKEN');
let received = false;
bot.handleUpdate = async (update, res) => {
  received = update.message?.text === '/start';
  res.statusCode = 200;
  res.end('OK');
};
app.use('/telegram/webhook', bot.webhookCallback('/'));
const server = app.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const body = JSON.stringify({
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 1, type: 'private' },
      from: { id: 1, is_bot: false, first_name: 'Test' },
      text: '/start'
    }
  });
  const req = request.request({
    host: '127.0.0.1', port, path: '/telegram/webhook', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200 || !received) {
        console.error(`Webhook test failed: status=${res.statusCode}, received=${received}, body=${data}`);
        process.exitCode = 1;
      } else {
        console.log('Webhook route test passed');
      }
      server.close();
    });
  });
  req.on('error', (err) => { console.error(err); process.exitCode = 1; server.close(); });
  req.end(body);
});
