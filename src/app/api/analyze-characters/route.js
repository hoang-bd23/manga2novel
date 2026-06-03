import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/utils/auth';
import * as db from '@/utils/db-server';

const CHUNK_SIZE = 28000; // ~28K chars per chunk to stay within context limits

/**
 * Calls the AI proxy with a text-only request (no image).
 * Routes through the same pool key logic as the image proxy.
 */
async function callAIText(promptText, apiKey, provider, model, baseUrl) {
  let defaultBaseUrl = 'https://api.openai.com/v1';
  if (provider === 'grok') defaultBaseUrl = 'https://api.x.ai/v1';
  else if (provider === 'deepseek') defaultBaseUrl = 'https://api.deepseek.com/v1';
  else if (provider === 'gemini') {
    const cleanModel = model || 'gemini-2.5-flash';
    const cleanBase = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const endpoint = `${cleanBase}/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4000 }
      })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const cleanBase = (baseUrl || defaultBaseUrl).replace(/\/+$/, '');
  const res = await fetch(`${cleanBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: promptText }],
      temperature: 0.2,
      max_tokens: 4000
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * POST /api/analyze-characters
 * Analyzes all translated novel text from a project to identify characters and relationships.
 * Uses parallel chunk processing with all available pool API keys.
 */
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id || 'dev-guest-user';
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json({ error: 'Thiếu projectId.' }, { status: 400 });
    }

    // 1. Load all completed pages
    const pages = await db.getPagesForProject(projectId, userId);
    const completedPages = pages
      .filter(p => p.status === 'completed' && p.novelText?.trim())
      .sort((a, b) => a.pageNumber - b.pageNumber);

    if (completedPages.length === 0) {
      return NextResponse.json({ error: 'Chưa có trang nào được dịch xong để phân tích.' }, { status: 400 });
    }

    // 2. Load all available API keys from pool
    const rawConfigs = await db.getApiConfigs(userId, true);
    const allConfigs = rawConfigs.configs || [];
    if (allConfigs.length === 0) {
      return NextResponse.json({ error: 'Chưa cấu hình API Key nào.' }, { status: 400 });
    }

    // 3. Build full text and split into chunks
    const fullText = completedPages
      .map(p => `=== TRANG ${p.pageNumber} ===\n${p.novelText}`)
      .join('\n\n');

    const chunks = [];
    for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
      chunks.push(fullText.slice(i, i + CHUNK_SIZE));
    }

    console.log(`[Analyze Characters] ${completedPages.length} pages, ${chunks.length} chunks, ${allConfigs.length} keys`);

    const analyzePrompt = (chunkText, chunkIdx, totalChunks) => `
Bạn là chuyên gia phân tích văn học. Đây là đoạn ${chunkIdx + 1}/${totalChunks} của một bộ tiểu thuyết dịch từ manga.

Hãy phân tích và trả về JSON (KHÔNG có markdown, chỉ JSON thuần):
{
  "characters": [
    {
      "name": "Tên nhân vật",
      "role": "main|supporting|minor",
      "description": "Mô tả ngắn về nhân vật, tính cách",
      "aliases": ["tên khác", "biệt hiệu nếu có"]
    }
  ],
  "relationships": [
    {
      "char1": "Tên nhân vật A",
      "char2": "Tên nhân vật B",
      "type": "Mối quan hệ (bạn thân, kẻ thù, anh em, thầy trò, tình nhân...)",
      "pronouns": "A xưng hô với B: '...', B xưng hô với A: '...'"
    }
  ]
}

NỘI DUNG TIỂU THUYẾT:
${chunkText}

Chỉ trả về JSON, không giải thích thêm.`;

    // 4. Process all chunks in parallel (round-robin keys)
    const chunkResults = await Promise.all(
      chunks.map(async (chunk, idx) => {
        const config = allConfigs[idx % allConfigs.length];
        const prompt = analyzePrompt(chunk, idx, chunks.length);
        try {
          const raw = await callAIText(prompt, config.apiKey, config.provider, config.model, config.baseUrl);
          const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          return JSON.parse(cleaned);
        } catch (e) {
          console.error(`[Analyze Characters] Chunk ${idx} failed:`, e.message);
          return { characters: [], relationships: [] };
        }
      })
    );

    // 5. Merge results: deduplicate by name
    const charMap = new Map();
    const relMap = new Map();

    for (const result of chunkResults) {
      for (const char of (result.characters || [])) {
        const key = char.name?.toLowerCase().trim();
        if (!key) continue;
        if (!charMap.has(key) || charMap.get(key).role === 'minor') {
          charMap.set(key, char);
        }
      }
      for (const rel of (result.relationships || [])) {
        const key = [rel.char1, rel.char2].sort().join('|').toLowerCase();
        if (!relMap.has(key)) relMap.set(key, rel);
      }
    }

    const mergedCharacters = [...charMap.values()].sort((a, b) => {
      const roleOrder = { main: 0, supporting: 1, minor: 2 };
      return (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2);
    });
    const mergedRelationships = [...relMap.values()];

    // 6. Build pronouns rule text for glossary
    const mainChars = mergedCharacters.filter(c => c.role === 'main' || c.role === 'supporting');
    let pronounsRule = '=== DANH SÁCH NHÂN VẬT ===\n';
    for (const c of mainChars) {
      pronounsRule += `• ${c.name} (${c.role === 'main' ? 'Nhân vật chính' : 'Nhân vật phụ'})`;
      if (c.aliases?.length) pronounsRule += ` — Còn gọi: ${c.aliases.join(', ')}`;
      if (c.description) pronounsRule += `\n  → ${c.description}`;
      pronounsRule += '\n';
    }
    if (mergedRelationships.length > 0) {
      pronounsRule += '\n=== MỐI QUAN HỆ & XƯNG HÔ ===\n';
      for (const r of mergedRelationships) {
        pronounsRule += `• ${r.char1} ↔ ${r.char2}: ${r.type}\n`;
        if (r.pronouns) pronounsRule += `  → ${r.pronouns}\n`;
      }
    }

    const characterAnalysisJson = JSON.stringify({ characters: mergedCharacters, relationships: mergedRelationships });

    // 7. Save to project
    await db.updateProject(projectId, {
      characterAnalysis: characterAnalysisJson,
      glossary: { pronouns: pronounsRule }
    }, userId);

    return NextResponse.json({
      success: true,
      characters: mergedCharacters,
      relationships: mergedRelationships,
      pronounsRule,
      chunksProcessed: chunks.length,
      pagesAnalyzed: completedPages.length
    });

  } catch (error) {
    console.error('[Analyze Characters] Error:', error);
    return NextResponse.json({ error: `Lỗi phân tích nhân vật: ${error.message}` }, { status: 500 });
  }
}
