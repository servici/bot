import { join } from 'path';
import fs from 'fs/promises';
import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = pkg;
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { default as ytdl } from '@distube/ytdl-core';
import { createWriteStream } from 'fs';
import ffmpeg from 'ffmpeg-static';
import { spawn } from 'child_process';

const downloadsDir = './downloads';
const pendingDownloads = new Map();

async function downloadYouTubeVideo(url, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const video = ytdl(url, {
                quality: '18', // 360p
                filter: 'audioandvideo',
            });

            const writeStream = createWriteStream(outputPath);
            let starttime = Date.now();
            let downloaded = 0;
            let totalSize = 0;

            video.on('info', (info, format) => {
                console.log(`Video title: ${info.videoDetails.title}`);
                console.log(`Duration: ${info.videoDetails.lengthSeconds} seconds`);
                totalSize = format.contentLength;
                console.log(`Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
            });

            video.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalSize) {
                    const percent = (downloaded / totalSize) * 100;
                    const downloadedMB = (downloaded / 1024 / 1024).toFixed(2);
                    const totalMB = (totalSize / 1024 / 1024).toFixed(2);
                    console.log(`Downloaded: ${percent.toFixed(2)}% (${downloadedMB}MB of ${totalMB}MB)`);
                }
            });

            video.pipe(writeStream);

            writeStream.on('finish', () => {
                console.log('Successfully downloaded video');
                resolve();
            });

            writeStream.on('error', (err) => {
                console.error('Error writing to file:', err);
                reject(err);
            });

            video.on('error', (err) => {
                console.error('Error downloading video:', err);
                reject(err);
            });
        } catch (error) {
            console.error('Error in downloadYouTubeVideo:', error);
            reject(error);
        }
    });
}

async function getVideoQualities(url) {
    try {
        const info = await ytdl.getInfo(url);
        const formats = info.formats.filter(format => {
            // Only include formats that have both video and audio
            return format.hasVideo && format.hasAudio && format.qualityLabel;
        });
        
        // Sort formats by quality (height)
        formats.sort((a, b) => (b.height || 0) - (a.height || 0));
        
        // Find best quality for SD (360p) and HD (720p)
        const sd = formats.find(f => f.height <= 360) || formats[formats.length - 1];
        const hd = formats.find(f => f.height <= 720) || formats[0];
        
        // Ensure we have at least one format
        if (!formats.length) {
            throw new Error('No suitable formats found for this video');
        }

        return {
            title: info.videoDetails.title,
            formats: [sd, hd].filter(f => f), // Remove null entries
            videoDetails: info.videoDetails
        };
    } catch (error) {
        console.error('Error getting video qualities:', error);
        // Add more specific error information
        if (error.message.includes('Video unavailable')) {
            throw new Error('This video is unavailable or private');
        } else if (error.message.includes('copyright')) {
            throw new Error('This video is not available due to copyright restrictions');
        } else {
            throw new Error(`Could not get video info: ${error.message}`);
        }
    }
}

async function downloadYouTubeVideoWithQuality(url, outputPath, quality) {
    return new Promise((resolve, reject) => {
        try {
            const video = ytdl(url, {
                quality: quality,
                filter: 'audioandvideo',
            });

            const writeStream = createWriteStream(outputPath);
            let starttime = Date.now();
            let downloaded = 0;
            let totalSize = 0;

            video.on('info', (info, format) => {
                console.log(`Video title: ${info.videoDetails.title}`);
                console.log(`Quality: ${format.qualityLabel}`);
                console.log(`Duration: ${info.videoDetails.lengthSeconds} seconds`);
                totalSize = format.contentLength;
                console.log(`Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
            });

            video.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalSize) {
                    const percent = (downloaded / totalSize) * 100;
                    const downloadedMB = (downloaded / 1024 / 1024).toFixed(2);
                    const totalMB = (totalSize / 1024 / 1024).toFixed(2);
                    console.log(`Downloaded: ${percent.toFixed(2)}% (${downloadedMB}MB of ${totalMB}MB)`);
                }
            });

            video.pipe(writeStream);

            writeStream.on('finish', () => {
                console.log('Successfully downloaded video');
                resolve();
            });

            writeStream.on('error', (err) => {
                console.error('Error writing to file:', err);
                reject(err);
            });

            video.on('error', (err) => {
                console.error('Error downloading video:', err);
                reject(err);
            });
        } catch (error) {
            console.error('Error in downloadYouTubeVideo:', error);
            reject(error);
        }
    });
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
            console.log('Received message update of type:', type);
            console.log('Raw message:', JSON.stringify(messages[0], null, 2));

            const m = messages[0];
            if (!m.message) {
                console.log('No message content found');
                return;
            }

            // Log all available message types
            console.log('Available message types:', Object.keys(m.message));

            // Try to get the message content from different possible locations
            let messageText = '';
            if (m.message.conversation) {
                messageText = m.message.conversation;
            } else if (m.message.extendedTextMessage) {
                messageText = m.message.extendedTextMessage.text;
            } else {
                console.log('Message type not supported');
                return;
            }

            const sender = m.key.remoteJid;
            if (!sender) {
                console.log('No sender found');
                return;
            }

            console.log('Processing message:', messageText);
            console.log('From sender:', sender);

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
                    // Send acknowledgment
                    await sock.sendMessage(sender, { text: '📥 Checking video availability...' });

                    const videoUrl = `https://www.youtube.com/watch?v=${youtubeMatch[1]}`;
                    const { title, formats, videoDetails } = await getVideoQualities(videoUrl);

                    // Validate video length (optional, adjust the limit as needed)
                    const duration = parseInt(videoDetails.lengthSeconds);
                    if (duration > 600) { // 10 minutes limit
                        await sock.sendMessage(sender, { 
                            text: '❌ Video is too long. Please choose a video under 10 minutes.' 
                        });
                        return;
                    }

                    if (!formats || formats.length === 0) {
                        throw new Error('No suitable video formats found');
                    }

                    // Create quality selection message
                    let message = `🎥 *${title}*\n\nChoose video quality:\n\n`;
                    
                    formats.forEach((format, index) => {
                        const size = format.contentLength ? 
                            `(${(format.contentLength / (1024 * 1024)).toFixed(2)}MB)` : 
                            '(size unknown)';
                        message += `*${index + 1}* - ${format.qualityLabel} ${size}\n`;
                    });
                    
                    message += '\nReply with the number of your choice.';

                    // Store video info for later use
                    const videoInfo = {
                        url: videoUrl,
                        title: title,
                        formats: formats
                    };
                    pendingDownloads.set(sender, videoInfo);
                    
                    await sock.sendMessage(sender, { text: message });

                } catch (error) {
                    console.error('Error processing video:', error);
                    await sock.sendMessage(sender, { 
                        text: `❌ ${error.message || 'Sorry, I couldn\'t process this video. Please try another one.'}` 
                    });
                }
                return;
            }

            if (pendingDownloads.has(sender) && (messageText === '1' || messageText === '2')) {
                // Handle quality selection
                const quality = messageText === '1' ? 'sd' : 'hd';
                const videoInfo = pendingDownloads.get(sender);

                if (videoInfo) {
                    try {
                        const selectedFormat = videoInfo.formats[parseInt(messageText) - 1];
                        if (!selectedFormat) {
                            throw new Error(`${quality.toUpperCase()} quality not available for this video`);
                        }

                        const timestamp = Date.now();
                        const outputPath = join(downloadsDir, `video_${timestamp}.mp4`);

                        // Ensure downloads directory exists
                        await fs.mkdir(downloadsDir, { recursive: true });

                        // Send download start message
                        await sock.sendMessage(sender, { 
                            text: `📥 Downloading video in ${selectedFormat.qualityLabel}...` 
                        });

                        // Download the video
                        await downloadYouTubeVideoWithQuality(videoInfo.url, outputPath, selectedFormat.itag);

                        // Read the downloaded file
                        console.log('Reading video file...');
                        const videoBuffer = await fs.readFile(outputPath);
                        const stats = await fs.stat(outputPath);
                        console.log('File size:', stats.size / (1024 * 1024), 'MB');

                        // Send the video
                        console.log('Sending video...');
                        await sock.sendMessage(sender, { 
                            video: videoBuffer,
                            caption: `✅ ${videoInfo.title}\nQuality: ${selectedFormat.qualityLabel}`
                        });

                        // Clean up
                        pendingDownloads.delete(sender);
                        await fs.unlink(outputPath);

                    } catch (error) {
                        console.error('Error downloading video:', error);
                        await sock.sendMessage(sender, { 
                            text: '❌ Sorry, I couldn\'t download the video. Please try another quality or video.' 
                        });
                    }
                }
            }
        });

    } catch (err) {
        console.error('Error in connectToWhatsApp:', err);
    }
}

// Start the bot
console.log('Starting WhatsApp bot...');
connectToWhatsApp();
