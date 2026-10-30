import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getText, USER_AGENT } from '../lib/http.js';

let server;
let base;
let lastHeaders;

before(async () => {
  server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      res.end('<rss><channel><item>hello</item></channel></rss>');
    } else if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html>SECRET-BODY-MARKER</html>');
    }
    // any other path: never respond, so the client must time out
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('getText', () => {
  test('returns the response body as text', async () => {
    const body = await getText(`${base}/ok`);
    assert.equal(body, '<rss><channel><item>hello</item></channel></rss>');
  });

  test('sends the project User-Agent and an xml accept header', async () => {
    await getText(`${base}/ok`);
    assert.equal(lastHeaders['user-agent'], USER_AGENT);
    assert.match(lastHeaders.accept, /application\/rss\+xml/);
  });

  test('a non-2xx status rejects with the URL and no body', async () => {
    const url = `${base}/missing`;
    await assert.rejects(getText(url), (err) => {
      assert.ok(err.message.includes(url));
      assert.ok(err.message.includes('404'));
      assert.ok(!err.message.includes('SECRET-BODY-MARKER'));
      return true;
    });
  });

  test('a server that never answers rejects once timeoutMs passes', async () => {
    await assert.rejects(getText(`${base}/hang`, { timeoutMs: 50 }));
  });
});

describe('USER_AGENT', () => {
  test('identifies the tool as job-watch and links its repo', () => {
    assert.match(USER_AGENT, /^job-watch\/\d/);
    assert.ok(USER_AGENT.includes('github.com/konstantinos-malavazos/job-watch'));
  });
});
