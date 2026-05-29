import { configure } from 'quasar/wrappers';

export default configure(function (/* ctx */) {
  return {
    boot: ['pinia'],

    css: ['app.scss'],

    extras: ['roboto-font', 'material-icons'],

    build: {
      target: {
        browser: ['es2022', 'edge88', 'firefox78', 'chrome87', 'safari14'],
        node: 'node20',
      },
      typescript: {
        strict: true,
        vueShim: true,
      },
    },

    devServer: {
      open: true,
    },

    framework: {
      config: {
        dark: 'auto',
      },
      plugins: ['Notify', 'Dialog', 'Loading'],
    },

    animations: [],

    electron: {
      preloadScripts: ['electron-preload'],
      inspectPort: 5858,
      bundler: 'packager',
      packager: {
        extraResource: ['resources/tools'],
      },
      builder: {
        appId: 'com.mylonics.flashtool',
      },
      extendPackageJson(pkg) {
        Object.assign(pkg.dependencies, {
          serialport: '^13.0.0',
          uuid: '^11.0.5',
        });
      },
      nodeIntegration: false,
      contextIsolation: true,
    },
  };
});
