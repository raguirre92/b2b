# b2b-staging

Copia estática del sitio de Back2Back México ([back2back.mx](https://back2back.mx)). El HTML ya está limpio: los recursos apuntan a rutas locales y se quitaron los scripts de Google Tag Manager, Google Analytics y Cloudflare. El sitio está en `public/` y Node lo publica con `npm start` (`server.mjs`).

Sigue siendo **staging**, así que no debe indexarse:

- `<meta name="robots" content="noindex,nofollow">` en cada HTML
- `public/robots.txt` con `Disallow: /`
- cabecera `X-Robots-Tag: noindex, nofollow` en `server.mjs`

## Ramas

- `staging` — sitio de staging. Es el branch que debe desplegar el hosting (auto-deploy al hacer push).
- `main` — producción más adelante. Hoy tiene el mismo snapshot, incluido el noindex. Antes de usarla en producción hay que quitar esas tres protecciones.

## Arranque

Hace falta Node.js 18 o superior. En SiteGround elige Node.js 22.

```bash
npm install
npm start
```

`npm start` ejecuta `node server.mjs`. El HTML ya está en `public/`. El proceso escucha en `PORT` (por defecto `3000`) en todas las interfaces. Abre http://localhost:3000. Para otro puerto: `PORT=4102 npm start` o `node server.mjs 4102`.

Las rutas con barra final (`/nuestra-mision/` en lugar de `/nuestra-mision/index.html`) las resuelve `server.mjs`. Cada respuesta incluye `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` y `Referrer-Policy`.

En SiteGround (Node.js, despliegue desde GitHub): comando de inicio `npm start`, versión de Node 22.

## Regenerar con tools/

Hace falta Node.js 18 o superior. En `tools/` están `mirror.mjs`, `fill.mjs`, `verify.mjs`, `pull-cleaned.mjs` y `finalize.mjs` (dependencias: `cheerio` y `playwright-core`).

```bash
cd tools
npm install
node mirror.mjs https://back2back.mx .. dir
node fill.mjs https://back2back.mx ..
node finalize.mjs .. b2b-staging dir
```

`finalize.mjs` vuelve a escribir `package.json` y `server.mjs` (con barra final), `public/robots.txt` y el noindex. El nombre del paquete tiene que quedar `b2b-staging`. Las fuentes de Typekit y los videos de YouTube siguen siendo externos.

Si `npm start` registra 404 de archivos que la página pide tarde, guarda ese log y completa la copia:

```bash
bash fill-from-log.sh https://back2back.mx .. server.log
```

`verify.mjs` abre las páginas en Chrome (`/usr/bin/google-chrome`) y anota las peticiones que fallan.

Para volver a bajar una copia que ya está limpia, pasa ese origen a `pull-cleaned.mjs`:

```bash
node tools/pull-cleaned.mjs <origen-ya-limpio> . mirror-report.json
```
