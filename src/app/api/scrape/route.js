import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function POST(req) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'Đường dẫn URL không được để trống' }, { status: 400 });
    }

    // Basic URL validation
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return NextResponse.json({ error: 'Đường dẫn URL không hợp lệ' }, { status: 400 });
    }

    const host = parsedUrl.hostname.toLowerCase();

    let html = '';
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'vi,en-US;q=0.7,en;q=0.3',
          'Referer': parsedUrl.origin
        },
        timeout: 10000 // 10s timeout
      });
      html = response.data;
    } catch (directError) {
      console.warn('Direct fetch failed, attempting proxy fetch via AllOrigins...', directError.message);
    }

    // Fallback to allorigins proxy if direct HTML is empty or contains Cloudflare challenge/protection
    if (!html || typeof html !== 'string' || html.includes('cloudflare') || html.includes('Just a moment') || html.includes('captcha') || html.includes('ddos')) {
      try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const proxyResponse = await axios.get(proxyUrl, { timeout: 15000 });
        if (proxyResponse.data && proxyResponse.data.contents) {
          html = proxyResponse.data.contents;
        }
      } catch (proxyError) {
        console.error('AllOrigins proxy fetch failed:', proxyError.message);
      }
    }

    if (!html) {
      return NextResponse.json({ 
        error: 'Không thể tải nội dung trang web. Có thể trang web này chặn bot hoặc đang bảo trì. Vui lòng thử lại với một chương/trang khác.' 
      }, { status: 502 });
    }

    const $ = cheerio.load(html);
    const images = [];

    // Specific domain selectors
    if (host.includes('nettruyen') || host.includes('nhattruyen')) {
      $('.reading-detail .page-chapter img').each((i, el) => {
        const src = $(el).attr('data-original') || $(el).attr('src') || $(el).attr('data-src');
        if (src) {
          images.push(cleanUrl(src, parsedUrl.origin));
        }
      });
    } else if (host.includes('blogtruyen')) {
      $('#content img').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('banner') && !src.includes('logo')) {
          images.push(cleanUrl(src, parsedUrl.origin));
        }
      });
    } else if (host.includes('truyenqq') || host.includes('qutruyen')) {
      $('.chapter-content img, .story-see-content img').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-original') || $(el).attr('data-src');
        if (src) {
          images.push(cleanUrl(src, parsedUrl.origin));
        }
      });
    } else {
      // Smart Generic Fallback
      // Try common manga reading container classes
      const containers = [
        '.reading-detail', '.chapter-content', '.story-see-content', 
        '#content', '.content', '.vung-doc', '#chapter-content',
        '.box-doc', '.box_doc', '.reader-content', '#reader-content',
        '.comic-pages', '.manga-pages', 'article', '#read-area',
        '.wp-manga-chapter-img', '.reading-content', '#image', '.image-link',
        '.chapter-c', '#chapter-c', '.chapter-pages', '.manga-container'
      ];

      let foundInContainer = false;

      for (const container of containers) {
        if ($(container).length > 0) {
          $(container).find('img').each((i, el) => {
            const src = $(el).attr('data-original') || 
                        $(el).attr('data-src') || 
                        $(el).attr('src') || 
                        $(el).attr('data-url') ||
                        $(el).attr('data-cdn');
            if (src && isValidMangaImage(src)) {
              images.push(cleanUrl(src, parsedUrl.origin));
              foundInContainer = true;
            }
          });
          if (foundInContainer && images.length > 3) break; // If we found high-quality targets, stop checking other containers
        }
      }

      // Absolute fallback: search all images on page if no container matched
      if (!foundInContainer || images.length === 0) {
        $('img').each((i, el) => {
          const src = $(el).attr('data-original') || 
                      $(el).attr('data-src') || 
                      $(el).attr('data-lazy-src') ||
                      $(el).attr('data-src-webp') ||
                      $(el).attr('src') || 
                      $(el).attr('data-url') ||
                      $(el).attr('srcset') ||
                      $(el).attr('data-srcset');
          if (src && isValidMangaImage(src) && isLikelyChapterImage(src, $(el))) {
            images.push(cleanUrl(src, parsedUrl.origin));
          }
        });
      }
    }

    // ULTIMATE FALLBACK: Script / Raw HTML Regex Scanner
    // If standard DOM scraping yielded 0 images (common on modern JS-hydrated or obfuscated reader pages),
    // extract all sequential image URLs from the raw HTML text (e.g. inside script blocks).
    if (images.length === 0 && html) {
      const imgRegex = /https?:\/\/[^\s"'`<>]+?\.(?:jpg|jpeg|png|webp)/gi;
      let match;
      const regexFound = [];
      while ((match = imgRegex.exec(html)) !== null) {
        const matchedUrl = match[0];
        if (isValidMangaImage(matchedUrl)) {
          regexFound.push(cleanUrl(matchedUrl, parsedUrl.origin));
        }
      }
      
      // Keep only images that are likely part of the manga chapter
      // (Manga sites usually have consecutive numbers or high-quality image paths)
      if (regexFound.length > 0) {
        images.push(...regexFound);
      }
    }

    // Deduplicate images while maintaining order
    const uniqueImages = [...new Set(images)];

    if (uniqueImages.length === 0) {
      return NextResponse.json({ 
        error: 'Không tìm thấy trang truyện nào trên trang này. Bạn hãy thử kiểm tra lại đường dẫn hoặc sử dụng tính năng dán danh sách link ảnh trực tiếp tại Studio.' 
      }, { status: 404 });
    }

    // Return title of the chapter/story if possible
    let title = $('title').text().trim();
    // Clean title (remove suffixes like "- NetTruyen", etc.)
    title = title.replace(/\s*-\s*NetTruyen.*$/i, '')
                 .replace(/\s*-\s*BlogTruyen.*$/i, '')
                 .replace(/\s*-\s*TruyenQQ.*$/i, '')
                 .replace(/Đọc truyện/i, '')
                 .trim();

    return NextResponse.json({
      title: title || 'Truyện tranh không tên',
      images: uniqueImages
    });

  } catch (error) {
    console.error('Error scraping manga URL:', error);
    return NextResponse.json({ 
      error: `Không thể kết nối đến trang web: ${error.message}. Bạn nên sử dụng tính năng 'Tải ảnh trực tiếp' hoặc 'Nhập link ảnh' ở máy tính / điện thoại.` 
    }, { status: 500 });
  }
}

