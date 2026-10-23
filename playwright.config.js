import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:8080',browserName:'chromium',trace:'retain-on-failure'},
  webServer:{command:'node tools/serve.mjs',url:'http://127.0.0.1:8080',reuseExistingServer:false}
});
