import { join } from 'path';
import fs from 'fs/promises';
import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = pkg;
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import youtubedl from 'youtube-dl-exec';
import { createWriteStream } from 'fs';
import express from 'express';

// Create Express app for health check
const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running!');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

const downloadsDir = './downloads';
const pendingDownloads = new Map();

async function getVideoQualities(url) {
    try {
        // Get video info using youtube-dl with additional options
        const info = await youtubedl(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            cookies: 'cookies.txt', // Will store cookies if needed
            extractAudio: false,
            noCheckCertificates: true,
            noPlaylist: true,
            youtubeSkipDashManifest: true,
            geoBypass: true,
            // Add options to bypass age restriction
            ageLimitBypass: true,
            cookies: 'cookies.txt'
        });

        if (!info || !info.formats) {
            throw new Error('Could not get video information');
        }

        // Filter formats with both video and audio
        const formats = info.formats.filter(format => 
            format.vcodec !== 'none' && 
            format.acodec !== 'none' &&
            format.height &&
            // Ensure format is downloadable
            !format.format_note?.includes('DRM')
        );

        // Sort by height (quality)
        formats.sort((a, b) => (b.height || 0) - (a.height || 0));

        // Get SD and HD formats
        const sd = formats.find(f => f.height <= 360) || formats[formats.length - 1];
        const hd = formats.find(f => f.height <= 720) || formats[0];

        if (!formats.length) {
            throw new Error('No suitable formats found for this video');
        }

        return {
            title: info.title,
            formats: [sd, hd].filter(f => f),
            duration: info.duration
        };
    } catch (error) {
        console.error('Error getting video info:', error);
        if (error.message.includes('Private video')) {
            throw new Error('This video is private');
        } else if (error.message.includes('Sign in') || error.message.includes('age')) {
            throw new Error('Sorry, this video is not available due to age restrictions.');
        } else {
            throw new Error('Could not get video info. Please try another video.');
        }
    }
}

async function downloadYouTubeVideo(url, outputPath, format) {
    try {
        await youtubedl(url, {
            output: outputPath,
            format: format,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            cookies: 'cookies.txt',
            extractAudio: false,
            noCheckCertificates: true,
            noPlaylist: true,
            youtubeSkipDashManifest: true,
            geoBypass: true,
            ageLimitBypass: true
        });
        return true;
    } catch (error) {
        console.error('Error downloading video:', error);
        throw error;
    }
}

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        const sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            browser: ['WhatsApp YouTube Bot', 'Chrome', '1.0.0']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', function(update) {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect && 
                    lastDisconnect.error && 
                    lastDisconnect.error.output && 
                    lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed due to:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
                
                if (shouldReconnect) {
                    connectToWhatsApp();
                }
            } else if (connection === 'open') {
                console.log('WhatsApp bot is now connected!');
            }
        });

        sock.ev.on('messages.upsert', async function({ messages, type }) {
            const m = messages[0];
            if (!m.message) return;

            let messageText = '';
            if (m.message.conversation) {
                messageText = m.message.conversation;
            } else if (m.message.extendedTextMessage) {
                messageText = m.message.extendedTextMessage.text;
            } else {
                return;
            }

            const sender = m.key.remoteJid;
            if (!sender) return;

            // Help command
            if (messageText.toLowerCase() === '.help') {
                const helpMessage = `🤖 *YouTube Downloader Bot*\n\n` +
                    `Just send any YouTube video link!\n\n` +
                    `After sending the link, reply with:\n` +
                    `*1* - SD Quality (360p)\n` +
                    `*2* - HD Quality (720p)`;
                
                await sock.sendMessage(sender, { text: helpMessage });
                return;
            }

            // Check for YouTube URL
            const youtubeMatch = messageText.match(/(?:https?:\/\/)?(?:(?:www|m)\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);

            if (youtubeMatch) {
                try {
                    await sock.sendMessage(sender, { text: '📥 Checking video availability...' });

                    const videoUrl = `https://www.youtube.com/watch?v=${youtubeMatch[1]}`;
                    const { title, formats, duration } = await getVideoQualities(videoUrl);

                    if (duration > 600) {
                        await sock.sendMessage(sender, { 
                            text: '❌ Video is too long. Please choose a video under 10 minutes.' 
                        });
                        return;
                    }

                    if (!formats || formats.length === 0) {
                        throw new Error('No suitable video formats found');
                    }

                    let message = `🎥 *${title}*\n\nChoose video quality:\n\n`;
                    formats.forEach((format, index) => {
                        const size = format.filesize ? 
                            `(${(format.filesize / (1024 * 1024)).toFixed(2)}MB)` : 
                            '(size unknown)';
                        message += `*${index + 1}* - ${format.height}p ${size}\n`;
                    });
                    
                    message += '\nReply with the number of your choice.';

                    pendingDownloads.set(sender, {
                        url: videoUrl,
                        title: title,
                        formats: formats
                    });
                    
                    await sock.sendMessage(sender, { text: message });

                } catch (error) {
                    console.error('Error processing video:', error);
                    await sock.sendMessage(sender, { 
                        text: `❌ ${error.message}` 
                    });
                }
                return;
            }

            if (pendingDownloads.has(sender) && (messageText === '1' || messageText === '2')) {
                const videoInfo = pendingDownloads.get(sender);
                if (!videoInfo) return;

                try {
                    const selectedFormat = videoInfo.formats[parseInt(messageText) - 1];
                    if (!selectedFormat) {
                        throw new Error('Invalid quality selection');
                    }

                    const timestamp = Date.now();
                    const outputPath = join(downloadsDir, `video_${timestamp}.mp4`);

                    await fs.mkdir(downloadsDir, { recursive: true });

                    await sock.sendMessage(sender, { 
                        text: `📥 Downloading video in ${selectedFormat.height}p...` 
                    });

                    await downloadYouTubeVideo(videoInfo.url, outputPath, selectedFormat.format_id);

                    console.log('Reading video file...');
                    const videoBuffer = await fs.readFile(outputPath);
                    console.log('Sending video...');

                    await sock.sendMessage(sender, { 
                        video: videoBuffer,
                        caption: `${videoInfo.title}\n${selectedFormat.height}p`
                    });

                    // Clean up
                    await fs.unlink(outputPath);
                    pendingDownloads.delete(sender);

                } catch (error) {
                    console.error('Error downloading video:', error);
                    await sock.sendMessage(sender, { 
                        text: '❌ Failed to download video. Please try again or choose another video.' 
                    });
                    pendingDownloads.delete(sender);
                }
            }
        });

    } catch (error) {
        console.error('Error in WhatsApp connection:', error);
    }
}

// Create downloads directory
await fs.mkdir(downloadsDir, { recursive: true }).catch(console.error);

// Start the bot
console.log('Starting WhatsApp bot...');
connectToWhatsApp();
