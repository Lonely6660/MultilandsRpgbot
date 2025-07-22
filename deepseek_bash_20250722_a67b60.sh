git clone https://github.com/Lonely6660/test.rpg727672516
cd https://github.com/Lonely6660/test.rpg727672516/
npm install
echo "name: Deploy Bot
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - env:
          DISCORD_TOKEN: ${{ secrets.Token }}
        run: node bot.js" > .env
echo "MONGODB_URI=your_uri" >> .env
node bot.js
