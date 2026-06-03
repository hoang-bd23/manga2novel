'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import styles from './page.module.css';
import { 
  getProject, getPagesForProject, updatePage, updateProject, deletePage,
  analyzeCharacters, refineHonorifics
} from '@/utils/db';
import { convertMangaPageToNovel, DEFAULT_PROMPT } from '@/utils/gemini';
import { 
  ZoomIn, ZoomOut, Maximize2, Sparkles, Loader2, 
  Check, Play, Pause, Save, RefreshCw, ChevronLeft, 
  ChevronRight, AlertCircle, FileText, Settings, BookOpen, Trash2, ArrowLeft
} from 'lucide-react';

function StudioContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('id');
  const MAX_POOL_KEYS = 10;
  const SMART_READ_MODE_KEY = 'manga2novel_smart_read_mode';

  const [project, setProject] = useState(null);
  const [pages, setPages] = useState([]);
  const [activePage, setActivePage] = useState(null);
  const [selectedPageIds, setSelectedPageIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [smartReadMode, setSmartReadMode] = useState(false);
  const [loading, setLoading] = useState(true);

  // Zoom & Pan states
  const [scale, setScale] = useState(1);

  // AI conversion states for the ACTIVE page
  const [activeLogs, setActiveLogs] = useState([]);
  const [refineInstructions, setRefineInstructions] = useState('');

  // Bulk processing states
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const bulkStopRef = useRef(false);
  const [sidebarTab, setSidebarTab] = useState('pages'); // 'pages' or 'glossary'
  const [showBulkOptionModal, setShowBulkOptionModal] = useState(false);
  
  // Parallel concurrency control (how many pages to process at once)
  const [concurrency, setConcurrency] = useState(3);

  // API Pooling & Load Balancing states
  const [useApiPool, setUseApiPool] = useState(false);
  const [selectedPoolConfigIds, setSelectedPoolConfigIds] = useState([]);
  const [availableConfigs, setAvailableConfigs] = useState([]);
  const [fileInstructions, setFileInstructions] = useState('');

  // AI Post-processing: Character Analysis & Honorific Refinement
  const [isAnalyzingChars, setIsAnalyzingChars] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [refineResult, setRefineResult] = useState(null);

  // Debounce save timer
  const saveTimeoutRef = useRef(null);

  // Fetch project, page list, and ai_instructions.txt on mount
  useEffect(() => {
    if (!projectId) {
      router.push('/');
      return;
    }

    // Hydrate local configurations on mount to prevent server-client hydration mismatch and mobile crashes
    if (typeof window !== 'undefined') {
      setSmartReadMode(localStorage.getItem(SMART_READ_MODE_KEY) === 'true');
      const savedConcurrency = parseInt(localStorage.getItem('manga2novel_concurrency') || '3', 10);
      setConcurrency(Math.max(1, Math.min(10, savedConcurrency)));
      setUseApiPool(localStorage.getItem('manga2novel_use_api_pool') === 'true');
      try {
        const savedPoolIds = JSON.parse(localStorage.getItem('manga2novel_pool_config_ids') || '[]');
        setSelectedPoolConfigIds(Array.isArray(savedPoolIds) ? savedPoolIds : []);
      } catch (e) {}
    }

    const syncConfigsFromServer = async () => {
      try {
        const res = await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getApiConfigs' })
        });
        if (res.ok) {
          const { result } = await res.json();
          if (result) {
            const serverConfigs = result.configs || [];
            // Always sync server configs to localStorage so we keep client in sync with server's hardcoded keys
            if (serverConfigs.length > 0) {
              localStorage.setItem('manga2novel_api_configs', JSON.stringify(serverConfigs));
              localStorage.setItem('manga2novel_active_config_id', result.activeConfigId || '');
              localStorage.setItem('manga2novel_use_api_pool', String(result.useApiPool || false));
              localStorage.setItem('manga2novel_pool_config_ids', JSON.stringify(result.poolConfigIds || []));
              
              const activeConfig = serverConfigs.find(c => c.id === result.activeConfigId);
              if (activeConfig) {
                localStorage.setItem('manga2novel_api_key', activeConfig.apiKey);
                localStorage.setItem('manga2novel_model', activeConfig.model);
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to sync API configs from server:', e);
      }
    };

    syncConfigsFromServer();

    const loadFileInstructions = async () => {
      try {
        const res = await fetch('/api/ai-instructions');
        if (res.ok) {
          const data = await res.json();
          if (data.instructions && data.instructions.trim()) {
            setFileInstructions(data.instructions);
            if (typeof window !== 'undefined') {
              window.manga2novel_file_instructions = data.instructions;
            }
            console.log('Loaded prompt instructions from ai_instructions.txt successfully!');
          }
        }
      } catch (e) {
        console.error('Failed to load ai_instructions.txt:', e);
      }
    };
    
    loadFileInstructions();

    const loadData = async () => {
      try {
        const proj = await getProject(projectId);
        if (!proj) {
          router.push('/');
          return;
        }
        // Normalize Vietnamese text from DB
        if (proj.title) proj.title = proj.title.normalize('NFC');
        setProject(proj);

        const pageList = await getPagesForProject(projectId);
        const normalizedPages = pageList.map(p => ({
          ...p,
          novelText: (p.novelText || '').normalize('NFC')
        }));
        setPages(normalizedPages);

        if (normalizedPages.length > 0) {
          setActivePage(normalizedPages[0]);
        }
        setLoading(false);
      } catch (err) {
        console.error('Failed to load project data:', err);
        router.push('/');
      }
    };

    loadData();
  }, [projectId, router]);

  // Sync scroll on logs box to bottom
  const logsEndRef = useRef(null);
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
    }
  }, [activeLogs]);

  // Handle active page text change (autosave)
  const handleTextChange = (e) => {
    const text = e.target.value;
    
    // Update local state first for instant responsiveness
    setActivePage(prev => ({ ...prev, novelText: text }));
    setPages(prev => prev.map(p => p.id === activePage.id ? { ...p, novelText: text } : p));

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set a 400ms debounce to save to Dexie
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await updatePage(activePage.id, { novelText: text });
      } catch (err) {
        console.error('Failed to autosave novel text:', err);
      }
    }, 400);
  };

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activePage) return;

    const latestActivePage = pages.find(page => page.id === activePage.id);
    if (latestActivePage && latestActivePage !== activePage) {
      setActivePage(latestActivePage);
    }
  }, [pages, activePage]);

  // Helpers: Base64 and image fetching
  const getProxyImageUrl = (src, type) => {
    if (type === 'file') return src; // Already base64 encoded
    const refererParam = project?.mangaUrl ? `&referer=${encodeURIComponent(project.mangaUrl)}` : '';
    return `/api/proxy-image?url=${encodeURIComponent(src)}${refererParam}`;
  };

  // Convert any image source (file or url) to a raw base64 string
  const fetchImageAsBase64 = async (src, type) => {
    if (type === 'file') {
      // Split the data:image/png;base64, prefix
      const parts = src.split(',');
      return {
        base64: parts[1],
        mimeType: src.match(/data:(.*?);/)?.[1] || 'image/jpeg'
      };
    }

    // It's a web URL, we must fetch it via our local proxy (resolves CORS!)
    const proxyUrl = getProxyImageUrl(src, 'url');
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Không thể kết nối đến máy chủ ảnh (CORS Proxy). Status: ${response.status}`);
    }
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const parts = reader.result.split(',');
        resolve({
          base64: parts[1],
          mimeType: blob.type || 'image/jpeg'
        });
      };
      reader.onerror = () => reject(new Error('Lỗi chuyển đổi ảnh sang Base64.'));
      reader.readAsDataURL(blob);
    });
  };

  const addLog = (message) => {
    const time = new Date().toLocaleTimeString('vi-VN');
    setActiveLogs(prev => [...prev, { time, message }]);
  };

  // Handle glossary changes
  const handleGlossaryChange = async (key, value) => {
    if (!project) return;
    const updatedGlossary = {
      ...(project.glossary || {}),
      [key]: value
    };
    await updateProject(projectId, { glossary: updatedGlossary });
    setProject(prev => ({ ...prev, glossary: updatedGlossary }));
  };

  // Handle page deletion
  const handleDeletePage = async (pageId, e) => {
    e.stopPropagation();
    if (confirm('Bạn có chắc chắn muốn xóa trang truyện này? Các trang sau sẽ tự động được đánh số lại liên tục.')) {
      try {
        await deletePage(pageId);
        setSelectedPageIds(prev => prev.filter(id => id !== pageId));
        const pageList = await getPagesForProject(projectId);
        setPages(pageList);
        
        // Update active page
        if (activePage && activePage.id === pageId) {
          setActivePage(pageList.length > 0 ? pageList[0] : null);
        }
        
        const proj = await getProject(projectId);
        setProject(proj);
      } catch (err) {
        console.error('Failed to delete page:', err);
        alert('Lỗi khi xóa trang truyện.');
      }
    }
  };

  const handleTogglePageSelection = (pageId) => {
    setSelectedPageIds(prev =>
      prev.includes(pageId)
        ? prev.filter(id => id !== pageId)
        : [...prev, pageId]
    );
  };

  const handleSelectAllPages = () => {
    const allIds = pages.map(page => page.id);
    setSelectedPageIds(allIds);
  };

  const handleClearSelection = () => {
    setSelectedPageIds([]);
  };

  const handleBulkDeleteSelectedPages = async () => {
    if (selectedPageIds.length === 0) return;

    if (!confirm(`Bạn có chắc chắn muốn xóa ${selectedPageIds.length} khung hình đã chọn? Các trang còn lại sẽ được đánh số lại liên tục.`)) {
      return;
    }

    try {
      const pagesById = new Map(pages.map(page => [page.id, page]));
      const selectedPages = selectedPageIds
        .map(id => pagesById.get(id))
        .filter(Boolean)
        .sort((a, b) => b.pageNumber - a.pageNumber);

      for (const page of selectedPages) {
        await deletePage(page.id);
      }

      const pageList = await getPagesForProject(projectId);
      setPages(pageList);
      setSelectedPageIds([]);
      setSelectionMode(false);

      if (pageList.length === 0) {
        setActivePage(null);
      } else if (activePage && !pageList.some(page => page.id === activePage.id)) {
        setActivePage(pageList[0]);
      } else if (activePage) {
        setActivePage(pageList.find(page => page.id === activePage.id) || pageList[0]);
      }

      const proj = await getProject(projectId);
      setProject(proj);
    } catch (err) {
      console.error('Failed to bulk delete pages:', err);
      alert('Lỗi khi xóa nhiều trang truyện.');
    }
  };

  // Core logic: Convert a single page - now with content filtering bypass and auto-failover to other pool APIs
  const convertSinglePage = async (pageToProcess, customPromptOverride = '', apiConfigOverride = null, retryCount = 0, attemptedConfigIds = []) => {
    if (!pageToProcess) return;

    let activeConfig = apiConfigOverride;
    if (!activeConfig) {
      if (typeof window !== 'undefined') {
        const activeId = localStorage.getItem('manga2novel_active_config_id');
        const savedConfigs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
        
        // If API pooling is enabled and we have selected configs, pick one that hasn't been attempted yet
        if (useApiPool && selectedPoolConfigIds.length > 0) {
          const poolConfigs = savedConfigs.filter(c => selectedPoolConfigIds.includes(c.id));
          activeConfig = poolConfigs.find(c => !attemptedConfigIds.includes(c.id)) || poolConfigs[0] || null;
        } else {
          activeConfig = savedConfigs.find(c => c.id === activeId) || null;
        }
      }
    }

    // Fallback to legacy
    if (!activeConfig) {
      const apiKey = localStorage.getItem('manga2novel_api_key');
      const model = localStorage.getItem('manga2novel_model') || 'gemini-2.5-flash';
      if (!apiKey) {
        alert('Vui lòng vào mục "Cài đặt" ở góc trên cùng bên phải và cấu hình API Key của bạn để tiếp tục!');
        return false;
      }
      activeConfig = {
        provider: 'gemini',
        apiKey,
        model,
        baseUrl: 'https://generativelanguage.googleapis.com'
      };
    }

    const apiKey = activeConfig.apiKey;
    const model = activeConfig.model;
    
    // Assemble final prompt: custom prompt > file instructions > default prompt
    let basePrompt = customPromptOverride || localStorage.getItem('manga2novel_custom_prompt') || '';
    if (!basePrompt.trim()) {
      basePrompt = fileInstructions || DEFAULT_PROMPT;
    }
    let finalPrompt = basePrompt;

    // 1. Incorporate AI Glossary (Pronouns, style, keywords)
    const glossary = project?.glossary || {};
    let consistencyPrompt = '';

    if (glossary.pronouns || glossary.style || glossary.keywords) {
      consistencyPrompt += `\n\n=== BẢNG QUY ƯỚC DỊCH THỐNG NHẤT (TUÂN THỦ TUYỆT ĐỐI) ===\n`;
      if (glossary.pronouns) {
        consistencyPrompt += `* Quy ước Xưng hô & Nhân vật:\n${glossary.pronouns}\n`;
      }
      if (glossary.style) {
        consistencyPrompt += `* Quy ước Văn phong chung:\n${glossary.style}\n`;
      }
      if (glossary.keywords) {
        consistencyPrompt += `* Quy ước Thuật ngữ đặc biệt:\n${glossary.keywords}\n`;
      }
      consistencyPrompt += `========================================================\n`;
    }

    // 2. Incorporate Context from Previous Page
    const prevPage = pages.find(p => p.pageNumber === pageToProcess.pageNumber - 1);
    if (prevPage && prevPage.novelText && prevPage.status === 'completed') {
      consistencyPrompt += `\n\n=== BỐI CẢNH & TIỂU THUYẾT TRANG TRƯỚC ĐÓ (Dùng để viết tiếp mạch truyện) ===\n`;
      consistencyPrompt += `Nội dung tiểu thuyết của trang ${prevPage.pageNumber} trước đó:\n"""\n${prevPage.novelText}\n"""\n`;
      consistencyPrompt += `Yêu cầu: Hãy viết tiếp trang ${pageToProcess.pageNumber} này sao cho tiếp nối hoàn hảo về đại từ xưng hô, văn phong và diễn biến câu chuyện từ trang ${prevPage.pageNumber} trước đó.\n`;
      consistencyPrompt += `========================================================\n`;
    }

    if (consistencyPrompt) {
      finalPrompt = `${finalPrompt}\n${consistencyPrompt}`;
    }

    // Update status in state and IndexedDB
    const updatedFields = { 
      status: 'processing', 
      logs: retryCount > 0 
        ? `Tự động chuyển đổi thử lại lần ${retryCount} bằng API (${activeConfig.name || activeConfig.model})...`
        : `Đang xử lý bằng AI (${activeConfig.name || activeConfig.model})...` 
    };
    await updatePage(pageToProcess.id, updatedFields);
    
    setPages(prev => prev.map(p => p.id === pageToProcess.id ? { ...p, ...updatedFields } : p));
    if (activePage && activePage.id === pageToProcess.id) {
      setActivePage(prev => ({ ...prev, ...updatedFields }));
      if (retryCount === 0) setActiveLogs([]);
    }

    try {
      if (activePage?.id === pageToProcess.id) {
        if (retryCount > 0) {
          addLog(`🔄 Tự động tạo lại: Khởi chạy lần thử thứ ${retryCount} bằng API key khác...`);
        }
        addLog('Đang tải và chuẩn bị hình ảnh trang truyện...');
        if (prevPage && prevPage.novelText && prevPage.status === 'completed') {
          addLog(`Kế thừa bối cảnh thành công từ trang ${prevPage.pageNumber}...`);
        }
        if (glossary.pronouns || glossary.style || glossary.keywords) {
          addLog('Áp dụng bảng quy ước dịch để thống nhất xưng hô và thuật ngữ...');
        }
      }
      
      const { base64, mimeType } = await fetchImageAsBase64(pageToProcess.imageSrc, pageToProcess.imageType);
      
      if (activePage?.id === pageToProcess.id) {
        addLog(`Đang gửi dữ liệu hình ảnh tới AI Service (${activeConfig.name || activeConfig.model})...`);
        addLog('AI đang phân tích các khung truyện, lời thoại và bối cảnh (quá trình này mất khoảng 5-15 giây)...');
      }

      const novelResult = await convertMangaPageToNovel({
        base64Data: base64,
        mimeType,
        apiKey,
        model,
        customPrompt: finalPrompt,
        config: activeConfig
      });

      // Filter check for content filtering refusals
      const refusalPatterns = [
        "Tôi không thể hỗ trợ yêu cầu này",
        "Tôi từ chối tạo nội dung tiểu thuyết hoặc mô tả mang tính khiêu dâm"
      ];
      const isRefusal = refusalPatterns.some(pattern => 
        novelResult.toLowerCase().includes(pattern.toLowerCase())
      );

      if (isRefusal) {
        console.warn(`[Content Refusal In Page ${pageToProcess.pageNumber}] Detected safety filter refusal.`);
        
        let poolConfigs = [];
        if (typeof window !== 'undefined') {
          try {
            const savedConfigs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
            const poolIds = useApiPool ? selectedPoolConfigIds : [];
            poolConfigs = savedConfigs.filter(c => poolIds.includes(c.id));
          } catch (e) {}
        }
        
        const nextAttempted = [...attemptedConfigIds, activeConfig.id];
        const altConfig = poolConfigs.find(c => !nextAttempted.includes(c.id));

        if (altConfig && retryCount < 3) {
          if (activePage?.id === pageToProcess.id) {
            addLog(`⚠️ AI từ chối tạo nội dung (kiểm duyệt hình ảnh/nội dung nhạy cảm)`);
            addLog(`🔄 Tự động chuyển đổi: Phát hiện từ chối, chuyển sang API khác (${altConfig.name || altConfig.model}) để tạo lại...`);
          }
          return await convertSinglePage(pageToProcess, customPromptOverride, altConfig, retryCount + 1, nextAttempted);
        } else {
          throw new Error('AI từ chối hỗ trợ yêu cầu này (kiểm duyệt hình ảnh/nội dung nhạy cảm) và không còn cấu hình API Key dự phòng nào khác trong Pool để thử lại.');
        }
      }

      if (activePage?.id === pageToProcess.id) addLog('Hoàn thành! Đang ghi nhận kết quả tiểu thuyết...');

      const successFields = { 
        status: 'completed', 
        novelText: novelResult.normalize('NFC'),
        logs: 'Hoàn thành lúc ' + new Date().toLocaleTimeString('vi-VN')
      };
      
      await updatePage(pageToProcess.id, successFields);
      
      setPages(prev => prev.map(p => p.id === pageToProcess.id ? { ...p, ...successFields } : p));
      if (activePage && activePage.id === pageToProcess.id) {
        setActivePage(prev => ({ ...prev, ...successFields }));
      }
      return true;
    } catch (err) {
      console.error('AI conversion error:', err);
      if (activePage?.id === pageToProcess.id) addLog(`Lỗi xử lý: ${err.message}`);
      
      const errorFields = { 
        status: 'failed', 
        logs: `Lỗi: ${err.message}` 
      };
      
      await updatePage(pageToProcess.id, errorFields);
      setPages(prev => prev.map(p => p.id === pageToProcess.id ? { ...p, ...errorFields } : p));
      if (activePage && activePage.id === pageToProcess.id) {
        setActivePage(prev => ({ ...prev, ...errorFields }));
      }
      return false;
    }
  };

  // Refine single page based on user instructions
  const handleRefine = async () => {
    if (!refineInstructions.trim()) return;
    
    const instruction = refineInstructions.trim();
    setRefineInstructions('');
    
    const refinePrompt = `Bạn là một nhà văn xuất sắc chuyên chuyển đổi truyện tranh thành tiểu thuyết chữ tiếng Việt. 
Dưới đây là một trang truyện và phần tiểu thuyết chữ ĐÃ ĐƯỢC TẠO RA TRƯỚC ĐÓ.

Nội dung tiểu thuyết hiện tại:
"""
${activePage.novelText}
"""

YÊU CẦU ĐIỀU CHỈNH CỦA NGƯỜI DÙNG:
"${instruction}"

Hãy phân tích lại hình ảnh trang truyện này cùng với yêu cầu điều chỉnh của người dùng để viết lại đoạn tiểu thuyết trên một cách xuất sắc hơn.
Lưu ý:
1. Thực hiện đúng và đầy đủ theo yêu cầu điều chỉnh của người dùng (ví dụ: mô tả chi tiết hơn, thay đổi ngôi kể, làm sâu sắc thêm nội tâm nhân vật...).
2. Vẫn phải tuân thủ việc giữ nguyên 100% lời thoại gốc không được thiếu sót.
3. Chỉ trả về phần tiểu thuyết được viết lại một cách trọn vẹn nhất. Không thêm lời mở đầu hay giải thích gì khác.`;

    await convertSinglePage(activePage, refinePrompt);
  };

  // Trigger Bulk Option Choice — always show modal for concurrency config
  const handleStartBulkClick = () => {
    if (typeof window !== 'undefined') {
      try {
        const savedConfigs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
        setAvailableConfigs(savedConfigs);
        
        // Auto-select the active config if selectedPoolConfigIds is empty
        const activeId = localStorage.getItem('manga2novel_active_config_id') || '';
        let currentPool = [];
        try {
          currentPool = JSON.parse(localStorage.getItem('manga2novel_pool_config_ids') || '[]');
        } catch (e) {}
        
        const availableIds = savedConfigs.map(c => c.id);
        const normalizedPool = Array.isArray(currentPool)
          ? currentPool.filter(id => availableIds.includes(id))
          : [];

        const preferredPool = normalizedPool.length > 0
          ? normalizedPool.slice(0, MAX_POOL_KEYS)
          : (() => {
              const preferred = [];
              if (activeId && availableIds.includes(activeId)) preferred.push(activeId);
              for (const config of savedConfigs) {
                if (preferred.length >= MAX_POOL_KEYS) break;
                if (!preferred.includes(config.id)) preferred.push(config.id);
              }
              return preferred.slice(0, MAX_POOL_KEYS);
            })();

        if (preferredPool.length > 0) {
          setSelectedPoolConfigIds(preferredPool);
          localStorage.setItem('manga2novel_pool_config_ids', JSON.stringify(preferredPool));
        } else {
          setSelectedPoolConfigIds([]);
          localStorage.setItem('manga2novel_pool_config_ids', JSON.stringify([]));
        }
      } catch (e) {
        console.error('Failed to load configs for pool:', e);
      }
    }
    setShowBulkOptionModal(true);
  };

  // Bulk processing logic — now with PARALLEL batch & API Key Pooling support
  const executeBulkProcessing = async (shouldResetAll) => {
    if (isBulkRunning) return;

    let targetPages = [];

    if (shouldResetAll) {
      // Reset all page statuses
      for (const p of pages) {
        await updatePage(p.id, { status: 'pending', novelText: '' });
      }
      const resetPages = pages.map(p => ({ ...p, status: 'pending', novelText: '' }));
      setPages(resetPages);
      if (activePage) {
        setActivePage(resetPages.find(p => p.id === activePage.id));
      }
      targetPages = [...resetPages];
    } else {
      targetPages = pages.filter(p => p.status === 'pending' || p.status === 'failed');
    }

    if (targetPages.length === 0) {
      alert('Không có trang nào cần dịch.');
      return;
    }

    setIsBulkRunning(true);
    bulkStopRef.current = false;
    setBulkProgress({ current: 0, total: targetPages.length });

    // Auto-focus on the first page being processed
    const firstActive = pages.find(p => p.id === targetPages[0].id);
    if (firstActive) setActivePage(firstActive);

    // Save starting completed state for progress calculations
    const completedAtStart = pages.filter(p => p.status === 'completed' || p.status === 'failed').length;

    // Load selected configs for API pooling
    let poolConfigs = [];
    if (useApiPool && selectedPoolConfigIds.length > 0) {
      if (typeof window !== 'undefined') {
        try {
          const savedConfigs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
          poolConfigs = savedConfigs.filter(c => selectedPoolConfigIds.includes(c.id));
        } catch (e) {
          console.error('Failed to parse pool configs:', e);
        }
      }
    }

    // Function to fetch database and update both local pages state & bulk progress bar
    const syncProgressAndDb = async () => {
      const freshPages = await getPagesForProject(projectId);
      const normalizedPages = freshPages.map(p => ({
        ...p,
        novelText: (p.novelText || '').normalize('NFC')
      }));
      setPages(normalizedPages);
      
      const currentCompleted = normalizedPages.filter(p => p.status === 'completed' || p.status === 'failed').length;
      const newlyCompleted = Math.max(0, currentCompleted - completedAtStart);
      setBulkProgress(prev => ({ ...prev, current: Math.min(newlyCompleted, targetPages.length) }));
    };

    try {
      if (poolConfigs.length > 1) {
        poolConfigs = poolConfigs.slice(0, MAX_POOL_KEYS);
        // Batch mode: process up to 10 pages in parallel, then move to the next batch.
        const batchSize = Math.min(MAX_POOL_KEYS, poolConfigs.length);

        for (let batchStart = 0; batchStart < targetPages.length; batchStart += batchSize) {
          if (bulkStopRef.current) break;

          const batch = targetPages.slice(batchStart, batchStart + batchSize);
          const batchPromises = batch.map((page, index) => {
            const config = poolConfigs[index % poolConfigs.length];
            return convertSinglePage(page, '', config);
          });

          await Promise.allSettled(batchPromises);
          await syncProgressAndDb();
        }
      } else {
        // Normal single key mode (either 1 key in pool or pool disabled)
        const config = poolConfigs[0] || null; // fallback to active config in convertSinglePage if null
        
        for (let batchStart = 0; batchStart < targetPages.length; batchStart += concurrency) {
          if (bulkStopRef.current) break;

          const batch = targetPages.slice(batchStart, batchStart + concurrency);
          const promises = batch.map(page => convertSinglePage(page, '', config));
          await Promise.allSettled(promises);
          
          await syncProgressAndDb();
        }
      }
    } catch (err) {
      console.error('Bulk processing critical error:', err);
    } finally {
      setIsBulkRunning(false);
      // Refresh project details to update main header
      const proj = await getProject(projectId);
      if (proj?.title) proj.title = proj.title.normalize('NFC');
      setProject(proj);
    }
  };

  const stopBulkProcessing = () => {
    bulkStopRef.current = true;
    setIsBulkRunning(false);
  };

  const handlePageClick = (page) => {
    if (selectionMode) {
      handleTogglePageSelection(page.id);
      return;
    }
    setActivePage(page);
    setActiveLogs([]);
    setScale(1); // Reset zoom
  };

  // Nav helpers
  const goNextPage = () => {
    const currentIndex = pages.findIndex(p => p.id === activePage.id);
    if (currentIndex < pages.length - 1) {
      handlePageClick(pages[currentIndex + 1]);
    }
  };

  const goPrevPage = () => {
    const currentIndex = pages.findIndex(p => p.id === activePage.id);
    if (currentIndex > 0) {
      handlePageClick(pages[currentIndex - 1]);
    }
  };

  const toggleSmartReadMode = () => {
    setSmartReadMode(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(SMART_READ_MODE_KEY, String(next));
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <Loader2 size={48} className="animate-spin" color="#8b5cf6" />
        <p style={{ marginTop: '20px', fontSize: '16px', fontWeight: '600' }}>
          Đang chuẩn bị không gian làm việc AI Studio...
        </p>
      </div>
    );
  }

  const completedPagesCount = pages.filter(p => p.status === 'completed').length;
  const currentPageIndex = activePage ? pages.findIndex(p => p.id === activePage.id) : -1;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {!smartReadMode && <Header projectTitle={project?.title} showBack={true} />}

      {smartReadMode && (
        <button
          type="button"
          className={styles.smartModeExitBtn}
          onClick={toggleSmartReadMode}
          title="Thoát chế độ đọc thông minh"
        >
          <ArrowLeft size={14} />
          Thoát chế độ đọc
        </button>
      )}

      {smartReadMode && (
        <>
          <button
            type="button"
            className={styles.smartModeNavBtn}
            onClick={goPrevPage}
            disabled={currentPageIndex <= 0}
            title="Trang truyện trước đó"
          >
            <ChevronLeft size={16} />
            Trước
          </button>
          <button
            type="button"
            className={styles.smartModeNavBtn}
            onClick={goNextPage}
            disabled={currentPageIndex < 0 || currentPageIndex >= pages.length - 1}
            title="Trang truyện kế tiếp"
          >
            Tiếp
            <ChevronRight size={16} />
          </button>
        </>
      )}

      {/* Option Modal for Bulk translation */}
      {!smartReadMode && showBulkOptionModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.optionModal} className="glass-panel">
            <Sparkles size={32} color="#b39265" style={{ marginBottom: '12px' }} />
            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-primary)' }}>
              Lựa Chọn Dịch Cả Tập Truyện
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
              Bạn đã có một số trang được dịch trước đó. Hãy chọn phương thức xử lý tối ưu nhất cho tập truyện này để đảm bảo độ đồng nhất văn phong và xưng hô.
            </p>

            {/* Concurrency selector */}
            <div style={{ 
              width: '100%', marginBottom: '20px', padding: '14px 16px', 
              background: 'rgba(179, 146, 101, 0.04)', border: '1px solid rgba(179, 146, 101, 0.15)',
              borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  ⚡ Số trang dịch song song
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {concurrency === 1 ? 'Tuần tự — chậm nhưng bối cảnh liền mạch nhất' : 
                   concurrency <= 3 ? `${concurrency} trang/lần — cân bằng tốc độ & chất lượng` :
                   concurrency <= 5 ? `${concurrency} trang/lần — nhanh, phù hợp API trả phí` :
                   `${concurrency} trang/lần — tối đa tốc độ, cần API rate limit cao`}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {[1, 2, 3, 5, 10].map(n => (
                  <button
                    key={n}
                    onClick={() => {
                      setConcurrency(n);
                      localStorage.setItem('manga2novel_concurrency', String(n));
                    }}
                    style={{
                      width: '32px', height: '32px', borderRadius: '6px',
                      border: concurrency === n ? '2px solid var(--accent-gold)' : '1px solid var(--border-light)',
                      background: concurrency === n ? 'rgba(179, 146, 101, 0.15)' : 'transparent',
                      color: concurrency === n ? 'var(--accent-gold)' : 'var(--text-secondary)',
                      fontWeight: concurrency === n ? '700' : '400',
                      fontSize: '14px', cursor: 'pointer',
                      fontFamily: 'var(--font-ui)',
                      transition: 'all 0.2s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* API Pooling & Load Balancing selector */}
            <div style={{
              width: '100%', marginBottom: '20px', padding: '16px',
              background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🚀 Kích hoạt Nhóm API (API Key Pooling)
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Chia đều số trang truyện cho nhiều API Key để tăng tốc độ dịch tối đa
                  </span>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px' }}>
                  <input
                    type="checkbox"
                    checked={useApiPool}
                    onChange={(e) => {
                      setUseApiPool(e.target.checked);
                      localStorage.setItem('manga2novel_use_api_pool', String(e.target.checked));
                    }}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: useApiPool ? 'var(--accent-gold)' : 'rgba(255, 255, 255, 0.1)',
                    transition: '.3s', borderRadius: '20px',
                    display: 'flex', alignItems: 'center', justifyContent: useApiPool ? 'flex-end' : 'flex-start',
                    padding: '2px'
                  }}>
                    <span style={{
                      height: '16px', width: '16px', borderRadius: '50%',
                      backgroundColor: '#fff', display: 'block', transition: '.3s'
                    }} />
                  </span>
                </label>
              </div>

              {useApiPool && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '8px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '10px'
                }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Chọn các API Key tham gia Pool:
                  </span>
                  {availableConfigs.length === 0 ? (
                    <div style={{ padding: '8px', fontSize: '12px', color: '#ef4444', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                      Không tìm thấy cấu hình API Key nào khác. Vui lòng vào <strong>Cài đặt</strong> để thêm API Key!
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', paddingRight: '4px' }}>
                      {availableConfigs.map((config) => {
                        const isChecked = selectedPoolConfigIds.includes(config.id);
                        return (
                          <div
                            key={config.id}
                            onClick={() => {
                              let updated = [];
                              if (isChecked) {
                                if (selectedPoolConfigIds.length > 1) {
                                  updated = selectedPoolConfigIds.filter(id => id !== config.id);
                                } else {
                                  updated = [...selectedPoolConfigIds];
                                }
                              } else {
                                updated = [...selectedPoolConfigIds, config.id];
                              }
                              setSelectedPoolConfigIds(updated);
                              localStorage.setItem('manga2novel_pool_config_ids', JSON.stringify(updated));
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', justifyItems: 'center', gap: '10px',
                              padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                              background: isChecked ? 'rgba(179, 146, 101, 0.06)' : 'rgba(255, 255, 255, 0.01)',
                              border: isChecked ? '1px solid rgba(179, 146, 101, 0.25)' : '1px solid rgba(255, 255, 255, 0.03)',
                              transition: 'all 0.15s'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                              style={{ accentColor: 'var(--accent-gold)', cursor: 'pointer' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '2px' }}>
                              <span style={{ fontSize: '12px', fontWeight: '600', color: isChecked ? 'var(--accent-gold)' : 'var(--text-primary)' }}>
                                {config.name}
                              </span>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                <span style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '0px 4px', borderRadius: '3px' }}>
                                  {config.provider.toUpperCase()}
                                </span>
                                <span>{config.model}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedPoolConfigIds.length > 0 && (
                    <div style={{
                      marginTop: '4px', padding: '10px', borderRadius: '6px',
                      background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)',
                      fontSize: '11px', color: '#10b981', display: 'flex', flexDirection: 'column', gap: '4px'
                    }}>
                      <span style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ⚡ KHẢ NĂNG XỬ LÝ TỔNG HỢP:
                      </span>
                      <span>
                        • Số API key tham gia batch: <strong>{Math.min(MAX_POOL_KEYS, selectedPoolConfigIds.length)} Keys</strong><br />
                        • Số trang xử lý song song trong mỗi lô: <strong>{Math.min(MAX_POOL_KEYS, selectedPoolConfigIds.length)} trang</strong><br />
                        • <strong>Tổng cộng: {Math.min(MAX_POOL_KEYS, selectedPoolConfigIds.length)} trang được dịch cùng lúc, sau đó chuyển sang lô kế tiếp!</strong>
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: '10px', marginTop: '2px', fontStyle: 'italic' }}>
                        * Lưu ý: Mỗi lô chỉ dùng tối đa 10 key/10 ảnh, rồi mới chạy lô tiếp theo.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', marginBottom: '24px' }}>
              <button 
                className="btn-primary" 
                onClick={() => {
                  setShowBulkOptionModal(false);
                  executeBulkProcessing(true); // Reset and translate all
                }}
                style={{ padding: '14px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'var(--accent-gold)', borderColor: 'var(--accent-gold)' }}
              >
                <div style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
                  <RefreshCw size={14} />
                  Dịch lại toàn bộ tập truyện từ đầu
                </div>
                <span style={{ fontSize: '11px', opacity: 0.9, fontWeight: 'normal', color: '#f5f5f7' }}>
                  (Khuyến nghị: Giúp AI đồng bộ bối cảnh và xưng hô từ trang 1 đến hết)
                </span>
              </button>

              <button 
                className="btn-secondary" 
                onClick={() => {
                  setShowBulkOptionModal(false);
                  executeBulkProcessing(false); // Only translate pending/failed
                }}
                style={{ padding: '14px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', border: '1px solid var(--border-light)' }}
              >
                <div style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                  <Play size={14} />
                  Chỉ dịch tiếp các trang chưa xử lý
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
                  (Tiết kiệm thời gian & chi phí API token)
                </span>
              </button>
            </div>

            <button 
              className="btn-secondary"
              onClick={() => setShowBulkOptionModal(false)}
              style={{ padding: '8px 16px', fontSize: '13px', width: '100%', border: 'none', background: 'transparent', color: 'var(--text-secondary)' }}
            >
              Hủy bỏ
            </button>
          </div>
        </div>
      )}

      {/* Bulk action state notification */}
      {!smartReadMode && isBulkRunning && (
        <div className={styles.bulkBanner}>
          <div className={styles.bulkInfo}>
            <span className={styles.bulkTitle}>🤖 AI Đang Tự Động Chuyển Đổi Hàng Loạt {concurrency > 1 ? `(${concurrency} trang song song)` : ''}</span>
            <div style={styles.bulkProgressBarBg} aria-label={`Đã xử lý ${bulkProgress.current} trên ${bulkProgress.total} trang`}>
              <div 
                style={{
                  ...styles.bulkProgressBarFill,
                  width: `${bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0}%`
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button 
              className="btn-danger" 
              onClick={stopBulkProcessing}
              style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '8px' }}
            >
              <Pause size={14} />
              Tạm dừng
            </button>
          </div>
        </div>
      )}

      <main className={`${styles.studioLayout} ${smartReadMode ? styles.studioLayoutSmart : ''}`}>
        {/* Left Sidebar: Pages Queue & Glossary Tabs */}
        {!smartReadMode && (
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>
              AI Studio
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {selectionMode ? (
                <>
                  <button
                    className="btn-secondary"
                    onClick={handleSelectAllPages}
                    style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '6px' }}
                  >
                    Chọn tất cả
                  </button>
                  <button
                    className="btn-danger"
                    onClick={handleBulkDeleteSelectedPages}
                    disabled={selectedPageIds.length === 0}
                    style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '6px', opacity: selectedPageIds.length === 0 ? 0.6 : 1 }}
                  >
                    Xóa {selectedPageIds.length > 0 ? `(${selectedPageIds.length})` : ''}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setSelectionMode(false);
                      handleClearSelection();
                    }}
                    style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '6px' }}
                  >
                    Hủy
                  </button>
                </>
              ) : (
                <button
                  className="btn-secondary"
                  onClick={() => setSelectionMode(true)}
                  style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '6px' }}
                  title="Chọn nhiều khung hình để xóa"
                >
                  Chọn nhiều
                </button>
              )}
              {!isBulkRunning && (
                <button 
                  className="btn-primary" 
                  onClick={handleStartBulkClick}
                  style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px', gap: '6px', display: 'flex', alignItems: 'center', background: 'var(--accent-gold)', borderColor: 'var(--accent-gold)', color: '#fff' }}
                  title="Dịch tự động cả tập truyện"
                >
                  <Sparkles size={11} />
                  Dịch cả tập
                </button>
              )}
            </div>
          </div>

          {selectionMode && (
            <div style={{
              margin: '0 16px 8px',
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'rgba(179, 146, 101, 0.08)',
              border: '1px solid rgba(179, 146, 101, 0.18)',
              fontSize: '11px',
              color: 'var(--text-primary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>Đang chọn nhiều khung hình: {selectedPageIds.length} / {pages.length}</span>
              <button
                className="btn-secondary"
                onClick={handleClearSelection}
                style={{ padding: '4px 8px', fontSize: '10px', borderRadius: '4px' }}
              >
                Bỏ chọn
              </button>
            </div>
          )}

          <div className={styles.sidebarTabs}>
            <button 
              className={`${styles.sidebarTab} ${sidebarTab === 'pages' ? styles.sidebarTabActive : ''}`}
              onClick={() => setSidebarTab('pages')}
            >
              <BookOpen size={13} />
              Trang truyện ({pages.length})
            </button>
            <button 
              className={`${styles.sidebarTab} ${sidebarTab === 'glossary' ? styles.sidebarTabActive : ''}`}
              onClick={() => setSidebarTab('glossary')}
            >
              <Sparkles size={13} />
              Quy ước dịch
            </button>
          </div>

          {sidebarTab === 'pages' ? (
            <div className={styles.pagesList}>
              {pages.map((page, idx) => (
                <div 
                  key={page.id}
                  className={`${styles.pageItem} ${activePage?.id === page.id ? styles.pageItemActive : ''} ${selectedPageIds.includes(page.id) ? styles.pageItemSelected : ''}`}
                  onClick={() => handlePageClick(page)}
                >
                  {selectionMode && (
                    <button
                      type="button"
                      className={styles.pageSelectBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePageSelection(page.id);
                      }}
                      aria-label={selectedPageIds.includes(page.id) ? 'Bỏ chọn khung hình' : 'Chọn khung hình'}
                    >
                      {selectedPageIds.includes(page.id) ? <Check size={12} /> : null}
                    </button>
                  )}
                  <div className={styles.thumbContainer}>
                    {/* Render proxied image so browser CORS is bypassed */}
                    <img 
                      src={getProxyImageUrl(page.imageSrc, page.imageType)} 
                      alt={`Trang ${page.pageNumber}`}
                      className={styles.thumbImg}
                      loading="lazy"
                    />
                    <span className={styles.thumbIndex}>{page.pageNumber}</span>
                  </div>
                  <div className={styles.pageDetails}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <span className={styles.pageLabel}>Trang {page.pageNumber}</span>
                      <button
                        onClick={(e) => handleDeletePage(page.id, e)}
                        className={styles.deletePageBtn}
                        title="Xóa trang này"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <span 
                      className={`badge badge-${page.status}`}
                      style={{ fontSize: '10px', padding: '2px 6px', alignSelf: 'flex-start' }}
                    >
                      {page.status === 'pending' && 'Chờ xử lý'}
                      {page.status === 'processing' && 'Đang chạy...'}
                      {page.status === 'completed' && 'Đã xong'}
                      {page.status === 'failed' && 'Lỗi'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.glossaryPanel}>

              {/* === AI ACTIONS === */}
              <div className={styles.glossaryField} style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(59,130,246,0.08))', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '10px', padding: '12px' }}>
                <label className={styles.glossaryLabel} style={{ color: '#a78bfa', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={13} /> Hành động AI
                </label>

                {/* Button: Analyze Characters */}
                <button
                  id="btn-analyze-characters"
                  onClick={async () => {
                    setIsAnalyzingChars(true);
                    setAnalyzeResult(null);
                    try {
                      const result = await analyzeCharacters(projectId);
                      setAnalyzeResult({ type: 'success', msg: `Đã phân tích xong ${result.pagesAnalyzed} trang, tìm thấy ${result.characters?.length || 0} nhân vật.` });
                      // Reload project to get updated glossary
                      const updatedProject = await getProject(projectId);
                      setProject(updatedProject);
                    } catch (err) {
                      setAnalyzeResult({ type: 'error', msg: err.message });
                    } finally {
                      setIsAnalyzingChars(false);
                    }
                  }}
                  disabled={isAnalyzingChars || isRefining}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: '7px', border: 'none',
                    background: isAnalyzingChars ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    color: '#fff', fontWeight: '600', fontSize: '12px', cursor: isAnalyzingChars ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px'
                  }}
                >
                  {isAnalyzingChars ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Đang phân tích...</> : <><Sparkles size={13} /> 🔍 Phân tích Nhân vật tự động</>}
                </button>

                {/* Button: Refine Honorifics */}
                <button
                  id="btn-refine-honorifics"
                  onClick={async () => {
                    const completedCount = pages.filter(p => p.status === 'completed').length;
                    if (!window.confirm(`Sẽ viết lại xưng hô cho ${completedCount} trang đã dịch.\nQuá trình này sẽ gọi AI ${completedCount} lần và mất vài phút.\n\nTiếp tục?`)) return;
                    setIsRefining(true);
                    setRefineResult(null);
                    try {
                      const result = await refineHonorifics(projectId);
                      setRefineResult({ type: 'success', msg: `Hoàn tất! ${result.pagesProcessed}/${result.totalPages} trang được chỉnh sửa (${result.keysUsed} key song song).` });
                      // Reload pages to reflect updated novel_text
                      const updatedPages = await getPagesForProject(projectId);
                      setPages(updatedPages.map(p => ({ ...p, novelText: (p.novelText || '').normalize('NFC') })));
                      if (activePage) {
                        const updated = updatedPages.find(p => p.id === activePage.id);
                        if (updated) setActivePage({ ...updated, novelText: (updated.novelText || '').normalize('NFC') });
                      }
                    } catch (err) {
                      setRefineResult({ type: 'error', msg: err.message });
                    } finally {
                      setIsRefining(false);
                    }
                  }}
                  disabled={isAnalyzingChars || isRefining}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: '7px', border: 'none',
                    background: isRefining ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #1d4ed8, #1e40af)',
                    color: '#fff', fontWeight: '600', fontSize: '12px', cursor: isRefining ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}
                >
                  {isRefining ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Đang chỉnh sửa...</> : <><RefreshCw size={13} /> ✏️ Chỉnh sửa Xưng hô toàn tập</>}
                </button>

                {/* Result feedback */}
                {analyzeResult && (
                  <div style={{ marginTop: '8px', padding: '7px 10px', borderRadius: '6px', fontSize: '11px', background: analyzeResult.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: analyzeResult.type === 'success' ? '#86efac' : '#fca5a5', border: `1px solid ${analyzeResult.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                    {analyzeResult.type === 'success' ? '✅ ' : '❌ '}{analyzeResult.msg}
                  </div>
                )}
                {refineResult && (
                  <div style={{ marginTop: '6px', padding: '7px 10px', borderRadius: '6px', fontSize: '11px', background: refineResult.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: refineResult.type === 'success' ? '#86efac' : '#fca5a5', border: `1px solid ${refineResult.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                    {refineResult.type === 'success' ? '✅ ' : '❌ '}{refineResult.msg}
                  </div>
                )}
              </div>

              {/* === MANUAL GLOSSARY FIELDS === */}
              <div className={styles.glossaryField}>
                <label className={styles.glossaryLabel}>Xưng hô &amp; Nhân vật</label>
                <textarea
                  className={styles.glossaryTextarea}
                  placeholder={"Ví dụ:\nNaruto (cậu/tôi) - Sasuke (cậu/tớ)\nGọi nữ phụ là cô ta"}
                  value={project?.glossary?.pronouns || ''}
                  onChange={(e) => handleGlossaryChange('pronouns', e.target.value)}
                />
              </div>
              
              <div className={styles.glossaryField}>
                <label className={styles.glossaryLabel}>Văn phong chung</label>
                <textarea
                  className={styles.glossaryTextarea}
                  placeholder={"Ví dụ:\nVăn phong kiếm hiệp, nghiêm túc, tả cảnh chi tiết, giữ tông trầm ấm"}
                  value={project?.glossary?.style || ''}
                  onChange={(e) => handleGlossaryChange('style', e.target.value)}
                />
              </div>
              
              <div className={styles.glossaryField}>
                <label className={styles.glossaryLabel}>Thuật ngữ đặc biệt</label>
                <textarea
                  className={styles.glossaryTextarea}
                  placeholder={"Ví dụ:\nChakra -> Luân xa\nMana -> Ma lực"}
                  value={project?.glossary?.keywords || ''}
                  onChange={(e) => handleGlossaryChange('keywords', e.target.value)}
                />
              </div>
            </div>
          )}
        </aside>
        )}

        {/* Center Workspace */}
        <section className={styles.workspace}>
          {/* Left panel: Manga page viewer */}
          <div className={styles.imagePanel}>
            {!smartReadMode && (
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>
                <BookOpen size={16} color="#8b5cf6" />
                Manga Gốc - Trang {activePage?.pageNumber}
              </span>
              <div className={styles.zoomControls}>
                <button 
                  className={styles.zoomBtn} 
                  onClick={() => setScale(prev => Math.max(0.5, prev - 0.25))}
                  title="Thu nhỏ"
                >
                  <ZoomOut size={16} />
                </button>
                <span style={{ display: 'flex', alignItems: 'center', fontSize: '12px', padding: '0 4px', color: '#9ca3af', minWidth: '40px', justifyContent: 'center' }}>
                  {Math.round(scale * 100)}%
                </span>
                <button 
                  className={styles.zoomBtn} 
                  onClick={() => setScale(prev => Math.min(3, prev + 0.25))}
                  title="Phóng to"
                >
                  <ZoomIn size={16} />
                </button>
                <button 
                  className={styles.zoomBtn} 
                  onClick={() => setScale(1)}
                  title="Khôi phục"
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            </div>
            )}

            <div className={styles.imageViewport}>
              {activePage && (
                <img 
                  src={getProxyImageUrl(activePage.imageSrc, activePage.imageType)} 
                  alt={`Trang ${activePage.pageNumber}`}
                  className={styles.mangaImage}
                  style={{ transform: `scale(${scale})` }}
                />
              )}
            </div>

            {/* Quick Page Nav arrows overlay */}
            {!smartReadMode && (
            <div style={styles.navOverlay}>
              <button 
                onClick={goPrevPage} 
                disabled={pages.findIndex(p => p.id === activePage?.id) === 0}
                style={styles.navArrow}
              >
                <ChevronLeft size={24} />
              </button>
              <button 
                onClick={goNextPage} 
                disabled={pages.findIndex(p => p.id === activePage?.id) === pages.length - 1}
                style={styles.navArrow}
              >
                <ChevronRight size={24} />
              </button>
            </div>
            )}
          </div>

          {/* Right panel: Novel Text Editor */}
          <div className={styles.editorPanel}>
            {!smartReadMode && (
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>
                <FileText size={16} color="#d946ef" />
                Tiểu Thuyết Phác Thảo
              </span>
              {activePage?.status === 'completed' && (
                <button 
                  className="btn-secondary"
                  onClick={() => router.push(`/reader?id=${projectId}`)}
                  style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px' }}
                >
                  Đọc toàn bộ ({completedPagesCount}/{pages.length})
                </button>
              )}
              <button
                className="btn-secondary"
                onClick={toggleSmartReadMode}
                style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', marginLeft: '8px' }}
                title="Ẩn giao diện để chỉ còn nội dung đọc"
              >
                Chế độ đọc
              </button>
            </div>
            )}

            <div className={styles.editorContent}>
              {!activePage ? (
                <div className={styles.emptyEditor}>
                  <BookOpen size={48} strokeWidth={1} />
                  <p>Chọn một trang truyện ở cột bên trái để bắt đầu</p>
                </div>
              ) : activePage.status === 'pending' || activePage.status === 'failed' ? (
                <div style={styles.promptStudio}>
                  <div style={styles.studioCard} className="glass-panel">
                    <Sparkles size={36} color="#8b5cf6" style={{ marginBottom: '12px' }} />
                    <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>
                      {activePage.status === 'failed' ? 'Chuyển Đổi Bị Lỗi' : 'Sẵn Sàng Chuyển Đổi'}
                    </h3>
                    <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '20px', lineHeight: '1.5' }}>
                      {activePage.status === 'failed' 
                        ? 'Cuộc hội thoại AI gặp gián đoạn. Bạn hãy nhấn Thử lại bên dưới hoặc kiểm tra xem API key có chính xác không.'
                        : 'Mô hình đa phương thức Gemini AI sẽ tự động phân tích khung cảnh, biểu cảm của nhân vật trên trang truyện này và chuyển văn phong thành tiểu thuyết chữ đầy màu sắc.'}
                    </p>
                    
                    {activePage.status === 'failed' && (
                      <div style={styles.failedLog}>
                        <AlertCircle size={14} color="#ef4444" />
                        <span>{activePage.logs || 'Lỗi không xác định.'}</span>
                      </div>
                    )}

                    <button 
                      className="btn-primary" 
                      onClick={() => convertSinglePage(activePage)}
                      style={{ width: '100%', padding: '14px' }}
                    >
                      <Sparkles size={18} />
                      {activePage.status === 'failed' ? 'Thử lại ngay' : 'Phân tích & Viết Tiểu Thuyết'}
                    </button>
                  </div>
                </div>
              ) : activePage.status === 'processing' ? (
                <div className={styles.processingBox}>
                  <div className={styles.processingHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Loader2 size={20} className="animate-spin" color="#8b5cf6" />
                      <h4 style={{ fontSize: '15px', fontWeight: '700', margin: 0 }}>AI Đang Sáng Tác...</h4>
                    </div>
                    <button
                      className="btn-secondary"
                      onClick={() => convertSinglePage(activePage)}
                      style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px', gap: '4px', display: 'flex', alignItems: 'center', cursor: 'pointer', border: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(255, 255, 255, 0.03)' }}
                      title="Buộc tạo lại trang này ngay lập tức"
                    >
                      <RefreshCw size={11} />
                      Tạo lại ngay
                    </button>
                  </div>
                  <div className={styles.processingProgressWrap} aria-label={`Đang xử lý trang ${activePage.pageNumber}`}>
                    <div className={styles.processingProgressBar}>
                      <div className={styles.processingProgressFill} />
                    </div>
                  </div>
                  
                  <div className={styles.processingLogs} ref={logsEndRef}>
                    {activeLogs.map((log, idx) => (
                      <div key={idx} className={styles.logEntry}>
                        <span className={styles.logTime}>[{log.time}]</span>
                        <span>{log.message}</span>
                      </div>
                    ))}
                    {activeLogs.length === 0 && (
                      <div className={styles.logEntry}>
                        <span className={styles.logTime}>[Hệ thống]</span>
                        <span>Khởi tạo luồng xử lý...</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Completed, show editor and refinement panel */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                  <textarea
                    className={styles.novelTextarea}
                    value={activePage.novelText}
                    onChange={handleTextChange}
                    placeholder="Viết tiểu thuyết cho trang này..."
                  />

                  {!smartReadMode && (
                    <>
                      <div style={styles.savedBanner}>
                        <Check size={14} color="#10b981" />
                        <span>Tự động lưu vào IndexedDB thành công</span>
                      </div>

                      {/* Refinement instruction area */}
                      <div className={styles.refinementArea}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Sparkles size={16} color="#d946ef" />
                          <span style={{ fontSize: '13px', fontWeight: '700' }}>Yêu cầu AI viết lại (Refine)</span>
                        </div>
                        <div className={styles.refineInputGroup}>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Ví dụ: 'Mô tả cảnh đấm nhau mãnh liệt hơn', 'Viết theo ngôi thứ nhất'..."
                            value={refineInstructions}
                            onChange={(e) => setRefineInstructions(e.target.value)}
                            style={{ padding: '10px 14px', fontSize: '13px' }}
                          />
                          <button 
                            className="btn-secondary" 
                            onClick={handleRefine}
                            disabled={!refineInstructions.trim()}
                            style={{ padding: '10px 18px', fontSize: '13px' }}
                          >
                            <RefreshCw size={14} />
                            Gửi
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// Inline Styles for elements not in css modules
const stylesHelper = {
  loadingScreen: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#07050f',
    color: '#f3f4f6'
  },
  navOverlay: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    transform: 'translateY(-50%)',
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0 16px',
    pointerEvents: 'none',
    zIndex: 5
  },
  navArrow: {
    background: 'rgba(7, 5, 15, 0.7)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    color: '#fff',
    borderRadius: '50%',
    width: '44px',
    height: '44px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
    transition: 'all 0.2s',
    boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
    '&:hover': {
      background: '#8b5cf6',
      borderColor: '#d946ef'
    },
    '&:disabled': {
      opacity: 0.3,
      cursor: 'not-allowed',
      background: 'rgba(7, 5, 15, 0.3)'
    }
  },
  promptStudio: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '20px'
  },
  studioCard: {
    maxWidth: '420px',
    width: '100%',
    padding: '30px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  failedLog: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    borderRadius: '8px',
    padding: '10px 14px',
    color: '#ef4444',
    fontSize: '12px',
    textAlign: 'left',
    marginBottom: '20px',
    width: '100%'
  },
  savedBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#10b981',
    alignSelf: 'flex-end',
    background: 'rgba(16, 185, 129, 0.05)',
    border: '1px solid rgba(16, 185, 129, 0.15)',
    padding: '4px 10px',
    borderRadius: '12px'
  },
  bulkProgressBarBg: {
    width: '150px',
    height: '6px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '3px',
    overflow: 'hidden'
  },
  bulkProgressBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #8b5cf6, #d946ef)',
    transition: 'width 0.3s ease'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(5, 5, 5, 0.4)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  optionModal: {
    maxWidth: '480px',
    width: '90%',
    padding: '30px',
    background: '#ffffff',
    borderRadius: '12px',
    border: '1px solid rgba(179, 146, 101, 0.15)',
    boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    position: 'relative'
  }
};

// Map helpers to window or styles dynamically so React compilation works cleanly
Object.assign(styles, stylesHelper);

export default function Studio() {
  return (
    <Suspense fallback={
      <div style={stylesHelper.loadingScreen}>
        <Loader2 size={48} className="animate-spin" color="#8b5cf6" />
        <p style={{ marginTop: '20px', fontSize: '16px', fontWeight: '600' }}>
          Đang khởi chạy AI Studio...
        </p>
      </div>
    }>
      <StudioContent />
    </Suspense>
  );
}
