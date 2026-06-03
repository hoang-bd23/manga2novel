// AI Service Integration for Manga to Novel conversion supporting multiple providers
export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Nhanh & Tối ưu)', default: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Thông minh & Chi tiết nhất)' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
];

export const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com' },
  { id: 'openai', name: 'OpenAI ChatGPT', defaultUrl: 'https://api.openai.com/v1' },
  { id: 'grok', name: 'xAI Grok', defaultUrl: 'https://api.x.ai/v1' },
  { id: 'deepseek', name: 'DeepSeek', defaultUrl: 'https://api.deepseek.com/v1' },
  { id: 'custom', name: 'Custom (Tương thích OpenAI)', defaultUrl: '' }
];

export const DEFAULT_PROMPT = `Bạn là một nhà văn xuất sắc chuyên chuyển đổi truyện tranh (Manga/Webtoon) thành tiểu thuyết chữ (novel). 
Nhiệm vụ của bạn là chuyển đổi hình ảnh trang truyện tranh này thành một chương/phân đoạn tiểu thuyết hoàn chỉnh, giàu tính nghệ thuật bằng tiếng Việt.

Hãy tuân thủ nghiêm ngặt các quy tắc sau:
1. XÁC ĐỊNH NHÂN VẬT & LỜI THOẠI:
   - Hãy đọc thật kỹ và trích xuất TOÀN BỘ lời thoại, lời dẫn, hay độc thoại nội tâm xuất hiện trên trang truyện.
   - Giữ nguyên ý nghĩa lời thoại gốc, KHÔNG ĐƯỢC tự ý lược bỏ hay thay đổi ý nghĩa.
   - Định dạng lời thoại theo phong cách tiểu thuyết tiếng Việt chuẩn (sử dụng dấu gạch ngang đầu dòng "- ..." hoặc dấu ngoặc kép "..."). Chỉ rõ ai đang nói bằng các cụm từ mô tả giọng điệu (ví dụ: "... - cậu nói khàn khàn", "... - cô thốt lên kinh ngạc").

2. BỔ SUNG MÔ TẢ CHI TIẾT (LÀM GIÀU VĂN BẢN):
   - Mô tả CHI TIẾT và BẢN SẮC của từng khung tranh (panels):
     * Khung cảnh xung quanh, thời tiết, ánh sáng, màu sắc, bầu không khí (u tối, lãng mạn, căng thẳng...).
     * Biểu cảm gương mặt, ánh mắt, nụ cười, hay nét cau mày của nhân vật để làm nổi bật tâm trạng thực tế của họ.
     * Các hành động, tư thế, chuyển động cơ thể, cử chỉ tay của từng cá thể đang trong khung truyện.
   - Tạo ra sự liên kết mượt mà giữa các khung tranh để độc giả cảm giác như đang đọc một cuốn tiểu thuyết liền mạch, không bị đứt quãng.

3. THỨ TỰ ĐỌC TRUYỆN:
   - Đọc theo đúng chuẩn manga (từ PHẢI qua TRÁI, từ TRÊN xuống DƯỚI) hoặc chuẩn webtoon (từ TRÊN xuống DƯỚI) để đảm bảo trình tự cốt truyện diễn ra chính xác.

4. NGÔN NGỮ — QUY TẮC BẮT BUỘC (QUAN TRỌNG NHẤT):
   - TOÀN BỘ nội dung đầu ra PHẢI được viết bằng tiếng Việt, KHÔNG NGOẠI LỆ.
   - Mọi lời thoại của nhân vật (dù gốc là tiếng Nhật, tiếng Anh, tiếng Trung, tiếng Hàn hay bất kỳ ngôn ngữ nào khác) ĐỀU PHẢI được dịch sang tiếng Việt tự nhiên, trôi chảy.
   - Các âm thanh (SFX), hiệu ứng tiếng động (ví dụ: "BOOM", "CRASH", "ドカッ", "쾅") phải được Việt hóa thành mô tả văn học (ví dụ: "một tiếng nổ vang trời", "tiếng va chạm chát chúa") hoặc phiên âm tiếng Việt gần nhất, KHÔNG giữ nguyên chữ nước ngoài.
   - TUYỆT ĐỐI KHÔNG để lại bất kỳ từ, câu, hay đoạn văn nào bằng tiếng nước ngoài trong văn bản đầu ra.

5. ĐỊNH DẠNG ĐẦU RA:
   - Chỉ trả về phần nội dung tiểu thuyết tiếng Việt được viết chỉn chu.
   - Không thêm lời mở đầu, lời kết, lời giải thích hay bất kỳ ghi chú ngoài lề nào khác.`;

