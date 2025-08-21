 module.exports = {
  apps: [
    {
      name: "multilands-bot",
      script: "./bot.js",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
