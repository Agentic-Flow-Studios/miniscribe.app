import esbuild from 'esbuild';
import fs from 'node:fs/promises';

const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));

const svgReactPlugin = {
  name: 'svg-react',
  setup(build) {
    build.onLoad({ filter: /\.svg$/ }, async (args) => {
      const svgStr = await fs.readFile(args.path, 'utf8');

      let jsx = svgStr
        .replace(/xmlns:xlink=/g, 'xmlnsXlink=')
        .replace(/xml:space=/g, 'xmlSpace=')
        .replace(/enable-background=/g, 'enableBackground=')
        .replace(/stroke-width=/g, 'strokeWidth=')
        .replace(/stroke-linecap=/g, 'strokeLinecap=')
        .replace(/stroke-linejoin=/g, 'strokeLinejoin=')
        .replace(/fill-opacity=/g, 'fillOpacity=')
        .replace(/stroke-opacity=/g, 'strokeOpacity=');

      jsx = jsx.replace(/<svg\b([^>]*)>/, (match, attrs) => {
        return `<svg ${attrs} {...props}>`;
      });

      const contents = `import React from 'react';
export default function SvgComponent(props) {
  return (
    ${jsx}
  );
}
`;
      return {
        contents,
        loader: 'jsx',
      };
    });
  },
};

esbuild
  .build({
    entryPoints: ['src/renderer/main.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.woff2': 'dataurl' },
    define: {
      'process.env.APP_VERSION': JSON.stringify(`v${pkg.version}`),
    },
    plugins: [svgReactPlugin],
    outfile: 'dist/renderer.js',
  })
  .catch(() => process.exit(1));
