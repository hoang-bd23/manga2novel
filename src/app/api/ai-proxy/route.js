import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/utils/auth';
import * as db from '@/utils/db-server';

export async function POST(req) {
  try {
    const { 
      provider, 
      key, 
      baseUrl, 
      aiModel, 
      promptText, 
      base64Data, 
      mimeType 
    } = await req.json();

    // 1. Get user session to identify user
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id || 'dev-guest-user';

    // 2. Securely resolve the API Key, Model, and Provider details on the server side
    let resolvedKey = key;
    let resolvedModel = aiModel;
    let resolvedBaseUrl = baseUrl;
    let resolvedProvider = provider;

    // Check if key is empty or masked (starts with •)
    if (!resolvedKey || resolvedKey.includes('•')) {
      console.log(`[AI Proxy] Resolving masked API Key for user: ${userId}`);
      const rawConfigs = await db.getApiConfigs(userId, true);
      let activeConfig = null;

      // Support API pooling on the server side
      if (rawConfigs.useApiPool && rawConfigs.poolConfigIds?.length > 0) {
        console.log(`[AI Proxy] API Pool enabled. Cycling through ${rawConfigs.poolConfigIds.length} keys...`);
        const randomIndex = Math.floor(Math.random() * rawConfigs.poolConfigIds.length);
        const poolConfigId = rawConfigs.poolConfigIds[randomIndex];
        activeConfig = rawConfigs.configs?.find(c => c.id === poolConfigId);
      } else {
        activeConfig = rawConfigs.configs?.find(c => c.id === rawConfigs.activeConfigId);
      }

      if (activeConfig) {
        resolvedKey = activeConfig.apiKey;
        resolvedModel = activeConfig.model;
        resolvedBaseUrl = activeConfig.baseUrl;
        resolvedProvider = activeConfig.provider;
        console.log(`[AI Proxy] Resolved key for config: "${activeConfig.name}" (${resolvedProvider}/${resolvedModel})`);
      }
    }

    if (!resolvedKey) {
      return NextResponse.json({ 
        error: 'Chưa cấu hình API Key. Vui lòng cài đặt và lưu API Key vào tài khoản của bạn.' 
      }, { status: 400 });
    }

    // Auto-migrate legacy Grok model name to flagship Grok 4.3 vision model
    if (resolvedProvider === 'grok' && (resolvedModel === 'grok-2-vision-1212' || resolvedModel === 'grok-2-vision' || resolvedModel === 'grok-vision-beta')) {
      resolvedModel = 'grok-4.3';
    }

    // ==========================================
    // 1. GOOGLE GEMINI NATIVE API FORWARDING
    // ==========================================
    if (resolvedProvider === 'gemini') {
      const cleanModel = resolvedModel || 'gemini-2.5-flash';
      const cleanBase = (resolvedBaseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
      const apiEndpoint = `${cleanBase}/v1beta/models/${cleanModel}:generateContent?key=${resolvedKey}`;

      console.log(`Server-side proxy forwarding to Google Gemini: ${cleanModel}`);

      const payload = {
        contents: [
          {
            parts: [
              { text: promptText },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2500
        }
      };

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[AI Proxy Gemini Error] Raw response:`, errorText);
        let errorMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch (e) {}

        return NextResponse.json({ 
          error: `Lỗi từ Google Gemini: ${errorMessage}` 
        }, { status: response.status });
      }

      const result = await response.json();
      const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!generatedText) {
        return NextResponse.json({ 
          error: 'Gemini API không trả về văn bản dịch. Vui lòng thử lại.' 
        }, { status: 500 });
      }

      return NextResponse.json({ text: generatedText });
    }

    // ==========================================
    // 2. OPENAI, GROK, DEEPSEEK, CUSTOM VISION FORWARDING
    // ==========================================
    else {
      let defaultBaseUrl = 'https://api.openai.com/v1';
      if (resolvedProvider === 'grok') {
        defaultBaseUrl = 'https://api.x.ai/v1';
      } else if (resolvedProvider === 'deepseek') {
        defaultBaseUrl = 'https://api.deepseek.com/v1';
      } else if (resolvedProvider === 'custom' && !resolvedBaseUrl) {
        return NextResponse.json({
          error: 'Vui lòng nhập Base URL cho nhà cung cấp Custom (ví dụ: https://api.deepseek.com/v1).'
        }, { status: 400 });
      }

      const cleanBase = (resolvedBaseUrl || defaultBaseUrl).replace(/\/+$/, '');
      const apiEndpoint = `${cleanBase}/chat/completions`;

      console.log(`Server-side proxy forwarding to OpenAI-compatible provider (${resolvedProvider}): ${resolvedModel}`);

      const payload = {
        model: resolvedModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`
                }
              }
            ]
          }
        ],
        temperature: 0.4,
        max_tokens: 2500
      };

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolvedKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[AI Proxy OpenAI Error] Raw response from ${resolvedProvider.toUpperCase()}:`, errorText);
        
        let errorMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            errorMessage = typeof errorData.error === 'string' 
              ? errorData.error 
              : (errorData.error.message || JSON.stringify(errorData.error));
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch (e) {
          if (errorText) errorMessage = errorText.substring(0, 150);
        }

        return NextResponse.json({ 
          error: `Lỗi từ nhà cung cấp ${resolvedProvider.toUpperCase()}: ${errorMessage}` 
        }, { status: response.status });
      }

      const result = await response.json();
      const generatedText = result.choices?.[0]?.message?.content;

      if (!generatedText) {
        return NextResponse.json({ 
          error: `API của ${resolvedProvider.toUpperCase()} không trả về văn bản dịch. Vui lòng thử lại.` 
        }, { status: 500 });
      }

      return NextResponse.json({ text: generatedText });
    }

  } catch (error) {
    console.error('Error in Server AI Proxy:', error);
    return NextResponse.json({ 
      error: `Lỗi kết nối máy chủ trung gian: ${error.message}` 
    }, { status: 500 });
  }
}
