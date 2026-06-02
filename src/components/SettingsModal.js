'use client';

import { useState, useEffect } from 'react';
import { 
  X, Key, Cpu, Sparkles, HelpCircle, Plus, 
  Trash2, Edit3, Check, Globe, AlertCircle, ArrowLeft
} from 'lucide-react';
import { GEMINI_MODELS, DEFAULT_PROMPT, PROVIDERS } from '@/utils/gemini';
import { getApiConfigs, saveApiConfigs } from '@/utils/db';

export default function SettingsModal({ isOpen, onClose }) {
  const [configs, setConfigs] = useState([]);
  const [activeConfigId, setActiveConfigId] = useState('');
  
  // Editor view states
  const [view, setView] = useState('list'); // 'list' | 'add' | 'edit'
  const [editingConfigId, setEditingConfigId] = useState('');
  
  // Form State
  const [formName, setFormName] = useState('');
  const [formProvider, setFormProvider] = useState('gemini');
  const [formApiKey, setFormApiKey] = useState('');
  const [formModel, setFormModel] = useState('gemini-2.5-flash');
  const [formBaseUrl, setFormBaseUrl] = useState('https://generativelanguage.googleapis.com');
  const [formError, setFormError] = useState('');

  // Global settings
  const [customPrompt, setCustomPrompt] = useState('');
  const [showPromptHelp, setShowPromptHelp] = useState(false);
  const [isPromptSaved, setIsPromptSaved] = useState(false);
  const [fileInstructions, setFileInstructions] = useState('');

  // Suggested models based on provider selection
  const getSuggestedModels = (provider) => {
    switch (provider) {
      case 'gemini':
        return GEMINI_MODELS.map(m => m.id);
      case 'openai':
        return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
      case 'grok':
        return ['grok-2-vision-1212', 'grok-vision-beta'];
      default:
        return [];
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPrompt = localStorage.getItem('manga2novel_custom_prompt') || '';
      setCustomPrompt(savedPrompt);
      setFileInstructions(window.manga2novel_file_instructions || '');
      loadConfigs();
    }
  }, [isOpen]);

  // Load configs and handle legacy fallback migrations
  const loadConfigs = async () => {
    if (typeof window === 'undefined') return;

    let savedConfigs = [];
    let activeId = '';

    // ALWAYS pull from server to ensure hardcoded keys are updated
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
      console.error('Failed to hydrate API configs from server:', e);
    }

    // Fallback to local configs if server fetch failed or returned nothing
    if (savedConfigs.length === 0) {
      try {
        savedConfigs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
        activeId = localStorage.getItem('manga2novel_active_config_id') || '';
      } catch (e) {
        savedConfigs = [];
      }
    }

    // Migration: If no configurations exist but a legacy Gemini key is found
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

  // Switch provider and auto-populate default BaseURL and Model values
  const handleProviderChange = (provider) => {
    setFormProvider(provider);
    const matchedProvider = PROVIDERS.find(p => p.id === provider);
    setFormBaseUrl(matchedProvider ? matchedProvider.defaultUrl : '');
    
    const suggested = getSuggestedModels(provider);
    if (suggested.length > 0) {
      setFormModel(suggested[0]);
    } else {
      setFormModel('');
    }
  };

  const handleOpenAdd = () => {
    setFormName('');
    setFormProvider('gemini');
    setFormApiKey('');
    setFormModel('gemini-2.5-flash');
    setFormBaseUrl('https://generativelanguage.googleapis.com');
    setFormError('');
    setEditingConfigId('');
    setView('add');
  };

  const handleOpenEdit = (config) => {
    setFormName(config.name);
    setFormProvider(config.provider);
    setFormApiKey(config.apiKey);
    setFormModel(config.model);
    setFormBaseUrl(config.baseUrl || '');
    setFormError('');
    setEditingConfigId(config.id);
    setView('edit');
  };

  const syncConfigsToServer = async (updatedConfigs, activeId) => {
    try {
      const usePool = localStorage.getItem('manga2novel_use_api_pool') === 'true';
      let poolIds = [];
      try {
        poolIds = JSON.parse(localStorage.getItem('manga2novel_pool_config_ids') || '[]');
      } catch (e) {}
      await saveApiConfigs(updatedConfigs, activeId, usePool, poolIds);
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
    if (!formModel.trim()) {
      setFormError('Vui lòng nhập tên mô hình AI');
      return;
    }

    const newConfig = {
      id: editingConfigId || crypto.randomUUID(),
      name: formName.trim(),
      provider: formProvider,
      apiKey: formApiKey.trim(),
      model: formModel.trim(),
      baseUrl: formBaseUrl.trim()
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

    // If it's the first config or there was no active config, set it active
    if (!activeConfigId || updated.length === 1) {
      nextActiveId = newConfig.id;
      localStorage.setItem('manga2novel_active_config_id', nextActiveId);
      setActiveConfigId(nextActiveId);
      
      // Keep legacy keys updated for maximum compatibility
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

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} className="animate-fade-in">
      <div style={styles.modal} className="glass-panel">
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <Sparkles size={22} color="#c5a880" />
            <span style={{ fontSize: '18px', fontWeight: '700', letterSpacing: '0.8px' }}>
              BẢNG ĐIỀU KHIỂN AI STUDIO
            </span>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.twoColumnLayout}>
            {/* Left Column: API Manager / API Form */}
            <div style={styles.leftColumn}>
              {view === 'list' ? (
                <>
                  <div style={styles.sectionHeader}>
                    <h3 style={styles.sectionTitle}>Nhà cung cấp AI</h3>
                    <button 
                      className="btn-primary" 
                      onClick={handleOpenAdd}
                      style={styles.addBtn}
                    >
                      <Plus size={14} />
                      Thêm Key
                    </button>
                  </div>

                  {configs.length === 0 ? (
                    <div style={styles.emptyConfigs}>
                      <AlertCircle size={32} color="#c5a880" style={{ marginBottom: '10px' }} />
                      <p style={{ fontSize: '13px', color: '#94a3b8' }}>Chưa có cấu hình API nào. Vui lòng thêm một nhà cung cấp mới để chạy AI.</p>
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
                              borderColor: isActive ? '#c5a880' : 'rgba(255, 255, 255, 0.05)',
                              background: isActive ? 'rgba(197, 168, 128, 0.04)' : 'rgba(15, 15, 17, 0.4)'
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
                <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#94a3b8' }} onClick={() => setView('list')}>
                    <ArrowLeft size={14} />
                    <span style={{ fontSize: '13px' }}>Quay lại danh sách</span>
                  </div>

                  <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#f8fafc', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '6px' }}>
                    {view === 'add' ? 'Thêm API Key mới' : 'Chỉnh sửa cấu hình API'}
                  </h3>

                  {formError && (
                    <div style={styles.formErrorBox}>
                      <AlertCircle size={16} />
                      <span>{formError}</span>
                    </div>
                  )}

                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Tên gợi nhớ (Ví dụ: Grok 2, ChatGPT Pro...)</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Nhập tên gọi dễ nhớ..."
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Nhà cung cấp API</label>
                    <select 
                      className="form-select"
                      value={formProvider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                    >
                      {PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>
                      <Key size={12} color="#c5a880" /> API Key
                    </label>
                    <input 
                      type="password" 
                      className="form-input" 
                      placeholder="sk-... hoặc AIzaSy..."
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>
                      <Cpu size={12} color="#c5a880" /> Mô hình AI (Model)
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Tên mô hình..."
                        value={formModel}
                        onChange={(e) => setFormModel(e.target.value)}
                        style={{ padding: '8px 12px', fontSize: '13px', flex: 1 }}
                        required
                      />
                      {getSuggestedModels(formProvider).length > 0 && (
                        <select
                          className="form-select"
                          style={{ width: 'auto', minWidth: '100px', padding: '8px 12px', fontSize: '13px' }}
                          value={getSuggestedModels(formProvider).includes(formModel) ? formModel : ''}
                          onChange={(e) => e.target.value && setFormModel(e.target.value)}
                        >
                          <option value="">Gợi ý...</option>
                          {getSuggestedModels(formProvider).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>
                      <Globe size={12} color="#c5a880" /> Base URL (Endpoint)
                    </label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="https://..."
                      value={formBaseUrl}
                      onChange={(e) => setFormBaseUrl(e.target.value)}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button type="button" className="btn-secondary" onClick={() => setView('list')} style={{ padding: '6px 12px', borderRadius: '4px', fontSize: '12px' }}>
                      Hủy
                    </button>
                    <button type="submit" className="btn-primary" style={{ padding: '6px 16px', borderRadius: '4px', fontSize: '12px' }}>
                      {view === 'add' ? 'Thêm' : 'Lưu'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Right Column: Prompt Customizer (Always Visible & Highly Spacious) */}
            <div style={styles.rightColumn}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ margin: 0 }}>
                  <Sparkles size={16} color="#c5a880" />
                  Prompt Hệ thống (Tùy biến phong cách)
                </label>
                <button 
                  style={styles.helpBtn} 
                  onClick={() => setShowPromptHelp(!showPromptHelp)}
                  title="Xem prompt mặc định"
                >
                  <HelpCircle size={15} />
                </button>
              </div>

              {showPromptHelp && (
                <div style={styles.helpBox}>
                  <h4 style={{ fontSize: '11px', fontWeight: '700', marginBottom: '6px', color: '#c5a880' }}>PROMPT MẶC ĐỊNH CHẠY:</h4>
                  <pre style={styles.preText}>{DEFAULT_PROMPT}</pre>
                </div>
              )}

              {/* File Instructions Status Indicator */}
              {fileInstructions && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: !customPrompt.trim() ? 'rgba(197, 168, 128, 0.06)' : 'rgba(255, 255, 255, 0.02)',
                  border: !customPrompt.trim() ? '1px solid rgba(197, 168, 128, 0.15)' : '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '12.5px',
                  color: !customPrompt.trim() ? '#c5a880' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  lineHeight: '1.4',
                  marginTop: '4px'
                }}>
                  <Globe size={14} style={{ flexShrink: 0 }} />
                  <span>
                    {!customPrompt.trim() ? (
                      <>📁 Đang sử dụng cấu hình từ file <strong>ai_instructions.txt</strong> ở thư mục gốc.</>
                    ) : (
                      <>⚙️ Lưu ý: Prompt tùy chỉnh bên dưới sẽ thay thế file <strong>ai_instructions.txt</strong>.</>
                    )}
                  </span>
                </div>
              )}

              <textarea
                className="form-textarea"
                placeholder="Để trống để sử dụng prompt mặc định siêu chi tiết... Hoặc tự viết phong cách tiểu thuyết bạn muốn (ví dụ: 'Viết theo phong cách kiếm hiệp, mô tả kỹ tư thế võ học...')"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                style={{ flex: 1, minHeight: '180px', fontSize: '14px', background: '#070708', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', padding: '14px', lineHeight: '1.6' }}
              />

              <button 
                className="btn-secondary" 
                onClick={handleSavePrompt} 
                style={{ width: '100%', padding: '10px 16px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--accent-gold)', color: 'var(--accent-gold)' }}
              >
                {isPromptSaved ? 'Đã lưu cấu hình prompt!' : 'Lưu cấu hình Prompt'}
              </button>
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button className="btn-secondary" onClick={onClose} style={{ padding: '8px 24px', borderRadius: '8px', fontSize: '13px' }}>
            Đóng bảng điều khiển
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(3, 3, 4, 0.9)',
    backdropFilter: 'blur(16px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px'
  },
  modal: {
    width: '90%',
    maxWidth: '1050px',
    height: '80vh',
    maxHeight: '680px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'fadeIn 0.3s ease',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '12px',
    backgroundColor: '#070709',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
    margin: 0
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 28px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    flexShrink: 0
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.2s',
    outline: 'none'
  },
  content: {
    padding: '28px',
    overflowY: 'hidden',
    flex: 1,
    display: 'flex',
    flexDirection: 'column'
  },
  twoColumnLayout: {
    display: 'flex',
    flexDirection: 'row',
    gap: '32px',
    height: '100%',
    flex: 1,
    overflow: 'hidden'
  },
  leftColumn: {
    flex: 1.1,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    paddingRight: '6px',
    gap: '12px'
  },
  rightColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
    paddingLeft: '32px',
    overflowY: 'auto'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
    flexShrink: 0
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.8px'
  },
  addBtn: {
    padding: '6px 14px',
    fontSize: '12px',
    borderRadius: '4px',
    gap: '4px'
  },
  emptyConfigs: {
    padding: '40px 20px',
    textAlign: 'center',
    border: '1px dashed rgba(255, 255, 255, 0.06)',
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
    gap: '12px',
    overflowY: 'auto',
    flex: 1
  },
  configCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    borderRadius: '6px',
    border: '1px solid',
    cursor: 'pointer',
    transition: 'all 0.2s',
    flexShrink: 0
  },
  cardMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  configCardTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#f8fafc'
  },
  activeBadge: {
    fontSize: '9px',
    background: 'rgba(197, 168, 128, 0.12)',
    color: '#c5a880',
    border: '1px solid rgba(197, 168, 128, 0.25)',
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
    fontSize: '12px'
  },
  metaBadge: {
    color: '#94a3b8',
    background: 'rgba(255, 255, 255, 0.04)',
    padding: '1px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: '500'
  },
  metaText: {
    color: '#64748b'
  },
  cardActions: {
    display: 'flex',
    gap: '8px',
    marginLeft: '12px'
  },
  actionIconBtn: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    color: '#94a3b8',
    padding: '6px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
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
  },
  helpBtn: {
    background: 'none',
    border: 'none',
    color: '#c5a880',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: 0
  },
  helpBox: {
    background: '#020202',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '12px',
    color: '#94a3b8',
    marginBottom: '8px',
    flexShrink: 0
  },
  preText: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    maxHeight: '120px',
    overflowY: 'auto',
    marginTop: '6px',
    fontSize: '11px',
    background: '#070708',
    padding: '8px',
    borderRadius: '4px',
    color: '#64748b',
    lineHeight: '1.4'
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '16px 28px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    background: 'rgba(5, 5, 5, 0.4)',
    flexShrink: 0
  }
};
