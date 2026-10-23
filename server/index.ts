import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const app = createApp();
const server = app.listen(port, host, () => {
  console.info(`Ddukttak workspace server listening on ${host}:${port}`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.warn('This is a single-user workspace without sign-in. Do not expose this server to the public Internet without an authentication gateway.');
  }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
