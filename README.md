# @tungo/sdk — Официальный TypeScript / Node.js SDK для Tungo AI

Официальный SDK для интеграции с платформой ИИ-бухгалтера **Tungo AI** (`Tungo Platform API`):
- **Для быстрого старта (новичкам):** методы в одну строку `tungo.ask()`, `tungo.streamChat()`, `tungo.sendHook()`, `tungo.runScenarioAndWait()`, `tungo.verifyWebhook()`, авто-пагинаторы `listAll()` и утилиты `TungoMoney`.
- **Для продакшена (профи):** 100% покрытие всех ресурсов и методов контракта `platform`, строгая типизация всех схем и 22 видов вебхуков, автоматический `Idempotency-Key`, экспоненциальный backoff с учётом `Retry-After`, иерархия классов ошибок.

## Установка

```bash
npm install @tungo/sdk
```

## Быстрый старт

```ts
import { TungoClient, TungoMoney } from '@tungo/sdk';

const tungo = new TungoClient({
  apiKey: process.env.TUNGO_API_KEY, // tg_…
});

// 1. Задать вопрос ИИ-бухгалтеру в 1 строку
const reply = await tungo.ask('co_01h455vb4pex5vsknk084sn02q', 'Какой НДС у последней реализации?');
console.log(reply.answer);
console.log('Стоимость хода:', TungoMoney.formatTiyn(reply.usage?.cost_tiyn ?? 0));

// 2. Потоковый чат (SSE)
for await (const event of tungo.streamChat('co_01h455vb4pex5vsknk084sn02q', 'Проверь выписку за ноябрь')) {
  if (event.event === 'text') console.log(event.data);
}

// 3. Авто-пагинация по всем предложениям для 1С
for await (const proposal of tungo.proposals.listAll('co_01h455vb4pex5vsknk084sn02q', { status: 'awaiting_approval' })) {
  console.log(proposal.id, proposal.summary);
}

// 4. Отправка события во входящий хук автоматизации с HMAC-SHA256 подписью
await tungo.sendHook('th_...', { id: 'order_1532', amount_tiyn: TungoMoney.toTiyn(45_000) }, { secret: 'hksec_...' });
```

## Все ресурсы и методы SDK

<!-- sdkgen:methods -->
Автоматически сгенерировано из OpenAPI-контракта Tungo Platform API: **13 ресурсов, 82 метода, 22 вебхука**.

| Ресурс | Описание | Методы |
| --- | --- | --- |
| `workspaces` | Организации (workspace), доступные ключу API | `list` |
| `companies` | Компании организации и их карточки | `list` · `get` |
| `platform` | Баланс платформы, книга движений, отчёты о расходе, лимиты, аудит и тарифы моделей | `listUsageRates` · `getAccount` · `getAudit` · `getLedger` · `listLimits` · `listRequests` · `getUsage` |
| `apiKeys` | Сведения о текущем ключе API и статистика его расхода | `getCurrent` · `getCurrentUsage` · `getUsage` |
| `webhooks` | Исходящие вебхуки организации (Svix): адреса, каталог событий, доставки и проверка подписи | `listEndpoints` · `createEndpoint` · `getEndpoint` · `updateEndpoint` · `deleteEndpoint` · `listEndpointAttempts` · `rotateEndpointSecret` · `testEndpoint` · `listEventTypes` · `listMessages` · `listMessageAttempts` · `resendMessage` · `getUsage` |
| `chat` | Диалоги с ИИ-бухгалтером: вопросы, потоковый чат (SSE), подсчёт токенов и история | `list` · `create` · `countTokens` · `get` · `update` · `delete` · `answer` · `listEvents` · `stop` |
| `proposals` | Предложения документов ИИ-бухгалтера: просмотр, одобрение записи в 1С и отклонение | `list` · `approveBatch` · `get` · `approve` · `reject` |
| `feed` | Лента событий и предложений компании (страницы и живой поток SSE) | `get` · `listEvents` |
| `batches` | Пачки обработки банковских выписок, входящих ЭСФ и DirectBank | `list` · `createBankStatement` · `createEsfPurchases` · `get` · `listEvents` · `stop` · `getSummary` · `listStatements` · `pollDirectbank` |
| `esf` | Входящие и исходящие электронные счета-фактуры (ИС ЭСФ) | `getIncoming` · `getOutgoing` |
| `forms` | Налоговые формы (ФНО 100.00 и др.): сборка, проверка ИСНА и разрывы данных | `list` · `build` · `listDataGaps` · `getIsna` · `listNotes` |
| `onec` | Состояние подключения компании к базе 1С | `getStatus` |
| `automations` | Автоматизации компании: входящие хуки, сценарии, цепочки шагов, запуски и уровень автономности ИИ | `postHook` · `listHooks` · `createHook` · `getHook` · `updateHook` · `deleteHook` · `rotateHook` · `testHook` · `listRuns` · `getRun` · `cancelRun` · `retryRun` · `listScenarios` · `createScenario` · `getScenario` · `putScenario` · `updateScenario` · `deleteScenario` · `runScenario` · `getState` · `putState` · `getAutonomy` · `putAutonomy` |
<!-- /sdkgen:methods -->
