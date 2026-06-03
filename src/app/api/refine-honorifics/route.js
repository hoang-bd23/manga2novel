import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/utils/auth';
import * as db from '@/utils/db-server';

const RATE_LIMIT_DELAY_MS = 2000; // 2 seconds between calls per API key

/** Sleep helper */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calls AI with text-only request for honorific refinement.
 */
async function callAIRefine(promptText, config) {
  const { apiKey, provider, model, baseUrl } = config;

  if (provider === 'gemini') {
    const cleanModel = model || 'gemini-2.5-flash';
    const cleanBase = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const endpoint = `${cleanBase}/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 3000 }
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini error: ${err.substring(0, 200)}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // OpenAI-compatible (openai, grok, deepseek, custom)
  let defaultBase = 'https://api.openai.com/v1';
  if (provider === 'grok') defaultBase = 'https://api.x.ai/v1';
  else if (provider === 'deepseek') defaultBase = 'https://api.deepseek.com/v1';

  const cleanBase = (baseUrl || defaultBase).replace(/\/+$/, '');
  const res = await fetch(`${cleanBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: promptText }],
      temperature: 0.3,
      max_tokens: 3000
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider} error: ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Build refinement prompt for a single page.
 */
function buildRefinePrompt(page, allPages, characterAnalysis, glossary) {
  const prevPage = allPages.find(p => p.pageNumber === page.pageNumber - 1);
  const nextPage = allPages.find(p => p.pageNumber === page.pageNumber + 1);

  let prompt = `Bạn là biên tập viên tiểu thuyết chuyên nghiệp. Nhiệm vụ của bạn là CHỈNH SỬA XƯNG HÔ cho đoạn văn sau đây.

QUY TẮC BẮT BUỘC:
1. Giữ NGUYÊN 100% nội dung, ý nghĩa và cốt truyện. KHÔNG thêm, bớt, thay đổi bất kỳ sự kiện nào.
2. CHỈ được sửa: đại từ nhân xưng, cách xưng hô giữa các nhân vật cho nhất quán và tự nhiên.
3. Toàn bộ đầu ra PHẢI bằng tiếng Việt.
4. Chỉ trả về đoạn văn đã chỉnh sửa, KHÔNG giải thích hay ghi chú gì thêm.`;

  if (characterAnalysis) {
    try {
      const analysis = JSON.parse(characterAnalysis);
      if (analysis.characters?.length > 0) {
        prompt += `\n\n=== DANH SÁCH NHÂN VẬT & MỐI QUAN HỆ ===\n`;
        for (const c of analysis.characters.filter(c => c.role !== 'minor').slice(0, 10)) {
          prompt += `• ${c.name} (${c.role === 'main' ? 'Nhân vật chính' : 'Nhân vật phụ'})`;
          if (c.aliases?.length) prompt += ` | Biệt danh: ${c.aliases.join(', ')}`;
          prompt += '\n';
        }
        if (analysis.relationships?.length > 0) {
          prompt += '\nQuy ước xưng hô:\n';
          for (const r of analysis.relationships.slice(0, 8)) {
            prompt += `• ${r.char1} ↔ ${r.char2} (${r.type}): ${r.pronouns || ''}\n`;
          }
        }
      }
    } catch (e) { /* ignore parse errors */ }
  }

  if (glossary?.pronouns) {
    prompt += `\n\n=== QUY ƯỚC XƯNG HÔ TOÀN TẬP ===\n${glossary.pronouns}`;
  }
  if (glossary?.style) {
    prompt += `\n\n=== VĂN PHONG ===\n${glossary.style}`;
  }

  if (prevPage?.novelText) {
    prompt += `\n\n=== ĐOẠN TRƯỚC (Trang ${prevPage.pageNumber}) — Để đảm bảo liền mạch ===\n${prevPage.novelText.slice(-500)}`;
  }

  prompt += `\n\n=== ĐOẠN CẦN CHỈNH SỬA (Trang ${page.pageNumber}) ===\n${page.novelText}`;

  return prompt;
}

