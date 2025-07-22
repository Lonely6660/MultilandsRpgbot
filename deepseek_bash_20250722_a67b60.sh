git clone https://github.com/your-repo.git
cd your-repo
npm install
echo "TOKEN=your_token" > .env
echo "MONGODB_URI=your_uri" >> .env
node bot.js