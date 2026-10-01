import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests',testMatch:'**/*.spec.js',fullyParallel:true,workers:2,
  use:{baseURL:'http://127.0.0.1:4173/health-log/',timezoneId:'Asia/Tokyo',locale:'ja-JP',trace:'retain-on-failure',...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})},
  projects:[
    {name:'desktop',use:{viewport:{width:1280,height:900}}},
    {name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}
  ],
  webServer:{command:'npm start',url:'http://127.0.0.1:4173/health-log/',reuseExistingServer:!process.env.CI},
  reporter:'list'
});
