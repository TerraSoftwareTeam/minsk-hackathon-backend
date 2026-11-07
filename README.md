# Minsk Hackathon Backend

REST API для школьной платформы (ученики и учителя школ Минска). Архитектура - модульный 
монолит на NestJS

## Стек

| Слой             | Технология                                      |
|------------------|-------------------------------------------------|
| Reverse proxy    | nginx (TLS)                                     |
| API              | NestJS 12                                       |
| БД               | PostgreSQL 16 + Prisma 7                        |
| Кэш              | Redis 7 (поднят в compose и зарезервирован)     |
| Документация API | Swagger                                         |
| Инфра            | Docker, docker-compose, GitHub Actions          |

## Путь запроса

```
Клиент
  │  HTTPS :443  (HTTP :80 → 301 на HTTPS)
  ▼
nginx ── TLS-терминация
  │  HTTP → 127.0.0.1:3000
  ▼
API (NestJS, контейнер)
  ├──▶ PostgreSQL :5432  (контейнер, том pgdata)
  └──▶ Redis :6379       (контейнер, том redisdata)
```

- Снаружи открыты только порты nginx — 80 и 443. API, Postgres и Redis наружу не смотрят.
- API, Postgres и Redis работают в одной docker-compose-сети.
- Все эндпоинты лежат под `/api/v1`, Swagger UI — на `/docs`.
- Авторизация: JWT в заголовке `Authorization: Bearer <token>`.

## Сущности

Схема Prisma разбита по файлам в `prisma/schema/`, enum'ы лежат в `prisma/schema/enums/`.

```
User 1 ──< Event         (инициатор)
User 1 ──< EventVote >── 1 Event   (участие)
User 1 ──< EventLike >── 1 Event   (лайк / дизлайк)
User 1 ──< Image         (загрузил)
Image 1 ── 0..1 Event    (картинка мероприятия)
User 1 ──< DeviceToken   (устройства для пушей)
```

| Сущность      | Что это                                                                 | Ключевые поля |
|---------------|-------------------------------------------------------------------------|---------------|
| `User`        | Ученик, учитель или админ. Входит по `schoolsById` (id из школьной системы). | `role` (`PUPIL` / `TEACHER` / `ADMIN`), `class` (у ученика — его класс, у учителя — класс, который он ведёт), `exp` — опыт ученика, не бывает отрицательным |
| `Event`       | Мероприятие, которое предлагает пользователь.                           | `name` (уникальное), `category`, `scope`, `status`, `startsAt`, `voteThreshold`, `maxParticipants`, `createdByRole`, `declineReason` |
| `EventVote`   | Голос ученика за мероприятие. Проголосовавший — участник. Один голос на ученика (PK `eventId + voterId`). | `eventId`, `voterId` |
| `EventLike`   | Лайк (`value = 1`) или дизлайк (`value = -1`) ученика. Одна реакция на ученика, её можно сменить или снять (PK `eventId + userId`). `likesCount` = сумма `value`. | `eventId`, `userId`, `value` |
| `Image`       | Картинка в Cloudinary: файл хранится там, в БД — URL и метаданные. У мероприятия не больше одной картинки; если удалить картинку, у мероприятия поле очищается. | `url`, `cloudinaryPublicId`, `mimeType`, `sizeBytes`, `uploadedById` |
| `DeviceToken` | FCM-токен одной установки приложения. Токен уникален и принадлежит тому, кто последним вошёл на этом устройстве. | `token`, `platform` (`ANDROID` / `IOS` / `WEB`), `deviceId` |

При удалении пользователя или мероприятия голоса, лайки и токены удаляются каскадом.

### Мероприятие

**Охват (`scope`)** — кто видит мероприятие и может за него голосовать:
- `CLASS` — класс инициатора;
- `GRADE` — параллель (все классы с той же цифрой);
- `SCHOOL` — вся школа. Мероприятие админа всегда `SCHOOL`.

**Категории (`category`):** `SPORTS`, `INTELLECTUAL`, `CULTURAL`, `CREATIVE`, `EDUCATIONAL`,
`VOLUNTEER`, `ENVIRONMENTAL`, `TOURISM`, `ENTERTAINMENT`, `OTHER`.

**Жизненный цикл (`status`)** зависит от роли автора (`createdByRole`):

