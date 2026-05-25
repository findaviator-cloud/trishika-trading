module.exports = {
  apps: [{
    name: 'trishika',
    script: 'server.js',
    instances: 1,
    env: {
      NODE_ENV: 'production',
      EXECUTION_ENABLED: 'true',
      EXECUTION_MODE: 'paper',
      ALERT_WEBHOOK_URL: '',
    }
  }]
};
