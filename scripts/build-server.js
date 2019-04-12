const rollup = require('rollup')

const { dev } = require('minimist')(process.argv.slice(2))

const babel = require('rollup-plugin-babel')
const resolve = require('rollup-plugin-node-resolve')
const external = require('@yelo/rollup-node-external')
const copy = require('rollup-plugin-copy')

const pkg = require('../package.json')

rollup.rollup({
    input: 'server/index.js',
    external: external(),
    plugins: [
        copy({
            targets: {
                'server/package.json': 'dist/server/package.json'
            }
        }),
        babel({
            exclude: 'node_modules/**',
            ...pkg.babelOptions
        }),
        resolve(),
        !dev && require('rollup-plugin-terser').terser()
    ]
}).then(bundle => {
    bundle.write({
        file: 'dist/server/index.js',
        format: 'cjs'
    })
})