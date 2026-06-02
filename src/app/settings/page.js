'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { 
  getApiConfigs, saveApiConfigs, getStorageConfigs, saveStorageConfigs, testS3Connection 
} from '@/utils/db';
import { 
  Sparkles, Key, Plus, Trash2, Edit3, Check, AlertCircle, ArrowLeft, Loader2, Database, ShieldCheck, Server, FolderInput
} from 'lucide-react';
import { GEMINI_MODELS, DEFAULT_PROMPT, PROVIDERS } from '@/utils/gemini';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('ai'); // 'ai' | 'storage'
  const [configs, setConfigs] = useState([]);
  const [activeConfigId, setActiveConfigId] = useState('');
  
  // Editor view states for API Keys
  const [view, setView] = useState('list'); // 'list' | 'add' | 'edit'
  const [editingConfigId, setEditingConfigId] = useState('');
  
  // Form State for API Key
  const [formName, setFormName] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formError, setFormError] = useState('');

  // Global settings (Prompt)
  const [customPrompt, setCustomPrompt] = useState('');
  const [isPromptSaved, setIsPromptSaved] = useState(false);

  // S3 BYOS & Storage Form States
  const [s3Configs, setS3Configs] = useState({
    type: 'device', // 'device' | 'cloud' | 'server'
    endpoint: '',
    region: '',
    bucketName: '',
    accessKeyId: '',
    secretAccessKey: ''
  });
  const [s3Error, setS3Error] = useState('');
  const [s3Success, setS3Success] = useState('');
  const [isTestingS3, setIsTestingS3] = useState(false);
  const [isS3Saving, setIsS3Saving] = useState(false);
  const [vpsMode, setVpsMode] = useState('local'); // 'local' | 'remote'

  // Directory Picker States for Device Storage (Web File System Access API)
  const [deviceDirectoryName, setDeviceDirectoryName] = useState('');
  const [isBrowserSupportDirectoryPicker, setIsBrowserSupportDirectoryPicker] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPrompt = localStorage.getItem('manga2novel_custom_prompt');
      if (savedPrompt) {
        setCustomPrompt(savedPrompt);
      } else {
        setCustomPrompt(DEFAULT_PROMPT);
      }
      
      const savedDir = localStorage.getItem('manga2novel_device_directory_name');
      if (savedDir) setDeviceDirectoryName(savedDir);
      
      setIsBrowserSupportDirectoryPicker(!!window.showDirectoryPicker);

      loadConfigs();
      loadStorageConfigs();
    }
  }, []);

  // Load configs
  const loadConfigs = async () => {
    if (typeof window === 'undefined') return;

    let savedConfigs = [];
    let activeId = '';

    try {
      const serverResult = await getApiConfigs();
      const serverConfigs = serverResult?.configs || [];
      if (serverConfigs.length > 0) {
        savedConfigs = serverConfigs;
        activeId = serverResult.activeConfigId || '';
        localStorage.setItem('manga2novel_api_configs', JSON.stringify(serverConfigs));
        localStorage.setItem('manga2novel_active_config_id', activeId);
        localStorage.setItem('manga2novel_use_api_pool', String(serverResult.useApiPool || false));
        localStorage.setItem('manga2novel_pool_config_ids', JSON.stringify(serverResult.poolConfigIds || []));

        const activeConfig = serverConfigs.find(c => c.id === activeId);
        if (activeConfig) {
          localStorage.setItem('manga2novel_api_key', activeConfig.apiKey);
          localStorage.setItem('manga2novel_model', activeConfig.model);
        }
      }
    } catch (e) {
      console.error('Failed to load API configs from server:', e);
    }

    if (savedConfigs.length === 0) {
      try {
        savedConfigs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
        activeId = localStorage.getItem('manga2novel_active_config_id') || '';
      } catch (e) {
        savedConfigs = [];
      }
    }

    // Migration logic
    const legacyKey = localStorage.getItem('manga2novel_api_key') || '';
    if (savedConfigs.length === 0 && legacyKey) {
      const legacyModel = localStorage.getItem('manga2novel_model') || 'gemini-2.5-flash';
      const initialConfig = {
        id: 'legacy-gemini-config',
        name: 'Gemini Mặc định (Legacy)',
        provider: 'gemini',
        apiKey: legacyKey,
        model: legacyModel,
        baseUrl: 'https://generativelanguage.googleapis.com'
      };
      savedConfigs = [initialConfig];
      activeId = initialConfig.id;
      localStorage.setItem('manga2novel_api_configs', JSON.stringify(savedConfigs));
      localStorage.setItem('manga2novel_active_config_id', activeId);
    }

    setConfigs(savedConfigs);
    setActiveConfigId(activeId);
  };

  // Load user Storage configs
  const loadStorageConfigs = async () => {
    try {
      const data = await getStorageConfigs();
      if (data) {
        setS3Configs(prev => ({
          ...prev,
          ...data,
          type: data.type || 'device'
        }));
        
        // Auto-detect vpsMode based on stored endpoint
        if (data.type === 'server' && data.endpoint && (data.endpoint.startsWith('http://') || data.endpoint.startsWith('https://'))) {
          setVpsMode('remote');
        } else {
          setVpsMode('local');
        }
      }
    } catch (e) {
      console.error('Failed to load storage configs:', e);
    }
  };

  // Intelligent Provider Auto-Detection based on API Key format
  const detectProviderDetails = (key) => {
    const trimmed = key.trim();
    if (trimmed.startsWith('AIzaSy')) {
      return {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        baseUrl: 'https://generativelanguage.googleapis.com'
      };
    } else if (trimmed.startsWith('xai-')) {
      return {
        provider: 'grok',
        model: 'grok-4.3',
        baseUrl: 'https://api.x.ai/v1'
      };
    } else if (trimmed.startsWith('sk-') || trimmed.length > 20) {
      return {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1'
      };
    } else {
      return {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        baseUrl: 'https://generativelanguage.googleapis.com'
      };
    }
  };

  const handleOpenAdd = () => {
    setFormName('');
    setFormApiKey('');
    setFormError('');
    setEditingConfigId('');
    setView('add');
  };

  const handleOpenEdit = (config) => {
    setFormName(config.name);
    setFormApiKey(config.apiKey);
    setFormError('');
    setEditingConfigId(config.id);
    setView('edit');
  };

  const syncConfigsToServer = async (updatedConfigs, activeId) => {
    try {
      await saveApiConfigs(updatedConfigs, activeId, false, []);
    } catch (e) {
      console.error('Failed to sync API configs to server:', e);
    }
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Vui lòng nhập tên gợi nhớ cho cấu hình này');
      return;
    }
    if (!formApiKey.trim()) {
      setFormError('Vui lòng nhập API Key');
      return;
    }

    const detected = detectProviderDetails(formApiKey.trim());

    const newConfig = {
      id: editingConfigId || crypto.randomUUID(),
      name: formName.trim(),
      apiKey: formApiKey.trim(),
      provider: detected.provider,
      model: detected.model,
      baseUrl: detected.baseUrl
    };

    let updated = [];
    if (view === 'edit') {
      updated = configs.map(c => c.id === editingConfigId ? newConfig : c);
    } else {
      updated = [...configs, newConfig];
    }

    localStorage.setItem('manga2novel_api_configs', JSON.stringify(updated));
    setConfigs(updated);

    let nextActiveId = activeConfigId;

    if (!activeConfigId || updated.length === 1) {
      nextActiveId = newConfig.id;
      localStorage.setItem('manga2novel_active_config_id', nextActiveId);
      setActiveConfigId(nextActiveId);
      
      if (newConfig.provider === 'gemini') {
        localStorage.setItem('manga2novel_api_key', newConfig.apiKey);
        localStorage.setItem('manga2novel_model', newConfig.model);
      }
    }

    await syncConfigsToServer(updated, nextActiveId);
    setView('list');
  };

  const handleDeleteConfig = async (id, e) => {
    e.stopPropagation();
    if (confirm('Bạn có chắc chắn muốn xóa cấu hình API này?')) {
      const updated = configs.filter(c => c.id !== id);
      localStorage.setItem('manga2novel_api_configs', JSON.stringify(updated));
      setConfigs(updated);

      let nextActive = activeConfigId;
      if (activeConfigId === id) {
        nextActive = updated.length > 0 ? updated[0].id : '';
        localStorage.setItem('manga2novel_active_config_id', nextActive);
        setActiveConfigId(nextActive);
        if (nextActive && updated[0].provider === 'gemini') {
          localStorage.setItem('manga2novel_api_key', updated[0].apiKey);
          localStorage.setItem('manga2novel_model', updated[0].model);
        } else {
          localStorage.removeItem('manga2novel_api_key');
        }
      }

      await syncConfigsToServer(updated, nextActive);
    }
  };

  const handleSetActive = async (id) => {
    localStorage.setItem('manga2novel_active_config_id', id);
    setActiveConfigId(id);
    const active = configs.find(c => c.id === id);
    if (active && active.provider === 'gemini') {
      localStorage.setItem('manga2novel_api_key', active.apiKey);
      localStorage.setItem('manga2novel_model', active.model);
    }

    await syncConfigsToServer(configs, id);
  };

  const handleSavePrompt = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('manga2novel_custom_prompt', customPrompt.trim());
      setIsPromptSaved(true);
      setTimeout(() => setIsPromptSaved(false), 2000);
    }
  };

  // Storage Handlers
  const handleSaveStorageConfigs = async (e) => {
    if (e) e.preventDefault();
    setS3Error('');
    setS3Success('');
    setIsS3Saving(true);
    try {
      let configsToSave = { ...s3Configs };
      if (s3Configs.type === 'server') {
        if (vpsMode === 'local') {
          configsToSave.endpoint = '';
          configsToSave.secretAccessKey = '';
          configsToSave.region = '';
          configsToSave.bucketName = '';
          configsToSave.accessKeyId = '';
        }
      }
      const data = await saveStorageConfigs(configsToSave);
      if (data) {
        setS3Configs(prev => ({ ...prev, ...data, type: data.type || s3Configs.type }));
        setS3Success('Lưu cấu hình không gian lưu trữ thành công!');
        setTimeout(() => setS3Success(''), 3000);
      }
    } catch (err) {
      setS3Error(err.message || 'Lỗi khi lưu cấu hình');
    } finally {
      setIsS3Saving(false);
    }
  };

  const handleTestS3 = async () => {
    setS3Error('');
    setS3Success('');
    setIsTestingS3(true);
    try {
      const res = await testS3Connection(s3Configs);
      if (res) {
        setS3Success('🟢 Kết nối S3 thành công! Đã ghi và xóa tệp thử nghiệm thành công.');
      } else {
        setS3Error('Không thể kết nối đến S3. Vui lòng kiểm tra lại cấu hình.');
      }
    } catch (err) {
      setS3Error(err.message || 'Lỗi kết nối S3.');
    } finally {
      setIsTestingS3(false);
    }
  };

  // Device File System Access API Permission Request
  const handleRequestDevicePermission = async () => {
    if (typeof window === 'undefined' || !window.showDirectoryPicker) {
      alert('Trình duyệt của bạn chưa hỗ trợ File System Access API. Hệ thống sẽ tự động sử dụng IndexedDB Blobs bảo mật sẵn có trên thiết bị để lưu trữ!');
      return;
    }
    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      const opt = { mode: 'readwrite' };
      if ((await directoryHandle.queryPermission(opt)) === 'granted') {
        localStorage.setItem('manga2novel_device_directory_name', directoryHandle.name);
        setDeviceDirectoryName(directoryHandle.name);
        setS3Success(`Đã cấp quyền truy cập thành công thư mục local: "${directoryHandle.name}"!`);
        setTimeout(() => setS3Success(''), 3000);
      }
    } catch (e) {
      console.error(e);
      setS3Error('Cấp quyền truy cập thư mục thiết bị thất bại.');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />

      <main className="container" style={styles.mainContainer}>
        <div style={styles.titleSection}>
          <Link href="/" style={styles.backBtn}>
            <ArrowLeft size={16} />
            Quay lại trang chủ
          </Link>
          
          <h1 className="gradient-text" style={styles.pageTitle}>AI Studio Control Center</h1>
          <p style={styles.pageSubtitle}>
            Quản lý API Keys của mô hình AI, cấu hình Cloud Storage cá nhân và tùy biến prompt sáng tác văn học theo phong cách riêng của bạn.
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={styles.tabNav}>
          <button 
            onClick={() => setActiveTab('ai')}
            style={{
              ...styles.tabBtn,
              borderBottom: activeTab === 'ai' ? '2px solid var(--accent-gold)' : 'none',
              color: activeTab === 'ai' ? 'var(--accent-gold)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'ai' ? '700' : '400'
            }}
          >
            🤖 Cấu hình AI & Prompt
          </button>
          <button 
            onClick={() => setActiveTab('storage')}
            style={{
              ...styles.tabBtn,
              borderBottom: activeTab === 'storage' ? '2px solid var(--accent-gold)' : 'none',
              color: activeTab === 'storage' ? 'var(--accent-gold)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'storage' ? '700' : '400'
            }}
          >
            📦 Lựa chọn Lưu trữ
          </button>
        </div>

        <div style={styles.settingsLayout} className="glass-panel">
          {activeTab === 'ai' ? (
            <div style={styles.twoColumnLayout}>
              {/* Left Column: API Manager / API Form */}
              <div style={styles.leftColumn}>
                {view === 'list' ? (
                  <>
                    <div style={styles.sectionHeader}>
                      <h3 style={styles.sectionTitle}>Nhà cung cấp API</h3>
                      <button 
                        className="btn-primary" 
                        onClick={handleOpenAdd}
                        style={styles.addBtn}
                      >
                        <Plus size={14} />
                        Thêm Key mới
                      </button>
                    </div>

                    {configs.length === 0 ? (
                      <div style={styles.emptyConfigs}>
                        <AlertCircle size={32} color="#b39265" style={{ marginBottom: '10px' }} />
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Chưa có cấu hình API nào. Vui lòng thêm một nhà cung cấp mới để chạy AI.</p>
                      </div>
                    ) : (
                      <div style={styles.configList}>
                        {configs.map((config) => {
                          const isActive = config.id === activeConfigId;
                          const providerName = PROVIDERS.find(p => p.id === config.provider)?.name || config.provider;
                          return (
                            <div 
                              key={config.id} 
                              onClick={() => handleSetActive(config.id)}
                              style={{
                                ...styles.configCard,
                                borderColor: isActive ? '#b39265' : 'var(--border-light)',
                                background: isActive ? 'rgba(179, 146, 101, 0.04)' : 'rgba(255, 255, 255, 0.02)'
                              }}
                            >
                              <div style={styles.cardMain}>
                                <div style={styles.cardHeader}>
                                  <h4 style={styles.configCardTitle}>{config.name}</h4>
                                  {isActive && (
                                    <span style={styles.activeBadge}>
                                      <Check size={10} /> Đang chạy
                                    </span>
                                  )}
                                </div>
                                
                                <div style={styles.cardMeta}>
                                  <span style={styles.metaBadge}>{providerName}</span>
                                  <span style={styles.metaText}>{config.model}</span>
                                </div>
                              </div>

                              <div style={styles.cardActions}>
                                <button 
                                  style={styles.actionIconBtn}
                                  onClick={(e) => { e.stopPropagation(); handleOpenEdit(config); }}
                                  title="Chỉnh sửa"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button 
                                  style={{ ...styles.actionIconBtn, color: '#ef4444' }}
                                  onClick={(e) => handleDeleteConfig(config.id, e)}
                                  title="Xóa cấu hình"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  /* Add / Edit Form */
                  <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setView('list')}>
                      <ArrowLeft size={14} />
                      <span style={{ fontSize: '13px' }}>Quay lại danh sách</span>
                    </div>

                    <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-light)', paddingBottom: '6px' }}>
                      {view === 'add' ? 'Thêm API Key mới' : 'Chỉnh sửa cấu hình API'}
                    </h3>

                    {formError && (
                      <div style={styles.formErrorBox}>
                        <AlertCircle size={16} />
                        <span>{formError}</span>
                      </div>
                    )}

                    <div className="form-group" style={{ marginBottom: '14px' }}>
                      <label className="form-label">Tên gợi nhớ (Ví dụ: Grok 2, ChatGPT Pro...)</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Nhập tên gọi dễ nhớ..."
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        style={{ padding: '10px 14px', fontSize: '14px' }}
                        required
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: '14px' }}>
                      <label className="form-label">
                        <Key size={14} color="#b39265" /> API Key
                      </label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="Nhập API Key của bạn..."
                        value={formApiKey}
                        onChange={(e) => setFormApiKey(e.target.value)}
                        style={{ padding: '10px 14px', fontSize: '14px' }}
                        required
                      />
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                        💡 API key được mã hóa hoàn toàn trước khi lưu. Hệ thống tự động nhận diện: Bắt đầu bằng <code>AIzaSy</code> (Gemini), <code>xai-</code> (Grok), hoặc <code>sk-</code> (ChatGPT) để áp dụng endpoint.
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' }}>
                      <button type="button" className="btn-secondary" onClick={() => setView('list')} style={{ padding: '8px 16px', borderRadius: '4px', fontSize: '13px' }}>
                        Hủy
                      </button>
                      <button type="submit" className="btn-primary" style={{ padding: '8px 20px', borderRadius: '4px', fontSize: '13px' }}>
                        {view === 'add' ? 'Thêm' : 'Lưu'}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Right Column: Prompt Customizer */}
              <div style={styles.rightColumn}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    <Sparkles size={16} color="#b39265" />
                    Prompt Hệ thống (Tùy biến phong cách)
                  </label>
                </div>

                <textarea
                  className="form-textarea"
                  placeholder="Nhập phong cách viết tiểu thuyết bạn muốn..."
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  style={{ flex: 1, minHeight: '220px', fontSize: '14px', background: '#0e1117', color: 'var(--text-primary)', borderRadius: '8px', border: '1px solid var(--border-light)', padding: '14px', lineHeight: '1.6' }}
                />

                <button 
                  className="btn-primary" 
                  onClick={handleSavePrompt} 
                  style={{ width: '100%', padding: '12px 16px', fontSize: '13px', borderRadius: '8px' }}
                >
                  {isPromptSaved ? 'Đã lưu cấu hình prompt!' : 'Lưu cấu hình Prompt'}
                </button>
              </div>
            </div>
          ) : (
            /* Multi-Storage Choice Tab */
            <div style={styles.storageTabContent}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>Cấu hình Không gian Lưu trữ Dữ liệu</h3>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.6' }}>
                Lựa chọn nơi lưu trữ các trang ảnh truyện và nội dung chương tiểu thuyết đã xử lý xong. Chọn phương án phù hợp nhất với tài nguyên và mức độ bảo mật của bạn.
              </p>

              {s3Error && (
                <div style={styles.formErrorBox}>
                  <AlertCircle size={16} />
                  <span>{s3Error}</span>
                </div>
              )}
              {s3Success && (
                <div style={{ ...styles.formErrorBox, background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                  <Check size={16} />
                  <span>{s3Success}</span>
                </div>
              )}

              {/* 3 Storage Options Radio Grid */}
              <div style={styles.storageSelectorContainer}>
                {/* 1. Device Local */}
                <div 
                  onClick={() => setS3Configs(prev => ({ ...prev, type: 'device' }))}
                  style={{
                    ...styles.storageOptionCard,
                    borderColor: s3Configs.type === 'device' ? 'var(--accent-gold)' : 'var(--border-light)',
                    background: s3Configs.type === 'device' ? 'rgba(179, 146, 101, 0.05)' : 'rgba(255, 255, 255, 0.01)'
                  }}
                >
                  <ShieldCheck size={20} color={s3Configs.type === 'device' ? 'var(--accent-gold)' : 'var(--text-secondary)'} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Lưu trực tiếp trên thiết bị (Local Device)</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Lưu bảo mật trong bộ nhớ Trình duyệt của bạn. Khi kết nối và xem lại, bạn cần cấp quyền truy cập thư mục thiết bị để xem ảnh.
                    </span>
                  </div>
                </div>

                {/* 2. Cloud Storage (AWS / Cloudflare R2 / Google...) */}
                <div 
                  onClick={() => setS3Configs(prev => ({ ...prev, type: 'cloud' }))}
                  style={{
                    ...styles.storageOptionCard,
                    borderColor: s3Configs.type === 'cloud' ? 'var(--accent-gold)' : 'var(--border-light)',
                    background: s3Configs.type === 'cloud' ? 'rgba(179, 146, 101, 0.05)' : 'rgba(255, 255, 255, 0.01)'
                  }}
                >
                  <Database size={20} color={s3Configs.type === 'cloud' ? 'var(--accent-gold)' : 'var(--text-secondary)'} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Lưu trên Cloud Storage của các hãng lớn (S3 BYOS)</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Tải và lưu trữ trọn đời ảnh & tiểu thuyết lên dịch vụ lưu trữ đám mây riêng của bạn (AWS S3, Cloudflare R2, Supabase...).
                    </span>
                  </div>
                </div>

                {/* 3. Self-Hosted VPS Storage */}
                <div 
                  onClick={() => setS3Configs(prev => ({ ...prev, type: 'server' }))}
                  style={{
                    ...styles.storageOptionCard,
                    borderColor: s3Configs.type === 'server' ? 'var(--accent-gold)' : 'var(--border-light)',
                    background: s3Configs.type === 'server' ? 'rgba(179, 146, 101, 0.05)' : 'rgba(255, 255, 255, 0.01)'
                  }}
                >
                  <Server size={20} color={s3Configs.type === 'server' ? 'var(--accent-gold)' : 'var(--text-secondary)'} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Lưu vào máy chủ VPS cá nhân tự host (Server Disk)</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Lưu trực tiếp trên phân vùng ổ cứng của con VPS đang chạy app (CMC Cloud). Hoàn toàn miễn phí và không cần setup cloud ngoài.
                    </span>
                  </div>
                </div>
              </div>

              {/* DYNAMIC FORMS BASED ON SELECTED STORAGE TYPE */}
              
              {/* Form 1: Device local */}
              {s3Configs.type === 'device' && (
                <div style={styles.storageFormInner} className="glass-panel">
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-gold)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 10px 0' }}>
                    <FolderInput size={16} /> Cấp quyền Thư mục Thiết bị nội bộ
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                    Để lưu ảnh trực tiếp trên thiết bị (Computer/Phone) và cho phép xem lại mượt mà, vui lòng cấp quyền truy cập thư mục thiết bị của bạn. Nếu trình duyệt không hỗ trợ File System Access API, ứng dụng sẽ lưu tự động vào vùng nhớ IndexedDB an toàn của trình duyệt.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      📂 Thư mục đang chọn: {deviceDirectoryName ? (
                        <strong style={{ color: 'var(--text-primary)' }}>"{deviceDirectoryName}" (Đã cấp quyền)</strong>
                      ) : (
                        <span style={{ fontStyle: 'italic' }}>Chưa chọn thư mục. Bấm nút dưới để cấp quyền.</span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                      <button 
                        type="button" 
                        className="btn-primary" 
                        onClick={handleRequestDevicePermission}
                        style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <FolderInput size={14} />
                        {deviceDirectoryName ? 'Thay đổi thư mục' : 'Chọn & Cấp quyền Thư mục'}
                      </button>
                      <button 
                        type="button"
                        className="btn-secondary"
                        onClick={handleSaveStorageConfigs}
                        disabled={isS3Saving}
                        style={{ padding: '8px 20px', borderRadius: '6px', fontSize: '13px' }}
                      >
                        {isS3Saving ? 'Đang lưu...' : 'Lưu chế độ thiết bị'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Form 2: Cloud S3 */}
              {s3Configs.type === 'cloud' && (
                <form onSubmit={handleSaveStorageConfigs} style={styles.s3Form}>
                  <div style={styles.s3Grid}>
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <label className="form-label">S3 Endpoint (Bỏ trống nếu sử dụng AWS S3 mặc định)</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Ví dụ: https://<account-id>.r2.cloudflarestorage.com hoặc server-ip:9000"
                        value={s3Configs.endpoint}
                        onChange={(e) => setS3Configs(prev => ({ ...prev, endpoint: e.target.value }))}
                        style={{ padding: '10px 14px', fontSize: '14px' }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">S3 Region (Khu vực)</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Ví dụ: us-east-1, ap-southeast-1, r2..."
                        value={s3Configs.region}
                        onChange={(e) => setS3Configs(prev => ({ ...prev, region: e.target.value }))}
                        style={{ padding: '10px 14px', fontSize: '14px' }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">S3 Bucket Name (Tên Bucket) *</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Ví dụ: manga2novel-bucket..."
                        value={s3Configs.bucketName}
                        onChange={(e) => setS3Configs(prev => ({ ...prev, bucketName: e.target.value }))}
                        style={{ padding: '10px 14px', fontSize: '14px' }}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Access Key ID *</label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="Nhập S3 Access Key ID..."
                        value={s3Configs.accessKeyId}
                        onChange={(e) => setS3Configs(prev => ({ ...prev, accessKeyId: e.target.value }))}
                        style={{ padding: '10px 14px', fontSize: '14px' }}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Secret Access Key *</label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="Nhập S3 Secret Access Key..."
                        value={s3Configs.secretAccessKey}
                        onChange={(e) => setS3Configs(prev => ({ ...prev, secretAccessKey: e.target.value }))}
                        style={{ padding: '10px 14px', fontSize: '14px' }}
                        required
                      />
                    </div>
                  </div>

                  <div style={styles.secureBadgeContainer}>
                    <ShieldCheck size={16} color="#10b981" />
                    <span style={{ fontSize: '11px', color: '#10b981', fontWeight: '600' }}>
                      Mã hóa chuẩn bảo mật AES-256-GCM ở Server
                    </span>
                  </div>

                  <div style={styles.formActions}>
                    <button 
                      type="button" 
                      className="btn-secondary" 
                      onClick={handleTestS3}
                      disabled={isTestingS3 || !s3Configs.bucketName}
                      style={{ padding: '10px 20px', borderRadius: '6px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {isTestingS3 ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                      {isTestingS3 ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
                    </button>
                    <button 
                      type="submit" 
                      className="btn-primary" 
                      disabled={isS3Saving}
                      style={{ padding: '10px 24px', borderRadius: '6px', fontSize: '13px' }}
                    >
                      {isS3Saving ? 'Đang lưu...' : 'Lưu cấu hình S3'}
                    </button>
                  </div>
                </form>
              )}

              {/* Form 3: Server local storage */}
              {s3Configs.type === 'server' && (
                <div style={styles.storageFormInner} className="glass-panel">
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-gold)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 12px 0' }}>
                    <Server size={16} /> Cấu hình Lưu trữ Máy chủ VPS tự host
                  </h4>
                  
                  {/* VPS Case Selector */}
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                    <label 
                      onClick={() => setVpsMode('local')}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: `1px solid ${vpsMode === 'local' ? 'var(--accent-gold)' : 'var(--border-light)'}`,
                        background: vpsMode === 'local' ? 'rgba(179, 146, 101, 0.05)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input 
                          type="radio" 
                          name="vps_mode" 
                          checked={vpsMode === 'local'}
                          onChange={() => setVpsMode('local')}
                          style={{ accentColor: 'var(--accent-gold)' }}
                        />
                        Trường hợp 3.1: Cùng mạng VPC
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        Dùng NFS Mount ổ đĩa VPS Storage nội bộ hoặc lưu trực tiếp tại App Server.
                      </span>
                    </label>

                    <label 
                      onClick={() => setVpsMode('remote')}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: `1px solid ${vpsMode === 'remote' ? 'var(--accent-gold)' : 'var(--border-light)'}`,
                        background: vpsMode === 'remote' ? 'rgba(179, 146, 101, 0.05)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input 
                          type="radio" 
                          name="vps_mode" 
                          checked={vpsMode === 'remote'}
                          onChange={() => setVpsMode('remote')}
                          style={{ accentColor: 'var(--accent-gold)' }}
                        />
                        Trường hợp 3.2: Khác mạng (Cloudflare Tunnel)
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        Đẩy qua Cloudflare Tunnel kết nối tới API Endpoint bảo mật của VPS Storage.
                      </span>
                    </label>
                  </div>

                  {vpsMode === 'local' ? (
                    <div>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                        Khi chọn chế độ **Cùng VPC**, dữ liệu truyện sẽ được ghi trực tiếp lên phân vùng ổ đĩa cục bộ (đường dẫn: <code>public/uploads/...</code>). Để chuyển sang Storage VPS chuyên dụng, bạn có thể mount thư mục của VPS Storage vào thư mục <code>public/uploads</code> trên App Server qua <strong>NFS (Network File System)</strong>. Dữ liệu truyền cực kỳ nhanh qua Private IP nội bộ.
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(179, 146, 101, 0.03)', border: '1px solid rgba(179, 146, 101, 0.15)', borderRadius: '6px', marginBottom: '16px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          💡 **Không cần cấu hình UI:** Next.js ghi đĩa với quyền I/O cục bộ, hệ điều hành tự động đồng bộ sang VPS Storage qua mạng Private.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                        Khi chọn chế độ **Khác mạng (Cloudflare Tunnel)**, App Server sẽ đóng vai trò client đẩy dữ liệu qua giao thức HTTP POST an toàn tới API Endpoint của Storage VPS. Bằng cách dùng Cloudflare Tunnel, bạn không cần mở cổng SSH/SFTP công cộng của VPS Storage ra Internet.
                      </p>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                        <div className="form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>VPS Storage Upload API Endpoint *</label>
                          <input 
                            type="text" 
                            className="form-input" 
                            placeholder="Ví dụ: https://storage.yourdomain.com/api/upload"
                            value={s3Configs.endpoint || ''}
                            onChange={(e) => setS3Configs(prev => ({ ...prev, endpoint: e.target.value }))}
                            style={{ padding: '8px 12px', fontSize: '13px' }}
                            required={vpsMode === 'remote'}
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Mã xác thực bí mật (Secret Auth Token) *</label>
                          <input 
                            type="password" 
                            className="form-input" 
                            placeholder="Nhập mã bí mật để xác thực quyền upload..."
                            value={s3Configs.secretAccessKey || ''}
                            onChange={(e) => setS3Configs(prev => ({ ...prev, secretAccessKey: e.target.value }))}
                            style={{ padding: '8px 12px', fontSize: '13px' }}
                            required={vpsMode === 'remote'}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(16, 185, 129, 0.03)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: '6px', marginBottom: '16px' }}>
                        <ShieldCheck size={16} color="#10b981" />
                        <span style={{ fontSize: '11px', color: '#10b981', fontWeight: '600' }}>
                          Mã xác thực và API Endpoint được mã hóa AES-256-GCM an toàn ở phía Server
                        </span>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button 
                      type="button" 
                      className="btn-primary" 
                      onClick={handleSaveStorageConfigs}
                      disabled={isS3Saving}
                      style={{ padding: '10px 24px', borderRadius: '6px', fontSize: '13px' }}
                    >
                      {isS3Saving ? 'Đang lưu...' : 'Kích hoạt Chế độ VPS Server'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const styles = {
  mainContainer: {
    padding: '30px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  titleSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#b39265',
    textDecoration: 'none',
    fontSize: '13px',
    fontWeight: '600',
    alignSelf: 'flex-start',
    transition: 'color 0.2s'
  },
  pageTitle: {
    fontSize: '28px',
    fontWeight: '700',
    margin: 0
  },
  pageSubtitle: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    maxWidth: '700px',
    lineHeight: '1.6'
  },
  tabNav: {
    display: 'flex',
    gap: '20px',
    borderBottom: '1px solid var(--border-light)',
    paddingBottom: '2px'
  },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    padding: '8px 12px 10px 12px',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  settingsLayout: {
    padding: '24px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-light)',
    borderRadius: '12px',
    minHeight: '480px',
    display: 'flex',
    flexDirection: 'column'
  },
  twoColumnLayout: {
    display: 'flex',
    flexDirection: 'row',
    gap: '30px',
    flex: 1
  },
  leftColumn: {
    flex: 1.2,
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  rightColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    borderLeft: '1px solid var(--border-light)',
    paddingLeft: '30px'
  },
  storageTabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '650px',
    margin: '0 auto',
    width: '100%',
    padding: '10px 0'
  },
  storageSelectorContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '20px'
  },
  storageOptionCard: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    '&:hover': {
      borderColor: 'var(--accent-gold)',
      boxShadow: '0 2px 8px rgba(179, 146, 101, 0.05)'
    }
  },
  storageFormInner: {
    padding: '20px',
    borderRadius: '10px',
    border: '1px solid var(--border-light)',
    background: 'rgba(255, 255, 255, 0.01)',
    marginTop: '10px'
  },
  s3Form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginTop: '10px'
  },
  s3Grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px'
  },
  secureBadgeContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    background: 'rgba(16, 185, 129, 0.04)',
    border: '1px solid rgba(16, 185, 129, 0.15)',
    borderRadius: '6px',
    alignSelf: 'flex-start'
  },
  formActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '16px'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px'
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px'
  },
  addBtn: {
    padding: '6px 12px',
    fontSize: '12px',
    borderRadius: '6px',
    gap: '4px'
  },
  emptyConfigs: {
    padding: '50px 20px',
    textAlign: 'center',
    border: '1px dashed var(--border-light)',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1
  },
  configList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: 1
  },
  configCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    borderRadius: '8px',
    border: '1px solid',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  cardMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  configCardTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  activeBadge: {
    fontSize: '9px',
    background: 'rgba(179, 146, 101, 0.12)',
    color: '#b39265',
    border: '1px solid rgba(179, 146, 101, 0.25)',
    borderRadius: '10px',
    padding: '1px 6px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '2px'
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '11px'
  },
  metaBadge: {
    color: 'var(--text-secondary)',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-light)',
    padding: '1px 6px',
    borderRadius: '4px',
    fontSize: '9px',
    fontWeight: '600'
  },
  metaText: {
    color: 'var(--text-muted)'
  },
  cardActions: {
    display: 'flex',
    gap: '6px',
    marginLeft: '12px'
  },
  actionIconBtn: {
    background: 'transparent',
    border: '1px solid var(--border-light)',
    color: 'var(--text-secondary)',
    padding: '6px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '&:hover': {
      background: 'rgba(255, 255, 255, 0.03)',
      borderColor: 'var(--accent-gold)'
    }
  },
  formErrorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    padding: '10px 14px',
    borderRadius: '6px',
    color: '#ef4444',
    fontSize: '13px'
  }
};
