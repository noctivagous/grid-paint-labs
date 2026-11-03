import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The switcher (index.html) fetches App.tsx / index.css / library sources as
// TEXT and transpiles them in the browser with Babel. Vite's dev pipeline
// would otherwise compile them on the fly: App.tsx would fail resolving its
// bare `react` import (a runtime CDN dependency here, not an npm one), and
// library sources would come back with root-absolute rewritten specifiers
// (e.g. `/NCTGraphite/...`, pre-bundled `/node_modules/.vite/...`) that the
// in-browser blob-module resolver cannot handle. This plugin serves those
// sources byte-for-byte before Vite's internal middlewares run.
export const rawLabSources = () => ({
  name: 'raw-lab-sources',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const urlPath = (req.url || '').split('?')[0];
      const params = new URLSearchParams((req.url || '').split('?')[1] || '');
      if (!params.has('nct-raw')) return next();
      const isLabFile = urlPath.startsWith('/lab-sources/') &&
        (urlPath.endsWith('.tsx') || urlPath.endsWith('.ts') || urlPath.endsWith('.css'));
      const isLibraryFile = urlPath.startsWith('/NCTGraphite/packages/nctgraphite/src/') &&
        (urlPath.endsWith('.ts') || urlPath.endsWith('.tsx') || urlPath.endsWith('.css'));
      if (!isLabFile && !isLibraryFile) return next();
      const file = path.normalize(path.join(server.config.root, decodeURIComponent(urlPath)));
      if (!file.startsWith(path.normalize(server.config.root + path.sep))) return next();
      fs.readFile(file, (err, data) => {
        if (err) return next();
        res.setHeader('Content-Type', urlPath.endsWith('.css') ? 'text/css' : 'text/plain; charset=utf-8');
        res.end(data);
      });
    });
  },
});

export default {
  plugins: [rawLabSources()],
  resolve: { alias: { '@nct/nctgraphite': fileURLToPath(new URL('./NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url)) } },
  server: { port: 8123, strictPort: true, host: '127.0.0.1' },
};
