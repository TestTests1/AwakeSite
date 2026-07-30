# Развёртывание на Railway

## Из чего состоит

| сервис | что это |
|---|---|
| API | собирается из `Dockerfile` в корне репозитория |
| PostgreSQL | из каталога Railway: **+ New** → **Database** → **PostgreSQL** |
| FlareSolverr | нужен только сбору данных об игроках, образ `ghcr.io/flaresolverr/flaresolverr` |

Фронтенд — статика, собирается отдельно и живёт либо рядом, либо на Cloudflare
Pages.

## Порт

В настройках публичной сети указать **8080**.

Порт задан в `Dockerfile` через `ASPNETCORE_URLS=http://+:8080` и переменную
`PORT` приложение не читает. Переменная окружения перекрывает значение из образа,
так что при желании порт можно переопределить снаружи — но `PORT` Railway
автоматически не выдаёт, и ссылаться на неё вслепую нельзя.

## Переменные сервиса API

```
ConnectionStrings__Postgres=${{Postgres.DATABASE_URL}}
Jwt__Secret=<не тот, что на стенде>
Discord__BotToken=
Discord__ApplicationId=
Discord__PublicKey=
Discord__ClientSecret=
Discord__OAuthRedirectUri=https://api.stalcraftclans.cc/api/auth/discord/callback
Cors__AllowedOrigin=https://stalcraftclans.cc
MapAssets__BaseUrl=https://models.stalcraftclans.cc/maps/v1
PlayerData__FlareSolverrUrl=http://${{FlareSolverr.RAILWAY_PRIVATE_DOMAIN}}:8191
```

Двойное подчёркивание — это запись вложенного ключа конфигурации в переменной
окружения: `ConnectionStrings__Postgres` и `ConnectionStrings:Postgres` — одно и
то же.

`Postgres` в ссылках — **имя сервиса базы в вашем проекте**. Если Railway назвал
его иначе, ссылка не разрешится и строка приедет пустой.

### Формат строки подключения

Приложение принимает оба вида:

- ссылку `postgresql://пользователь:пароль@хост:порт/база`, как её отдают
  `DATABASE_URL` и `DATABASE_PUBLIC_URL`;
- обычную запись из пар «ключ=значение», как на стенде и в docker-compose.

Сам Npgsql ссылки не понимает, разбор делает `PostgresConnectionString.Normalize`.
Пароль раскодируется по правилам URL, `sslmode` из запроса переносится, а при
`require` включается доверие сертификату — у хостингов он самоподписанный.

Поэтому достаточно сослаться на одну переменную. Собирать строку из четырёх
(`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) больше не нужно, хотя и можно.

**Берите `DATABASE_URL`, а не `DATABASE_PUBLIC_URL`.** Публичный идёт через
внешний TCP-прокси, и этот трафик тарифицируется как исходящий, плюс задержка
выше. База и API в одном проекте, ходить наружу им незачем.

## Миграции

Применяются сами при старте, в `Program.cs` вызывается `MigrateAsync`. Отдельного
шага нет. Обратная сторона: при неверной строке подключения приложение падает на
старте, а не работает вполсилы.

## Свой домен

В Railway: сервис → **Settings** → **Public Networking** → **+ Custom Domain**.
Railway выдаст **две** записи, и обе обязательны.

В Cloudflare (**DNS** → **Records** → **Add record**):

1. **CNAME**: имя `api`, цель вида `g05ns7.up.railway.app`, **проксирование
   включено** (оранжевое облако).
2. **TXT**: имя и значение скопировать из Railway как есть.

Без TXT домен не подтвердится и будет отдавать **404, хотя CNAME уже
разрешается** — выглядит как непрошедший DNS, а на деле не хватает второй записи.

Дальше **SSL/TLS** → **Overview** → режим **Full**. Не `Full (Strict)` — со
строгим Railway не работает. В **Edge Certificates** должен быть включён
Universal SSL.

Оранжевое облако именно включено: без проксирования Cloudflare не свяжет домен с
проектом, и получится `ERR_TOO_MANY_REDIRECTS`. Без Advanced Certificate Manager
работают только поддомены первого уровня.

Корень домена можно направить туда же: Cloudflare умеет CNAME-flattening.

## Discord

Адрес возврата меняется **в двух местах**: переменная `Discord__OAuthRedirectUri`
и настройки приложения на портале разработчика Discord. Не совпадут — вход
отвалится с ошибкой `redirect_uri`.

## Фронтенд

Собирается с `VITE_API_URL=https://api.stalcraftclans.cc`. Это переменная
**времени сборки**: на неё завязаны и обычные запросы, и оба хаба — уведомления и
мир. Поменять после сборки нельзя, надо пересобирать.

## Если не поднимается

| симптом | причина |
|---|---|
| `ConnectionString property has not been initialized`, `server ''` | переменная не задана, задана на другом сервисе, не совпало имя сервиса базы в ссылке или не было передеплоя |
| домен отдаёт 404, хотя DNS разрешается | нет TXT-записи |
| `ERR_TOO_MANY_REDIRECTS` | выключено проксирование в Cloudflare |
| сертификат не выпускается | ждать; распространение DNS занимает до 72 часов |
| вкладка «Мир» отдаёт 404 | не задан `MapAssets__BaseUrl`; модели в образ не входят |
| вход через Discord: ошибка `redirect_uri` | адрес возврата не совпадает с тем, что на портале Discord |

Переменные подхватываются только новым развёртыванием — после правки нажмите
**Redeploy**.
