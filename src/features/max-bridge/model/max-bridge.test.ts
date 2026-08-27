import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_URL,
  describeBridgeError,
  BridgeUnreachableError,
  cancelAuth,
  fetchAuthState,
  logoutMax,
  qrImageSource,
  searchRecipient,
  sendProposal,
  startAuth,
  submitAuthPassword,
} from './max-bridge';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(payload: unknown, jsonBroken = false): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      json: () => (jsonBroken ? Promise.reject(new Error('Unexpected token')) : Promise.resolve(payload)),
    });
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('max-bridge', () => {
  it('ищет получателя и передаёт телефон в исходном виде', async () => {
    const calls = stubFetch({ ok: true, found: true, recipient: 'Иван Петров', status: 'FOUND', detail: 'Найден' });
    const result = await searchRecipient(' +7 909 322-87-01 ');
    expect(result.found).toBe(true);
    expect(result.recipient).toBe('Иван Петров');
    expect(calls[0]?.url).toBe(`${BRIDGE_URL}/search`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(calls[0]?.init.body).toBe(JSON.stringify({ phone: ' +7 909 322-87-01 ' }));
  });

  it('возвращает признаки доставки при отправке', async () => {
    stubFetch({ ok: true, status: 'UNKNOWN', recipient: 'Иван Петров', detail: 'Ответ не получен', delivered: false, uncertain: true });
    const result = await sendProposal('+79093228701', 'Коммерческое предложение');
    expect(result.delivered).toBe(false);
    expect(result.uncertain).toBe(true);
    expect(result.status).toBe('UNKNOWN');
  });

  it('читает состояние авторизации вместе с QR-кодом', async () => {
    const calls = stubFetch({ ok: true, state: 'qr', qrSvg: '<svg><text>Код</text></svg>' });
    const snapshot = await fetchAuthState();
    expect(snapshot.state).toBe('qr');
    expect(snapshot.qrSvg).toContain('svg');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.headers).toBeUndefined();
  });

  it('читает подключённый аккаунт', async () => {
    stubFetch({ ok: true, state: 'connected', account: { name: 'Оператор' } });
    const snapshot = await fetchAuthState();
    expect(snapshot.account?.name).toBe('Оператор');
  });

  it('отправляет пустое тело JSON для действий без параметров', async () => {
    const calls = stubFetch({ ok: true });
    await startAuth();
    await cancelAuth();
    await logoutMax();
    expect(calls.map((call) => call.url)).toEqual([
      `${BRIDGE_URL}/auth/start`,
      `${BRIDGE_URL}/auth/cancel`,
      `${BRIDGE_URL}/auth/logout`,
    ]);
    for (const call of calls) {
      expect(call.init.method).toBe('POST');
      expect(call.init.body).toBe('{}');
      expect(call.init.headers).toEqual({ 'Content-Type': 'application/json' });
    }
  });

  it('передаёт пароль двухфакторной проверки', async () => {
    const calls = stubFetch({ ok: true });
    await submitAuthPassword('секрет');
    expect(calls[0]?.url).toBe(`${BRIDGE_URL}/auth/password`);
    expect(calls[0]?.init.body).toBe(JSON.stringify({ password: 'секрет' }));
  });

  it('показывает сообщение моста при отказе', async () => {
    stubFetch({ ok: false, error: 'MAX не подключён' });
    await expect(searchRecipient('+79093228701')).rejects.toThrow('MAX не подключён');
  });

  it('подставляет текст, если мост отказал без описания', async () => {
    stubFetch({ ok: false, error: '   ' });
    await expect(startAuth()).rejects.toThrow('ошибку без описания');
  });

  it('сообщает о недоступном мосте, если запрос не дошёл', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Failed to fetch'))));
    await expect(fetchAuthState()).rejects.toThrow(BridgeUnreachableError);
    await expect(fetchAuthState()).rejects.toThrow('START_WINDOWS.cmd');
  });

  it('отличает не-JSON ответ от недоступного моста', async () => {
    stubFetch(null, true);
    await expect(fetchAuthState()).rejects.toThrow('не в формате JSON');
  });

  it('не принимает ответ, не совпадающий с контрактом моста', async () => {
    stubFetch({ ok: true, state: 'что-то новое' });
    await expect(fetchAuthState()).rejects.toThrow('неожиданный ответ');
  });

  it('берёт текст ошибки моста как есть, а неизвестную ошибку описывает сам', () => {
    expect(describeBridgeError(new Error('MAX не подключён'))).toBe('MAX не подключён');
    expect(describeBridgeError('строка вместо ошибки')).toContain('Не удалось связаться');
  });

  it('считает таймаут шлюза при отправке неизвестным статусом, а не ошибкой', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      status: 504,
      json: () => Promise.resolve({ ok: false, error: 'MAX не подтвердил отправку вовремя.' }),
    })));
    const result = await sendProposal('79093228701', 'Текст КП');
    expect(result.uncertain).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.detail).toContain('не подтвердил отправку');
  });

  it('считает оборванную по таймауту отправку неизвестным статусом', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError'))));
    const result = await sendProposal('79093228701', 'Текст КП');
    expect(result.uncertain).toBe(true);
    expect(result.status).toBe('UNKNOWN');
  });

  it('не превращает недоступный мост в неизвестный статус отправки', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(sendProposal('79093228701', 'Текст КП')).rejects.toThrow(BridgeUnreachableError);
  });

  it('отличает таймаут от недоступного моста при проверке номера', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError'))));
    await expect(searchRecipient('79093228701')).rejects.toThrow('не ответил вовремя');
  });

  it('заворачивает SVG с кириллицей в data-URI без потерь', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Код входа</title></svg>';
    const source = qrImageSource(svg);
    expect(source.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(source.slice('data:image/svg+xml;charset=utf-8,'.length))).toBe(svg);
  });
});