// Helpers
function cleanUrl(url, baseOrigin) {
  let cleaned = url.trim();
  if (cleaned.startsWith('//')) {
    cleaned = 'https:' + cleaned;
  } else if (cleaned.startsWith('/')) {
    cleaned = baseOrigin + cleaned;
  }
  return cleaned;
}

function isValidMangaImage(src) {
  const excludeKeywords = ['logo', 'avatar', 'banner', 'icon', 'fb-share', 'button', 'loading', 'gif', 'advertis', 'quangcao', 'widget'];
  const lower = src.toLowerCase();
  
  // Exclude tracker pixels or common UI elements
  if (excludeKeywords.some(kw => lower.includes(kw))) {
    return false;
  }
  
  // Make sure it looks like a valid image url
  return (
    lower.startsWith('http') || 
    lower.startsWith('//') || 
    lower.startsWith('/')
  );
}

function isLikelyChapterImage(src, cheerioEl) {
  // A chapter image is usually large and has descriptive attributes, or is inside a list
  const width = cheerioEl.attr('width');
  const height = cheerioEl.attr('height');
  
  if (width && parseInt(width) < 200) return false;
  if (height && parseInt(height) < 200) return false;
  
  const alt = (cheerioEl.attr('alt') || '').toLowerCase();
  const title = (cheerioEl.attr('title') || '').toLowerCase();
  
  // Usually chapter images have names like "trang 1", "page 1", "chapter", or simply numbers
  if (alt.includes('trang') || alt.includes('page') || /\d+/.test(alt)) {
    return true;
  }
  
  // If parent element is list item or div with reader-like class
  const parentClass = (cheerioEl.parent().attr('class') || '').toLowerCase();
  const parentId = (cheerioEl.parent().attr('id') || '').toLowerCase();
  if (parentClass.includes('page') || parentClass.includes('chapter') || parentId.includes('chapter')) {
    return true;
  }
  
  return true;
}
