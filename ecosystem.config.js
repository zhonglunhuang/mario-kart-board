// PM2 設定（若你偏好 pm2 而非 systemd）：pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'mario-kart',
      script: 'server/index.js',
      instances: 1, // Socket.IO 房間狀態在記憶體中，請保持單一實例
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        BASE_PATH: '/mario',
        TURN_SECONDS: 45,
      },
    },
  ],
};
