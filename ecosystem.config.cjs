module.exports = {
  apps: [{
    name:          'trishika',
    script:        'server.js',
    cwd:           '/home/himanshu/projects/trishika-trading',
    interpreter:   'node',
    node_args:     '--experimental-vm-modules',
    instances:     1,
    autorestart:   true,
    watch:         false,
    max_memory_restart: '400M',
    restart_delay: 5000,
    max_restarts:  10,
    env: {
      NODE_ENV:           'production',
      EXECUTION_ENABLED:  'false',
      EXECUTION_MODE:     'paper',
    },
    error_file:  'logs/pm2_error.log',
    out_file:    'logs/pm2_out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
