import { NextResponse } from 'next/server';
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return new Response('Missing image URL', { status: 400 });
    }

    // Validate URL
    let targetUrl;
    try {
      targetUrl = new URL(imageUrl);
    } catch (e) {
      return new Response('Invalid image URL', { status: 400 });
    }

    // Determine referrer based on target URL or custom query param
    const customReferer = searchParams.get('referer');
    let referer = targetUrl.origin;
    if (customReferer) {
      try {
        // If referer contains query parameters, decode it and get its origin or full URL
        const parsedReferer = new URL(decodeURIComponent(customReferer));
        referer = parsedReferer.origin + '/'; // CDN referers usually match the host domain with a trailing slash
      } catch (err) {
        referer = decodeURIComponent(customReferer);
      }
    }

    const response = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': referer,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      timeout: 15000 // 15s timeout
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    
    // Return the image buffer as binary stream
    return new Response(response.data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*', // Crucial to bypass CORS on the frontend!
        'Cache-Control': 'public, max-age=31536000, immutable' // Cache for high performance
      }
    });

  } catch (error) {
    console.error('Error proxying image:', error.message);
    return new Response(`Failed to load image: ${error.message}`, { status: 500 });
  }
}
