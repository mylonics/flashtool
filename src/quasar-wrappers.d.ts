/* Quasar wrappers module declaration */
declare module 'quasar/wrappers' {
  import type { App } from 'vue';
  import type { Router } from 'vue-router';
  import type { Store } from 'pinia';

  type BootCallback = (options: {
    app: App;
    router: Router;
    store: Store;
  }) => void | Promise<void>;

  export function boot(cb: BootCallback): BootCallback;

  type RouteCallback = (options: {
    store: Store;
    ssrContext?: unknown;
  }) => Router;

  export function route(cb: RouteCallback): RouteCallback;
}
