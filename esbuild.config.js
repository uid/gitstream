import esbuild from "esbuild";
import handlebarsPlugin from "esbuild-plugin-handlebars";

esbuild
  .build({
    entryPoints: ["./src/client/js/main.cjs"],
    outfile: "dist/src/client/main.js",
    bundle: true,
    plugins: [handlebarsPlugin()],
    // minify: true,
    format: 'cjs'
  })
  .then((result) => console.log(result))
  .catch(() => process.exit(1));