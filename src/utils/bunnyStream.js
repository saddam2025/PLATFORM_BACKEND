const axios = require('axios');
const crypto = require('crypto');

const BUNNY_API_BASE = 'https://video.bunnycdn.com';
const DIRECT_UPLOAD_TTL_SECONDS = 15 * 60;
// Bunny's post-upload states: Uploaded, Processing, Transcoding, Finished,
// and ResolutionFinished. Created and error states are intentionally excluded.
const CONFIRMABLE_VIDEO_STATUSES = new Set([1, 2, 3, 4, 5]);

function createError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function config() {
  const required = ['BUNNY_LIBRARY_ID', 'BUNNY_API_KEY', 'BUNNY_CDN_HOSTNAME'];
  if (required.some((name) => !process.env[name]?.trim())) throw createError('Bunny Stream configuration is unavailable');
  return {
    libraryId: process.env.BUNNY_LIBRARY_ID.trim(),
    apiKey: process.env.BUNNY_API_KEY.trim(),
    cdnHostname: process.env.BUNNY_CDN_HOSTNAME.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  };
}

async function createVideoSlot(title) {
  const settings = config();
  try {
    const response = await axios.post(
      `${BUNNY_API_BASE}/library/${encodeURIComponent(settings.libraryId)}/videos`,
      { title: String(title || 'Untitled video').trim().slice(0, 200) || 'Untitled video' },
      { headers: { AccessKey: settings.apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    if (!response.data?.guid) throw createError('Bunny Stream did not return a video ID', 502);
    return { settings, videoId: response.data.guid };
  } catch (err) {
    if (err.statusCode) throw err;
    console.error(`Bunny video-slot creation failed: ${err.response?.status || err.code || 'unknown error'}`);
    throw createError('Could not create a Bunny Stream upload slot', 502);
  }
}

function directTusUpload(videoId, settings) {
  const expiresAt = Math.floor(Date.now() / 1000) + DIRECT_UPLOAD_TTL_SECONDS;
  // Bunny's documented presigned TUS signature: library ID + API key +
  // expiry + the one video GUID created above. The API key itself is never
  // included in this response.
  const signature = crypto.createHash('sha256')
    .update(`${settings.libraryId}${settings.apiKey}${expiresAt}${videoId}`)
    .digest('hex');
  return {
    endpoint: `${BUNNY_API_BASE}/tusupload`,
    headers: {
      AuthorizationSignature: signature,
      AuthorizationExpire: String(expiresAt),
      VideoId: videoId,
      LibraryId: settings.libraryId
    },
    expiresAt
  };
}

async function getVerifiedUploadedVideo(videoId) {
  const settings = config();
  try {
    const response = await axios.get(
      `${BUNNY_API_BASE}/library/${encodeURIComponent(settings.libraryId)}/videos/${encodeURIComponent(videoId)}`,
      { headers: { AccessKey: settings.apiKey }, timeout: 15000 }
    );
    const video = response.data;
    if (String(video?.guid) !== String(videoId) || String(video?.videoLibraryId) !== String(settings.libraryId) || !CONFIRMABLE_VIDEO_STATUSES.has(Number(video?.status))) {
      throw createError('Bunny Stream has not accepted this video upload yet', 409);
    }
    return { video, settings };
  } catch (err) {
    if (err.statusCode) throw err;
    console.error(`Bunny video verification failed: ${err.response?.status || err.code || 'unknown error'}`);
    throw createError('Could not verify the Bunny Stream upload', 502);
  }
}

function playbackUrls(videoId, settings) {
  return {
    videoUrl: `https://${settings.cdnHostname}/${videoId}/playlist.m3u8`,
    bunnyEmbedUrl: `https://iframe.mediadelivery.net/embed/${settings.libraryId}/${videoId}`
  };
}

module.exports = { createVideoSlot, directTusUpload, getVerifiedUploadedVideo, playbackUrls, DIRECT_UPLOAD_TTL_SECONDS };
