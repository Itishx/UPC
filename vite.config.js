import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

// Serves /api/* during `vite dev` the same way Vercel serves it in production.
function devApi(env) {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const name = req.url.split('?')[0].replace('/api/', '');
        let mod;
        try {
          mod = await server.ssrLoadModule(`/api/${name}.js`);
        } catch {
          return next();
        }

        // Vercel's runtime injects env vars; replicate that for local dev.
        Object.assign(process.env, env);

        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        req.body = chunks.length ? Buffer.concat(chunks).toString() : '';

        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
          return res;
        };

        try {
          await mod.default(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [devApi(env)],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
          blog: resolve(__dirname, 'blog.html'),
        },
      },
    },
  };
});