```
PUPIL:   ON_MODERATION ──▶ ON_VOTE ──▶ ON_ADMIN_MODERATION ──▶ FINALIZED
              │                                 │
              ▼                                 ▼
          DECLINED                       DECLINED_BY_ADMIN

TEACHER: ON_VOTE ──▶ ON_ADMIN_MODERATION ──▶ FINALIZED      (без модерации учителем)
ADMIN:   ON_VOTE ──▶ FINALIZED                              (без модерации)

Любой этап, не завершённый к своему дедлайну ──▶ EXPIRED
```

- Модераторы нигде не хранятся, их определяет статус. На `ON_MODERATION` решают все учителя класса
  инициатора, на `ON_ADMIN_MODERATION` — все админы.
- `startsAt` автор выбирает при создании, потом дата не меняется. От неё считаются дедлайны:
  модерация учителем и голосование заканчиваются за 3 дня до `startsAt`, модерация администрацией —
  в момент начала мероприятия. Если этап не решён к дедлайну, статус становится `EXPIRED`.
- Голосование закрывается, когда набрано `maxParticipants` участников (тогда сразу) или когда наступает
  дедлайн. Если к этому моменту набралось `voteThreshold` голосов, мероприятие идёт дальше, иначе — `EXPIRED`.
  `maxParticipants` можно не задавать (`null` — без ограничения), иначе он ≥ `voteThreshold`.
- Ученик-организатор участвует в своём мероприятии с момента создания.

## Возможности

> **TODO:** заполнить — что умеет бэкенд (функциональность с точки зрения клиента).

## Конфигурация

`.env` в корне проекта, шаблон — `.env.example`. В нём задаются порт API, доступ к Postgres, секрет JWT и Redis.

### Push-уведомления (Firebase Cloud Messaging)

- `FIREBASE_SERVICE_ACCOUNT_PATH` — путь к JSON-ключу сервисного аккаунта Firebase. Ключ не коммитится
  и не попадает в образ: docker-compose монтирует его в контейнер read-only. Без переменной пуши выключены.
- Мобилка регистрирует токен: `POST /api/v1/device-token` `{ token, platform?, deviceId? }` — при логине и
  старте приложения; `DELETE /api/v1/device-token` `{ token }` — при выходе. У пользователя может быть
  несколько устройств.
- Кому приходят пуши (`data`: `type`, `eventId`, `status`):
  - учителю — новое мероприятие на модерацию (`EVENT_TEACHER_MODERATION`);
  - всем админам — мероприятие набрало голоса (`EVENT_ADMIN_MODERATION`);
  - учителю-автору — его мероприятие набрало голоса и ушло администрации (`EVENT_SENT_TO_ADMIN`,
    `status`: `ON_ADMIN_MODERATION`); решение администрации он получает как `EVENT_DECISION`;
  - всем админам — мероприятие админа набрало голоса и стало `FINALIZED` (`EVENT_FINALIZED_BY_VOTES`);
  - автору — решение по его мероприятию (`EVENT_DECISION`, `status`: `ON_VOTE` / `DECLINED` — учитель,
    `FINALIZED` / `DECLINED_BY_ADMIN` — администрация; причина отказа в тексте, обрезана до 200 символов);
  - участникам (проголосовавшим ученикам, кроме автора) — мероприятие стало `FINALIZED`, с датой
    (`EVENT_FINALIZED`).
  - автору — его заявку удалил учитель класса или админ (`EVENT_DELETED`, без `status`).
- Опыт (`exp`): когда мероприятие становится `FINALIZED`, автор-ученик получает +25 exp, каждый участник
  +5 exp. Учителям и админам опыт не начисляется. В пуше об этом есть подпись («+25 exp за организацию»,
  «+5 exp за участие»), а в `data` есть поле `exp` (у `EVENT_DECISION` только при `FINALIZED`).
- Мёртвые токены (`UNREGISTERED`, `INVALID_ARGUMENT`) удаляются автоматически после отправки.

## Запуск

```bash
# локально
npm ci
docker compose up -d db redis
npx prisma generate && npx prisma migrate dev
npm run start:dev

# всё в Docker
docker compose up -d --build
```

## CI/CD

Push в `main` → GitHub Actions:

1. **test** — сборка и unit-тесты.
2. **deploy** — self-hosted раннер на сервере: `git pull` → `docker compose up -d --build`.

При старте контейнер API сам применяет миграции. Healthcheck — `GET /api/v1/health`.

Подробнее — [docs/ci-cd.md](docs/ci-cd.md).