/**
 * Converts a data URL or raw Base64 image to novel text using selected API
 * All requests are routed securely through the Next.js server-side AI proxy.
 * @param {string} base64Data - Raw base64 image data (without data:image/...;base64 prefix)
 * @param {string} mimeType - Image mime type (e.g. 'image/jpeg', 'image/png')
 * @param {string} apiKey - User's Gemini API key (legacy fallback)
 * @param {string} model - Selected model name (legacy fallback)
 * @param {string} customPrompt - Custom prompts/instructions from the user
 * @param {object} config - Optional direct configuration object
 */
export async function convertMangaPageToNovel({
  base64Data,
  mimeType = 'image/jpeg',
  apiKey,
  model = 'gemini-2.5-flash',
  customPrompt = '',
  config = null
}) {
  let activeConfig = config;

  // Client-side auto-loading of the active configuration
  if (!activeConfig && typeof window !== 'undefined') {
    try {
      const activeId = localStorage.getItem('manga2novel_active_config_id');
      const savedConfigs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
      activeConfig = savedConfigs.find(c => c.id === activeId) || null;
      
      // Auto-migrate in localStorage for seamless transition to flagship Grok 4.3
      if (activeConfig && activeConfig.provider === 'grok' && (activeConfig.model === 'grok-2-vision-1212' || activeConfig.model === 'grok-2-vision' || activeConfig.model === 'grok-vision-beta')) {
        activeConfig.model = 'grok-4.3';
        const migratedConfigs = savedConfigs.map(c => c.id === activeConfig.id ? activeConfig : c);
        localStorage.setItem('manga2novel_api_configs', JSON.stringify(migratedConfigs));
      }
    } catch (e) {
      console.error('Failed to parse API configurations from localStorage:', e);
    }
  }

  // Fallback to legacy configuration if no active configuration exists
  if (!activeConfig) {
    activeConfig = {
      provider: 'gemini',
      apiKey: apiKey || (typeof window !== 'undefined' ? localStorage.getItem('manga2novel_api_key') : '') || '',
      model: model || (typeof window !== 'undefined' ? localStorage.getItem('manga2novel_model') : 'gemini-2.5-flash') || 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com'
    };
  }

  const { provider = 'gemini', apiKey: key, model: aiModel, baseUrl } = activeConfig;

  const isKeyEmpty = !key || !key.trim();
  const isKeyMasked = key && key.includes('•');

  if (isKeyEmpty && !isKeyMasked) {
    throw new Error('Vui lòng cấu hình API Key trong phần cài đặt trước khi thực hiện!');
  }

  const promptText = customPrompt.trim() ? customPrompt.trim() : DEFAULT_PROMPT;

  try {
    const proxyUrl = '/api/ai-proxy';
    
    const payload = {
      provider,
      key,
      baseUrl,
      aiModel,
      promptText,
      base64Data,
      mimeType
    };

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || `Lỗi máy chủ proxy (HTTP ${response.status})`;
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return (result.text || '').normalize('NFC');
  } catch (error) {
    console.error(`Error calling AI proxy:`, error);
    throw error;
  }
}
