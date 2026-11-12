# b2b-staging

Copia estática del sitio de Back2Back México ([back2back.mx](https://back2back.mx)) para staging. El HTML ya está limpio: los recursos apuntan a rutas locales, se quitaron los scripts de Google Tag Manager, Google Analytics y Cloudflare, y el sitio no debe indexarse.

Vercel publica la carpeta `public/` (`vercel.json`). Cada respuesta lleva `X-Robots-Tag: noindex, nofollow`, las páginas incluyen `<meta name="robots" content="noindex,nofollow">` y `public/robots.txt` responde `Disallow: /`.

## Vista previa local

```bash
node server.mjs
```

Abre http://localhost:3000. Otro puerto: `node server.mjs 4102`.

## Regenerar

Desde la copia ya limpia (no hace falta instalar dependencias):

```bash
node tools/pull-cleaned.mjs https://back2back-clone-jade.vercel.app . mirror-report.json
```

Desde el sitio origen:

```bash
cd tools && npm install
node mirror.mjs https://back2back.mx .. dir
node fill.mjs https://back2back.mx ..
node finalize.mjs .. b2b-staging dir
```

`finalize.mjs` reescribe `vercel.json`, `package.json` y `server.mjs`, y vuelve a aplicar `noindex`. Las fuentes de Typekit y los videos de YouTube siguen siendo externos.

## Ramas

- `staging` — despliegue de staging.
- `main` — producción, más adelante.