/**
 * POST /api/refine-honorifics
 * Rewrites all translated pages with consistent, natural Vietnamese honorifics.
 * Uses parallel key distribution: N keys process N pages simultaneously,
 * each key handles ceil(pages/keys) pages sequentially with 2s delay between calls.
 */
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id || 'dev-guest-user';
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json({ error: 'Thiếu projectId.' }, { status: 400 });
    }

    // 1. Load project data (character analysis + glossary)
    const project = await db.getProject(projectId, userId);
    if (!project) {
      return NextResponse.json({ error: 'Không tìm thấy project.' }, { status: 404 });
    }

    // 2. Load all completed pages sorted by page number
    const allPages = await db.getPagesForProject(projectId);
    const completedPages = allPages
      .filter(p => p.status === 'completed' && p.novelText?.trim())
      .sort((a, b) => a.pageNumber - b.pageNumber);

    if (completedPages.length === 0) {
      return NextResponse.json({ error: 'Không có trang nào đã dịch xong để chỉnh sửa.' }, { status: 400 });
    }

    // 3. Load all API keys from pool
    const rawConfigs = await db.getApiConfigs(userId, true);
    const allConfigs = rawConfigs.configs || [];
    if (allConfigs.length === 0) {
      return NextResponse.json({ error: 'Chưa cấu hình API Key nào.' }, { status: 400 });
    }

    const numKeys = allConfigs.length;
    const numPages = completedPages.length;
    console.log(`[Refine Honorifics] ${numPages} pages, ${numKeys} keys — parallel distribution`);

    // 4. Distribute pages across keys: key[i] gets pages at indices i, i+numKeys, i+2*numKeys, ...
    const keyAssignments = Array.from({ length: numKeys }, () => []);
    completedPages.forEach((page, idx) => {
      keyAssignments[idx % numKeys].push(page);
    });

    const results = { success: 0, failed: 0, errors: [] };

    // 5. Run all key workers in parallel
    await Promise.all(
      keyAssignments.map(async (assignedPages, keyIdx) => {
        const config = allConfigs[keyIdx];
        if (assignedPages.length === 0) return;

        for (let i = 0; i < assignedPages.length; i++) {
          const page = assignedPages[i];

          // 2-second delay between calls for the same key (rate limit protection)
          if (i > 0) {
            await sleep(RATE_LIMIT_DELAY_MS);
          }

          try {
            const prompt = buildRefinePrompt(
              page,
              completedPages,
              project.characterAnalysis || '',
              project.glossary || {}
            );

            console.log(`[Refine] Key ${keyIdx + 1} → Page ${page.pageNumber} (${config.name || config.provider})`);
            const refinedText = await callAIRefine(prompt, config);

            if (refinedText?.trim()) {
              await db.updatePage(page.id, {
                novelText: refinedText.trim().normalize('NFC'),
                logs: `Xưng hô đã chỉnh sửa lúc ${new Date().toLocaleTimeString('vi-VN')}`
              });
              results.success++;
            } else {
              results.failed++;
              results.errors.push(`Trang ${page.pageNumber}: AI trả về rỗng`);
            }
          } catch (err) {
            console.error(`[Refine] Key ${keyIdx} failed on page ${page.pageNumber}:`, err.message);
            results.failed++;
            results.errors.push(`Trang ${page.pageNumber}: ${err.message.substring(0, 100)}`);
          }
        }
      })
    );

    return NextResponse.json({
      success: true,
      pagesProcessed: results.success,
      pagesFailed: results.failed,
      errors: results.errors.slice(0, 10),
      totalPages: numPages,
      keysUsed: numKeys
    });

  } catch (error) {
    console.error('[Refine Honorifics] Fatal error:', error);
    return NextResponse.json({ error: `Lỗi chỉnh sửa xưng hô: ${error.message}` }, { status: 500 });
  }
}
