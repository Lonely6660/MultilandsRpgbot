${{ secrets.Token }}
        run: node bot.js" > .env
echo "MONGODB_URI=your_mongodb_uri_here" >> .env
