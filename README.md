# dotrino-telegram-claude-bot

> Parte del ecosistema [Dotrino](https://dotrino.com).

Un bot de **Telegram que conversa con [Claude](https://claude.com/claude-code)** (con
**memoria** de sesión), corriendo en **tu** máquina y expuesto al mundo con
[`@dotrino/tunnel`](https://www.npmjs.com/package/@dotrino/tunnel) — **sin abrir puertos
ni configurar el router**. Solo responde al **usuario autorizado**.

Cada mensaje de Telegram dispara `claude -p` en la carpeta que elijas, con la conversación
encadenada (memoria). Útil como asistente personal de Claude desde el teléfono.

## Uso rápido (npx)

```sh
# 1) crea un bot con @BotFather y copia el token
# 2) prepará un .env (ver .env.example) y apuntá el bot a ese archivo:
npx dotrino-telegram-claude-bot ./mi-bot.env

# alternativas equivalentes:
npx dotrino-telegram-claude-bot --env /ruta/mi-bot.env
BOT_ENV=/ruta/mi-bot.env  npx dotrino-telegram-claude-bot
TELEGRAM_BOT_TOKEN=123:ABC  npx dotrino-telegram-claude-bot   # sin archivo, todo por env
```

Imprime tu **URL pública** y registra el webhook solo. Con un `.env` por bot levantás
**varios** (cada uno su token, su túnel y su carpeta) apuntando a archivos distintos. Mandale `/id` al bot para ver tu
id; el **primer** usuario que escriba queda como autorizado (o fijalo con `ALLOWED_USER_ID`).

## Configuración

Por **variables de entorno** o por un archivo **`.env`** (en el cwd, o el que indique
`BOT_ENV`). Copiá [`.env.example`](./.env.example) → `.env`. Lo mínimo es el token:

| Variable | Default | Qué es |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — (**req**) | token de @BotFather |
| `CLAUDE_CWD` | el cwd actual | carpeta donde corre Claude (con memoria) |
| `CLAUDE_FLAGS` | *(vacío)* | flags extra para `claude -p` (ver abajo) |
| `ALLOWED_USER_ID` | captura al 1ro | id de Telegram autorizado |
| `CLAUDE_BIN` | `claude` | binario de claude |
| `TUNNEL_SERVER` | `https://r.dotrino.com` | relay del túnel |
| `TUNNEL_KEY` / `TG_WEBHOOK_SECRET` / `CLAUDE_SESSION_ID` | autogenerados | URL estable / validación / memoria |

### `CLAUDE_FLAGS` — permisos y modelo
- **Vacío (default, seguro):** Claude responde y lee, pero **no ejecuta comandos ni edita** sin permiso.
- **Autonomía total (riesgoso):** `CLAUDE_FLAGS=--dangerously-skip-permissions` → el usuario
  autorizado puede hacer que Claude **ejecute cualquier cosa** en la máquina. ⚠️ El túnel es
  público; quien controle tu Telegram controla la máquina. Úsalo solo si entendés el riesgo.
- **Modelo / razonamiento:** `--model claude-sonnet-4-6 --effort medium` (combinables).

## Cómo funciona

```
Telegram ──HTTPS──▶ r.dotrino.com/<key>/tg ──▶ [túnel] ──▶ este bot ──▶ claude -p (CLAUDE_CWD)
                    valida X-Telegram-Bot-Api-Secret-Token       memoria con --resume
```

- **Seguridad:** valida el header `X-Telegram-Bot-Api-Secret-Token` (lo seteás con `secret_token`
  en `setWebhook`, que el bot hace solo) → solo Telegram puede invocar tu webhook.
- **Memoria:** guarda el `session_id` y usa `--resume` en cada mensaje; sobrevive reinicios.
- **Cola:** si llega un mensaje mientras procesa otro, lo **encola** (no lo descarta).

## Correr siempre (PM2)

```sh
pm2 start "$(npm root -g)/dotrino-telegram-claude-bot/bot.js" --name mi-bot --cwd /mi/proyecto
pm2 save && pm2 startup    # (corré el comando sudo que imprime)
```
Para **varios bots** (cada uno su token, su túnel y su carpeta), usá un `.env` por bot y un
`ecosystem.config.cjs` de PM2 con `BOT_ENV` distinto por app.

MIT · parte de Dotrino.
