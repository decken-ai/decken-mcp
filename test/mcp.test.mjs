import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveSafeBaseUrl } from '../src/mcp-server.mjs';

const MOCK_PPTX = Buffer.from('PK\x03\x04mcp-native-pptx');
const MOCK_PNG = Buffer.from('\x89PNG\r\n\x1a\nmcp-preview');

test('decken-mcp stdio server handles initialize, tools, resources, prompts, sync/async PPTX output, and origin safety', async () => {
  assert.throws(
    () => resolveSafeBaseUrl({ DECKEN_BASE_URL: 'http://insecure.example.com', DECKEN_API_KEY: 'secret' }),
    /Refusing non-HTTPS/,
  );

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/v1/capabilities') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'decken-reconstruct-api', defaultModelId: 'qwen/qwen3.8-flash' }));
      return;
    }
    if (url.pathname === '/v1/openapi.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ openapi: '3.1.0' }));
      return;
    }
    if (url.pathname === '/v1/decks' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const scenario = body.source
        ? 'improve_material'
        : body.reference
          ? 'from_outline_with_reference'
          : 'from_outline';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jobId: 'deck_mcp_1',
          scenario,
          status: 'completed',
          pptxUrl: '/v1/decks/deck_mcp_1/pptx',
          pollUrl: '/v1/decks/deck_mcp_1',
          pptxBase64: MOCK_PPTX.toString('base64'),
          metrics: { slideCount: 2, totalObjectCount: 22 },
          agentDiagnostics: { editabilityVerdict: 'native_editable' },
          usage: { totalTokens: 2500, costUsd: 0.0011 },
          slides: [],
        }),
      );
      return;
    }
    if (url.pathname === '/v1/reconstruct' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const isAsync = body.mode === 'async';
      res.writeHead(isAsync ? 202 : 200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jobId: 'job_mcp_1',
          status: isAsync ? 'running' : 'completed',
          pptxUrl: '/v1/jobs/job_mcp_1/pptx',
          pollUrl: '/v1/jobs/job_mcp_1',
          pptxBase64: isAsync ? undefined : MOCK_PPTX.toString('base64'),
          metrics: { slideCount: body.slides?.length || 1, totalObjectCount: 19, meanWholePageMae: 0.016 },
          usage: { totalTokens: 3200, costUsd: 0.0014 },
          slides: [{ slideId: 's1', previewUrl: '/v1/jobs/job_mcp_1/slides/s1/preview.png' }],
        }),
      );
      return;
    }
    if (url.pathname === '/v1/jobs/job_mcp_1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jobId: 'job_mcp_1',
          status: 'completed',
          pptxUrl: '/v1/jobs/job_mcp_1/pptx',
          metrics: { slideCount: 2, totalObjectCount: 38 },
          usage: { totalTokens: 6400, costUsd: 0.0028 },
          slides: [{ slideId: 's1', previewUrl: '/v1/jobs/job_mcp_1/slides/s1/preview.png' }],
        }),
      );
      return;
    }
    if (url.pathname === '/v1/jobs/job_mcp_1/pptx') {
      res.writeHead(200);
      res.end(MOCK_PPTX);
      return;
    }
    res.writeHead(200);
    res.end(MOCK_PNG);
  });

  const scratch = await mkdtemp(join(tmpdir(), 'decken-mcp-test-'));
  let child;
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const binPath = new URL('../bin/decken-mcp.mjs', import.meta.url).pathname;

    child = spawn(process.execPath, [binPath], {
      env: { ...process.env, DECKEN_BASE_URL: baseUrl, DECKEN_API_KEY: 'mcp_test_key' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const pending = new Map();
    let stdoutBuf = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        const parsed = JSON.parse(line);
        pending.get(parsed.id)?.(parsed);
      }
    });

    let nextId = 1;
    function rpc(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    }

    const init = await rpc('initialize', { protocolVersion: '2024-11-05' });
    assert.equal(init.result.serverInfo.name, 'decken-mcp');

    const tools = await rpc('tools/list');
    assert.equal(tools.result.tools.length, 7);

    const genOut = join(scratch, 'gen.pptx');
    const genCall = await rpc('tools/call', {
      name: 'decken_generate',
      arguments: { outline: '## Slide 1\n- Fact', outputPath: genOut },
    });
    assert.ok(!genCall.result.isError);
    assert.deepEqual(await readFile(genOut), MOCK_PPTX);

    const resources = await rpc('resources/list');
    assert.equal(resources.result.resources.length, 3);

    const guide = await rpc('resources/read', { uri: 'decken://guide/slide-design-for-openxml' });
    assert.match(guide.result.contents[0].text, /1920x1080/);

    const prompt = await rpc('prompts/get', { name: 'design-and-reconstruct-deck', arguments: { topic: 'AI Infra', slideCount: '4' } });
    assert.match(prompt.result.messages[0].content.text, /decken_reconstruct_deck/);

    const img = join(scratch, 'slide.png');
    await writeFile(img, MOCK_PNG);

    const singleOut = join(scratch, 'single.pptx');
    const singleCall = await rpc('tools/call', {
      name: 'decken_reconstruct_slide',
      arguments: { imagePath: img, outputPath: singleOut },
    });
    assert.ok(!singleCall.result.isError);
    assert.deepEqual(await readFile(singleOut), MOCK_PPTX);

    const urlOut = join(scratch, 'url.pptx');
    const urlCall = await rpc('tools/call', {
      name: 'decken_reconstruct_slide',
      arguments: { imageUrl: 'https://cdn.example.com/slides/board-01.png', outputPath: urlOut },
    });
    assert.ok(!urlCall.result.isError);
    assert.deepEqual(await readFile(urlOut), MOCK_PPTX);

    const deckOut = join(scratch, 'deck.pptx');
    const deckCall = await rpc('tools/call', {
      name: 'decken_reconstruct_deck',
      arguments: { imagePaths: [img, img], outputPath: deckOut, pollIntervalMs: 20 },
    });
    assert.ok(!deckCall.result.isError);
    assert.deepEqual(await readFile(deckOut), MOCK_PPTX);
  } finally {
    child?.kill();
    server.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
