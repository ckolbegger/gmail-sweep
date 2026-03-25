import { buildServer } from './server.js';

const app = await buildServer();

try {
  await app.listen({ port: 3141, host: '127.0.0.1' });
  console.log('Backend running at http://localhost:3141');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
