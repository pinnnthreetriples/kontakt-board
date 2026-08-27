import { z } from 'zod';

/**
 * Единственный сетевой модуль приложения. MAX недоступен из браузера напрямую
 * (двоичный протокол поверх websocket), поэтому все запросы идут в локальный
 * мост из папки `bridge`, который запускается вместе с приложением. Адрес
 * фиксированный: если он изменится, это правка одной строки, а не новая
 * настройка в интерфейсе.
 */
export const BRIDGE_URL = 'http://127.0.0.1:8765';

const TIMEOUT_MS = 20_000;
// Свои ожидания моста: поиск 60 с, отправка 90 с. Браузер должен ждать дольше,
// иначе оборванный запрос выглядит как «мост не запущен», хотя сообщение уже ушло.
const SEARCH_TIMEOUT_MS = 70_000;
const SEND_TIMEOUT_MS = 100_000;

/** Самое частое реальное состояние: мост просто не запущен. */
const BRIDGE_OFFLINE_HINT = 'Мост MAX не отвечает. При первом запуске он несколько минут ставит свои библиотеки, дождитесь строки «Мост слушает» в его окне. Если окна нет, закройте приложение и запустите START_WINDOWS.cmd заново.';

export class BridgeUnreachableError extends Error {
  constructor() { super(BRIDGE_OFFLINE_HINT); }
}

/** Ответ не дождались. Для отправки это значит «возможно, уже доставлено». */
class BridgeTimeoutError extends Error {
  constructor() { super('Мост MAX не ответил вовремя.'); }
}

class BridgeError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message.trim() || 'Мост MAX вернул ошибку без описания.');
    this.status = status;
  }
}

const failureSchema = z.object({ ok: z.literal(false), error: z.string() });
const okSchema = z.object({ ok: z.literal(true) });
const accountSchema = z.object({ name: z.string() });

const authStateSchema = z.object({
  ok: z.literal(true),
  state: z.enum(['idle', 'connecting', 'qr', 'password', 'connected', 'error', 'stopped']),
  qrSvg: z.string().optional(),
  qrLink: z.string().optional(),
  error: z.string().optional(),
  account: accountSchema.optional(),
});

const searchSchema = z.object({
  ok: z.literal(true),
  found: z.boolean(),
  recipient: z.string(),
  status: z.string(),
  detail: z.string(),
});

const sendSchema = z.object({
  ok: z.literal(true),
  status: z.string(),
  recipient: z.string(),
  detail: z.string(),
  delivered: z.boolean(),
  uncertain: z.boolean(),
});

export type MaxAuthSnapshot = z.infer<typeof authStateSchema>;
type MaxSearchResult = z.infer<typeof searchSchema>;
export type MaxSendResult = z.infer<typeof sendSchema>;

async function request<T>(path: string, schema: z.ZodType<T>, body?: Record<string, string>, timeoutMs = TIMEOUT_MS): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BRIDGE_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      // Мост принимает только application/json, это осознанно: заголовок
      // заставляет браузер сделать preflight-запрос и проверить CORS.
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (networkError) {
    // Обрыв по таймауту и «мост не запущен» требуют разных сообщений: в первом
    // случае запрос мог дойти до MAX, во втором его точно никто не получил.
    if (networkError instanceof DOMException && networkError.name === 'TimeoutError') throw new BridgeTimeoutError();
    throw new BridgeUnreachableError();
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BridgeError('Мост MAX ответил не в формате JSON.', response.status);
  }
  const failure = failureSchema.safeParse(payload);
  if (failure.success) throw new BridgeError(failure.data.error, response.status);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new BridgeError('Мост MAX вернул неожиданный ответ. Обновите версию моста.', response.status);
  return parsed.data;
}

export async function fetchAuthState(): Promise<MaxAuthSnapshot> {
  return request('/auth/state', authStateSchema);
}

export async function startAuth(): Promise<void> {
  await request('/auth/start', okSchema, {});
}

export async function cancelAuth(): Promise<void> {
  await request('/auth/cancel', okSchema, {});
}

export async function submitAuthPassword(password: string): Promise<void> {
  await request('/auth/password', okSchema, { password });
}

export async function logoutMax(): Promise<void> {
  await request('/auth/logout', okSchema, {});
}

export async function searchRecipient(phone: string): Promise<MaxSearchResult> {
  return request('/search', searchSchema, { phone }, SEARCH_TIMEOUT_MS);
}

/**
 * Оборванная отправка — не ошибка, а неизвестный статус: сообщение могло уже
 * уйти в MAX. Возвращаем такой же результат, как при `UNKNOWN` от моста, чтобы
 * интерфейс запретил повтор, а не предложил кнопку «отправить снова».
 */
export async function sendProposal(phone: string, text: string): Promise<MaxSendResult> {
  try {
    return await request('/send', sendSchema, { phone, text }, SEND_TIMEOUT_MS);
  } catch (sendError) {
    const timedOut = sendError instanceof BridgeTimeoutError;
    const gatewayTimeout = sendError instanceof BridgeError && sendError.status === 504;
    if (!timedOut && !gatewayTimeout) throw sendError;
    return {
      ok: true,
      status: 'UNKNOWN',
      recipient: '',
      detail: sendError instanceof Error ? sendError.message : '',
      delivered: false,
      uncertain: true,
    };
  }
}

/**
 * Мост отдаёт готовый SVG-документ строкой. Вставить разметку из строки в React
 * нельзя, поэтому она заворачивается в data-URI и рисуется как обычная картинка.
 * `btoa` здесь неприменим: он падает на кириллице внутри SVG.
 */
export function qrImageSource(qrSvg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;
}

/** Сообщение для интерфейса: у ошибок моста текст уже русский и понятный. */
export function describeBridgeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось связаться с мостом MAX. Повторите ещё раз.';
}
