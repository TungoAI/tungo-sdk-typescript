import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TungoClient,
  TungoWebhooks,
  TungoHooks,
  TungoMoney,
  TungoPaymentRequiredError,
  TungoRateLimitError,
  parseSSEText,
} from '../src/index.ts';

const vectors = JSON.parse(
  readFileSync(new URL('../../tungo-sdkgen/conformance/vectors.json', import.meta.url), 'utf8'),
);

describe('Tungo TypeScript SDK conformance & ergonomics', () => {
  it('verifies Svix webhook signatures (single, rotated dual, expired, invalid)', () => {
    const w = vectors.webhook_verification;
    const headers = {
      'webhook-id': w.msg_id,
      'webhook-timestamp': String(w.timestamp),
      'webhook-signature': w.valid_signature,
    };
    assert.equal(TungoWebhooks.verifySignature(w.body, headers, w.secret, 300, w.timestamp + 10), true);

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

  it('signs incoming automation hook payloads with HMAC-SHA256', () => {
    const h = vectors.incoming_hook;
    assert.equal(TungoHooks.signPayload(h.body, h.secret, false), h.hex_signature);
    assert.equal(TungoHooks.signPayload(h.body, h.secret, true), h.prefixed_signature);
  });

  it('converts and formats money in tiyn accurately', () => {
    for (const m of vectors.money) {
      assert.equal(TungoMoney.toTiyn(m.tenge), m.tiyn);
      assert.equal(TungoMoney.toTenge(m.tiyn), m.tenge);
      assert.equal(TungoMoney.formatTiyn(m.tiyn), m.formatted);
    }
  });

  it('parses SSE event streams', () => {
    const events = parseSSEText(vectors.sse.raw_stream);
    assert.equal(events.length, vectors.sse.events.length);
    assert.equal(events[0].event, 'text');
    assert.equal(events[2].event, 'done');
  });

  it('handles ask(), auto-pagination listAll(), retries on 429, and typed errors', async () => {
    let calls = 0;
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
          { status: 200, headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '59', 'x-ratelimit-reset': '45' } },
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
        return new Response(JSON.stringify({ id: 'key_1', name: 'Test' }), { status: 200 });
      }
      return new Response(vectors.errors[0].body, { status: 402 });
    };

    const client = new TungoClient({ apiKey: 'tg_test_123', baseUrl: 'https://api.tungo.kz', fetch: mockFetch });

    // Rety on 429 -> 200
    const keyInfo = await client.apiKeys.getCurrent();
    assert.equal(keyInfo.id, 'key_1');

    // ask() helper
    const reply = await client.ask('co_1', 'Привет');
    assert.equal(reply.answer, 'Здравствуйте! Чем помочь?');
    assert.equal(client.lastRateLimit?.remaining, 59);

    // listAll() pagination
    const ids: string[] = [];
    for await (const p of client.proposals.listAll('co_1')) {
      ids.push(p.id);
    }
    assert.deepEqual(ids, ['P-000001', 'P-000002', 'P-000003']);

    // Typed 402 error
    await assert.rejects(
      () => client.platform.getAccount('ws_1'),
      (err: unknown) => {
        assert.ok(err instanceof TungoPaymentRequiredError);
        assert.equal(err.errorCode, 'platform_balance_exhausted');
        assert.equal(err.requestId, 'req_01jbalance001');
        return true;
      },
    );
  });
});
