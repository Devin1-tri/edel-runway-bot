module.exports = {
  apps: [
    {
      name: 'edel-vote-bot',
      script: 'src/index.js',
      args: 'start',
      interpreter: 'node',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      // Log settings
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      // Restart policy
      restart_delay: 10000,
      max_restarts: 10,
      min_uptime: '30s',
    },
  ],
};
