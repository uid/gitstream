const esbuild = require('esbuild');
const handlebarsPlugin = require('esbuild-plugin-handlebars');

esbuild.build({
  entryPoints: ['src/client/js/main.js'],
  plugins: [handlebarsPlugin()],
  outdir: 'dist/client',
  bundle: true,
  platform: 'node',
  format: 'cjs'
})