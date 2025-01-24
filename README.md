# WhatsApp YouTube Video Bot

A WhatsApp bot that downloads YouTube videos in your preferred quality.

## Features

- Downloads YouTube videos in SD (360p) or HD (720p) quality
- Simple to use - just send a YouTube link
- Fast download and delivery
- Automatic cleanup of downloaded files

## How to Use

1. Send any YouTube video link to the bot
2. Choose quality by replying with:
   - `1` for SD quality (360p)
   - `2` for HD quality (720p)
3. Wait for the bot to send your video!

## Deploy to Replit

1. Create a new Repl on [Replit](https://replit.com)
2. Choose "Import from GitHub"
3. Paste your repository URL
4. Click "Import"

After importing:
1. Replit will automatically install dependencies
2. Click "Run" to start the bot
3. Scan the QR code with WhatsApp to connect
4. Your bot is ready to use!

## Environment Setup

The bot is configured to run on Replit with:
- Node.js 18.x
- FFmpeg for video processing
- All necessary npm packages

## Keep Bot Running

To keep your bot running 24/7 on Replit:
1. Get a Replit subscription or
2. Use an external service like UptimeRobot to ping your Repl URL

## Commands

- `.help` - Show usage instructions
- Just send any YouTube link to download

## Supported YouTube URLs

- `https://youtube.com/watch?v=xxxxx`
- `https://youtu.be/xxxxx`
- Any other valid YouTube video URL
