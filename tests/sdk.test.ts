import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TungoClient,
  TungoWebhooks,
  TungoHooks,
  TungoMoney,
  TungoKazakhstan,
  TungoPaymentRequiredError,
  TungoRateLimitError,
  parseSSEText,
  accumulateChatStream,
  redactHeaders,
} from '../src/index.ts';

const vectors = JSON.parse(
  readFileSync(new URL('../conformance/vectors.json', import.meta.url), 'utf8'),
);

describe('Tungo TypeScript SDK conformance & ergonomics', () => {
  it('verifies Svix & Standard Webhooks signatures (webhook-* and svix-* headers, dual, expired, invalid)', () => {
    const w = vectors.webhook_verification;
    const headers = {
      'webhook-id': w.msg_id,
      'webhook-timestamp': String(w.timestamp),
      'webhook-signature': w.valid_signature,
    };
    assert.equal(TungoWebhooks.verifySignature(w.body, headers, w.secret, 300, w.timestamp + 10), true);

    // svix-* headers compatibility
    const svixHeaders = {
      'svix-id': w.msg_id,
      'svix-timestamp': String(w.timestamp),
      'svix-signature': w.valid_signature,
    };
    assert.equal(TungoWebhooks.verifySignature(w.body, svixHeaders, w.secret, 300, w.timestamp + 10), true);

    // Ротация секрета: две подписи через пробел
    const dualHeaders = { ...headers, 'webhook-signature': w.dual_signature };
    assert.equal(TungoWebhooks.verifySignature(w.body, dualHeaders, w.secret, 300, w.timestamp + 10), true);

    // Устаревшая метка времени (> 300 с)
    assert.equal(TungoWebhooks.verifySignature(w.body, headers, w.secret, 300, w.timestamp + 600), false);

    // Неверная подпись
    const badHeaders = { ...headers, 'webhook-signature': w.bad_signature };
    assert.equal(TungoWebhooks.verifySignature(w.body, badHeaders, w.secret, 300, w.timestamp + 10), false);

    const parsed = TungoWebhooks.verifyAndParse<{ id: string; type: string }>(w.body, headers, w.secret, 300, w.timestamp);
    assert.equal(parsed.type, 'proposal.written');
  });

  it('signs and verifies incoming automation hook payloads with HMAC-SHA256 (with and without sha256= prefix)', () => {
    const h = vectors.incoming_hook;
    assert.equal(TungoHooks.signPayload(h.body, h.secret, false), h.hex_signature);
    assert.equal(TungoHooks.signPayload(h.body, h.secret, true), h.prefixed_signature);
    assert.equal(TungoHooks.verifySignature(h.body, h.prefixed_signature, h.secret), true);
    assert.equal(TungoHooks.verifySignature(h.body, h.hex_signature, h.secret), true);
    assert.equal(TungoHooks.verifySignature(h.body, 'sha256=deadbeef', h.secret), false);
  });

  it('converts and formats money in tiyn and validates Kazakhstan BIN/IIN', () => {
    for (const m of vectors.money) {
      assert.equal(TungoMoney.toTiyn(m.tenge), m.tiyn);
      assert.equal(TungoMoney.toTenge(m.tiyn), m.tenge);
      assert.equal(TungoMoney.formatTiyn(m.tiyn), m.formatted);
    }
    for (const b of vectors.bin_iin) {
      assert.equal(TungoKazakhstan.isValidBinIin(b.value), b.valid, 'BIN/IIN ' + b.value);
    }
  });

  it('parses and accumulates SSE event streams', async () => {
    const events = parseSSEText(vectors.sse.raw_stream);
    assert.equal(events.length, vectors.sse.events.length);
    assert.equal(events[0].event, 'text');
    assert.equal(events[2].event, 'done');

    const deltas: string[] = [];
    const acc = await accumulateChatStream(events, (d) => deltas.push(d));
    assert.equal(acc.text, vectors.sse.expected_text);
    assert.equal(acc.dialogId, 'dlg_01');
    assert.equal(acc.costTiyn, 185);
    assert.equal(deltas.join(''), vectors.sse.expected_text);
  });

  it('handles ask(), default companyId, listAll(), retries on 429, requestRaw(), hooks, and error hints', async () => {
    let calls = 0;
    const reqHooks: string[] = [];
    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      calls++;
      const url = String(input);
      if (url.endsWith('/v1/companies/co_1/chat')) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.stream, false);
        assert.equal(body.message, 'Привет');
        return new Response(
          JSON.stringify({
            dialog_id: 'dlg_1',
            turn_no: 1,
            answer: 'Здравствуйте! Чем помочь?',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost_tiyn: 120 },
          }),
          { status: 200, headers: { 'x-request-id': 'req_chat_1', 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '59', 'x-ratelimit-reset': '45' } },
        );
      }
      if (url.includes('/v1/companies/co_1/proposals')) {
        const u = new URL(url);
        const cursor = u.searchParams.get('cursor');
        if (!cursor) {
          return new Response(
            JSON.stringify({ data: [{ id: 'P-000001' }, { id: 'P-000002' }], next_cursor: 'cur_2' }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ data: [{ id: 'P-000003' }], next_cursor: null }),
          { status: 200 },
        );
      }
      if (url.endsWith('/v1/api-key')) {
        if (calls === 1) {
          return new Response(vectors.errors[1].body, { status: 429, headers: { 'retry-after': '0' } });
        }
        return new Response(JSON.stringify({ id: 'key_1', name: 'Test' }), { status: 200, headers: { 'x-request-id': 'req_key_1' } });
      }
      return new Response(vectors.errors[0].body, { status: 402 });
    };

    const client = new TungoClient({
      apiKey: 'tg_test_123',
      companyId: 'co_1',
      workspaceId: 'ws_1',
      baseUrl: 'https://api.tungo.kz',
      fetch: mockFetch,
      onRequest: (info) => reqHooks.push(info.method + ' ' + info.headers['x-api-key']),
    });

    // Redaction check
    assert.equal(redactHeaders({ 'x-api-key': 'tg_secret' })['x-api-key'], '[REDACTED]');

    // Retry on 429 -> 200 + requestRaw()
    const rawKey = await client.requestRaw<{ id: string }>('GET', '/v1/api-key', { auth: 'bearer', retrySafe: true });
    assert.equal(rawKey.data.id, 'key_1');
    assert.equal(rawKey.requestId, 'req_key_1');
    assert.ok(reqHooks.every((h) => h.includes('[REDACTED]')));

    // ask() helper (both with explicit co_1 and with default companyId)
    const reply = await client.ask('co_1', 'Привет');
    assert.equal(reply.answer, 'Здравствуйте! Чем помочь?');
    assert.equal(client.lastRateLimit?.remaining, 59);

    // listAll() pagination
    const ids: string[] = [];
    for await (const p of client.proposals.listAll('co_1')) {
      ids.push(p.id);
    }
    assert.deepEqual(ids, ['P-000001', 'P-000002', 'P-000003']);

    // Typed 402 error with hint
    await assert.rejects(
      () => client.platform.getAccount('ws_1'),
      (err: unknown) => {
        assert.ok(err instanceof TungoPaymentRequiredError);
        assert.equal(err.errorCode, 'platform_balance_exhausted');
        assert.equal(err.hint, vectors.errors[0].hint);
        assert.equal(err.requestId, 'req_01jbalance001');
        return true;
      },
    );
  });
});
