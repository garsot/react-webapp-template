const path = require('path')
const fs = require('fs')
const glob = require('glob')
const rollup = require('rollup')

const { dev, watch } = require('minimist')(process.argv.slice(2))

const babel = require('rollup-plugin-babel')
const commonjs = require('rollup-plugin-commonjs')
const resolve = require('rollup-plugin-node-resolve')
const replace = require('rollup-plugin-replace')
const copy = require('rollup-plugin-copy')
const postcss = require('rollup-plugin-postcss')

const pkg = require('../package.json')

let externals = Object.keys(pkg.dependencies)

const namedExports = {
    'react': [
        'createContext', 'useContext', 'useRef', 'useState', 'Suspense',
        'useEffect', 'useMemo', 'cloneElement', 'createElement', 'lazy',
        'Component', 'createFactory', 'isValidElement', 'useCallback',
        'useDebugValue', 'memo', 'useImperativeHandle', 'useLayoutEffect',
        'useReducer', 'PureComponent', 'Fragment', 'Children', 'forwardRef'
    ],
    'react-dom': [
        'createPortal', 'findDOMNode', 'render'
    ]
}

/**
 * @param {String} pattern - `glob` pattern relative `src` folder
 */
function getDynamicallyLoadedModules(pattern) {

    if (pattern instanceof Array) {

        let result = {}

        for (let pat of pattern) {
            result = Object.assign({}, result, getDynamicallyLoadedModules(pat))
        }

        return result
    }

    return Object.assign({}, ...glob.sync("src/" + pattern, { root: path.resolve(__dirname, '..') }).map(p => ({ [p.slice(4, -3)]: p })))
}


// Generate configs for dynamically modules from src
const dlConfigs = pkg.rollup && pkg.rollup.dlModuleGlobPattern ?
    Object.entries(getDynamicallyLoadedModules(pkg.rollup.dlModuleGlobPattern)).map(([dlModuleId, dlModuleSrcPath]) => {
        return generateDLConfig(dlModuleId, dlModuleSrcPath)
    }) : []


// Config for src without dynamically modules
const srcConfig = {
    input: 'src/index.js',
    output: {
        entryFileNames: "[name].js",
        dir: 'dist/public',
        format: 'system',
        sourcemap: true,
        exports: 'named'
    },
    watch: {
        chokidar: true,
        include: 'src/**'
    },
    external(id) {
        if (/style-inject/.test(id)) return false
        const isNodeModule = !(id.startsWith('src/') || id.startsWith(path.resolve(__dirname, '../src')) || id.startsWith('./'))
        if (isNodeModule && !~externals.indexOf(id)) externals.push(id)
        return isNodeModule
    },
    plugins: [
        copy({
            targets: {
                'src/assets': 'dist/public/assets',
                [`node_modules/@babel/polyfill/dist/polyfill${!dev ? '.min' : ''}.js`]: "dist/public/polyfill.js",
                [`node_modules/systemjs/dist/system${!dev ? '.min' : ''}.js`]: 'dist/public/system.js',
                [`node_modules/systemjs/dist/extras/named-register${!dev ? '.min' : ''}.js`]: 'dist/public/system.named-register.js'
            }
        }),
        postcss({ modules: true }),
        babel({
            exclude: 'node_modules/**',
            ...pkg.babelOptions
        }),
        resolve(),
        replace({
            'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production')
        }),
        commonjs({ namedExports }),
        !dev && require('rollup-plugin-terser').terser()

    ]
}

// Generate config for dynamically module from src
function generateDLConfig(dlModuleId, dlModuleSrcPath) {

    let locDeps = []

    try {
        const locPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", dlModuleSrcPath, '../package.json')))
        locDeps = Object.keys(locPkg.dependencies)
    } catch{ }

    return {
        input: { [dlModuleId]: dlModuleSrcPath },
        output: {
            entryFileNames: "[name].js",
            dir: 'dist/public',
            format: 'system',
            sourcemap: true,
            exports: 'named'
        },
        watch: {
            chokidar: true,
            include: 'src/**'
        },
        external(id) {
            return !id.startsWith('.') && !id.startsWith(path.resolve(__dirname, "..")) && !~locDeps.indexOf(id)
        },
        plugins: [
            postcss({ modules: true }),
            babel({
                exclude: 'node_modules/**',
                ...pkg.babelOptions
            }),
            resolve(),
            replace({
                'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production')
            }),
            commonjs({ namedExports }),
            !dev && require('rollup-plugin-terser').terser()

        ]
    }
}

// Generate config for vendor modules which will become external modules
function generateVendorConfig(vendor, outExternals) {
    return {
        input: require.resolve(vendor),
        output: {
            name: vendor,
            format: 'system',
            sourcemap: false,
            exports: 'named'
        },
        external(id) {
            if (id === vendor || id.startsWith('./') || id.startsWith(path.resolve(__dirname, '../node_modules'))) return false
            if (!~outExternals.indexOf(id)) outExternals.push(id)
            return true
        },
        plugins: [
            replace({
                'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production')
            }),
            resolve(),
            commonjs({ namedExports }),
            !dev && require('rollup-plugin-terser').terser()
        ]
    }
}

// Buil src, vendors and dynamically modules
async function build() {

    if (watch) {

        const watcher = rollup.watch([srcConfig, ...dlConfigs])
        let bundleVendorsComplete = false

        watcher.on('event', e => {
            if (e.code === 'START') {

                console.log('the watcher is (re)starting')

            } else if (e.code === 'BUNDLE_START') {

                console.log("\x1b[32m", 'building an individual bundle', "\x1b[0m")

            } else if (e.code === 'BUNDLE_END') {

                console.log("\x1b[32m", 'finished building a bundle', "\x1b[0m")

                if (!bundleVendorsComplete) bundleVendors()

                bundleVendorsComplete = true
            } else if (e.code === 'END') {

                console.log('finished building all bundles')

            } else if (e.code === 'ERROR' || e.code === 'FATAL') {

                console.error(e.error.stack)

            }
        })

    } else {
        const bundle = await rollup.rollup(srcConfig)
        await bundle.write(srcConfig.output)
        await bundleVendors()

        await Promise.all(dlConfigs.map(async (dlConfig) => {
            const bundle = await rollup.rollup(dlConfig)
            await bundle.write(dlConfig.output)
        }))
    }
}

// Bundle vendors
async function bundleVendors() {

    let resultCode = ''
    let generated = []

    async function recGen(externals) {

        for (let external of externals) {

            if (~generated.indexOf(external)) continue

            let vendorExt = []
            let vendorConfig = generateVendorConfig(external, vendorExt)
            const bundle = await rollup.rollup(vendorConfig)
            const { output } = await bundle.generate(vendorConfig.output)
            resultCode = resultCode.concat(output[0].code)

            generated.push(external)

            await recGen(vendorExt)
        }
    }

    console.log("\x1b[32m", 'building vendors', "\x1b[0m")
    await recGen(externals)
    fs.writeFileSync(path.resolve(__dirname, '../dist/public/vendors.js'), resultCode)
    console.log("\x1b[32m", 'finished building vendors', "\x1b[0m")
}

// Start build
build()