'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import styles from './page.module.css';
import { 
  BookOpen, Trash2, Play, Calendar, FileText, 
  ChevronRight, Loader2, AlertCircle, Sparkles
} from 'lucide-react';
import { 
  getProjects, createProject, addPage, getPagesForProject, deleteProject 
} from '@/utils/db';

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [mangaUrl, setMangaUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('checking'); // 'checking' | 'connected' | 'disconnected'
  const [serverHost, setServerHost] = useState('');

  // Load projects from IndexedDB
  const loadProjects = async () => {
    try {
      const data = await getProjects();
      // Calculate progress for each project dynamically
      const projectsWithProgress = await Promise.all(data.map(async (p) => {
        const pages = await getPagesForProject(p.id);
        const completedPages = pages.filter(page => page.status === 'completed').length;
        const percent = pages.length > 0 ? Math.round((completedPages / pages.length) * 100) : 0;
        return {
          ...p,
          title: (p.title || '').normalize('NFC'),
          totalPages: pages.length,
          completedPages,
          progress: percent
        };
      }));
      setProjects(projectsWithProgress);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  useEffect(() => {
    const syncConfigsFromServer = async () => {
      try {
        const res = await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getApiConfigs' })
        });
        if (res.ok) {
          const { result } = await res.json();
          setConnectionStatus('connected');
          if (typeof window !== 'undefined') {
            setServerHost(window.location.host);
          }
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
        } else {
          setConnectionStatus('disconnected');
        }
      } catch (e) {
        console.error('Failed to sync API configs from server:', e);
        setConnectionStatus('disconnected');
      }
    };

    syncConfigsFromServer();
    loadProjects();
  }, []);

  // Handler: Scrape Manga URL
  const handleScrapeSubmit = async (e) => {
    e.preventDefault();
    if (!mangaUrl.trim()) return;

    setIsLoading(true);
    setErrorMsg('');

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mangaUrl.trim() })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Có lỗi xảy ra khi phân tích link truyện.');
      }

      // Create project in IndexedDB
      const project = await createProject(result.title.normalize('NFC'), mangaUrl.trim());
      
      // Save all page image links to project pages
      for (let i = 0; i < result.images.length; i++) {
        await addPage(project.id, i + 1, result.images[i], 'url');
      }

      router.push(`/studio?id=${project.id}`);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
      setIsLoading(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (confirm('Bạn có chắc chắn muốn xóa dự án này? Toàn bộ ảnh và tiểu thuyết đã chuyển đổi sẽ bị xóa vĩnh viễn.')) {
      await deleteProject(id);
      loadProjects();
    }
  };

  return (
    <div>
      <Header />
      
      <main className="container">
        <div className={styles.dashboard}>
          {/* Hero Section */}
          <section className={styles.hero}>
            <h1 className="gradient-text">Chuyển Manga Thành Tiểu Thuyết</h1>
            <p>
              Nhập đường dẫn chương truyện từ website bất kỳ. Công nghệ đa phương thức (Multimodal) AI
              sẽ phân tích bối cảnh, đọc biểu cảm nhân vật và dệt nên áng văn tiểu thuyết sống động, 
              trong khi vẫn bảo toàn 100% lời thoại gốc.
            </p>

            {/* Connection Diagnostics Banner */}
            {connectionStatus === 'disconnected' && (
              <div style={{
                marginTop: '20px',
                padding: '16px 20px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                textAlign: 'left',
                maxWidth: '650px',
                margin: '20px auto 0 auto',
                fontSize: '13px',
                lineHeight: '1.6',
                color: '#ef4444',
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.05)'
              }}>
                <div style={{ fontWeight: '700', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <AlertCircle size={18} />
                  <span>🔴 LỖI KẾT NỐI MÁY CHỦ (LAPTOP)</span>
                </div>
                <p style={{ color: '#94a3b8', marginBottom: '8px' }}>
                  Điện thoại của bạn không thể kết nối tới máy chủ đang chạy trên laptop. Do đó, các khóa API và chức năng tạo truyện sẽ không hoạt động.
                </p>
                <div style={{ paddingLeft: '4px' }}>
                  <strong>💡 Hướng dẫn khắc phục nhanh:</strong>
                  <ul style={{ margin: '6px 0 0 0', paddingLeft: '16px', color: '#94a3b8' }}>
                    <li>Đảm bảo điện thoại và laptop đang **kết nối chung một mạng Wi-Fi**.</li>
                    <li>Không dùng mạng di động (4G/5G) trên điện thoại để truy cập web chạy local.</li>
                    <li>Mở trình duyệt điện thoại ở **Tab ẩn danh (Incognito/Private Tab)** rồi truy cập lại địa chỉ: <code>{serverHost || 'địa chỉ IP laptop:3000'}</code> để loại bỏ hoàn toàn cache cũ.</li>
                  </ul>
                </div>
              </div>
            )}

            {connectionStatus === 'connected' && (
              <div style={{
                marginTop: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.06)',
                border: '1px solid rgba(16, 185, 129, 0.15)',
                padding: '4px 12px',
                borderRadius: '20px',
                fontWeight: '600'
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                <span>🟢 Đã kết nối máy chủ ({serverHost})</span>
              </div>
            )}
          </section>

          {/* Single Focused Import Section */}
          <section className={styles.creatorSection}>
            <div className={styles.tabContent}>
              {errorMsg && (
                <div style={styles.errorAlert}>
                  <AlertCircle size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {isLoading ? (
                <div style={styles.loaderArea}>
                  <Loader2 size={36} className="animate-spin" color="#c5a880" />
                  <p style={{ marginTop: '16px', fontWeight: '500', fontSize: '14px', color: '#94a3b8' }}>
                    Đang kết nối và trích xuất các trang truyện... Quá trình này có thể mất 5-10 giây.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleScrapeSubmit} className={styles.scrapeForm}>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="Dán link chương truyện (ví dụ: nettruyen, blogtruyen...)"
                    required
                    value={mangaUrl}
                    onChange={(e) => setMangaUrl(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" className="btn-primary">
                    Khởi tạo
                    <ChevronRight size={16} />
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* Active Projects Section */}
          <section className={styles.projectsSection}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <BookOpen size={18} color="#c5a880" />
                Dự Án Đang Thực Hiện ({projects.length})
              </h2>
            </div>

            {projects.length === 0 ? (
              <div className={styles.emptyState}>
                <BookOpen size={48} strokeWidth={1} />
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#f8fafc' }}>Chưa có dự án nào</h3>
                <p style={{ fontSize: '13px', color: '#64748b' }}>Dán đường dẫn chương truyện ở trên để bắt đầu chuyến phiêu lưu tiểu thuyết đầu tiên!</p>
              </div>
            ) : (
              <div className={styles.projectsGrid}>
                {projects.map((project) => (
                  <div 
                    key={project.id} 
                    className={styles.projectCard}
                    onClick={() => router.push(`/studio?id=${project.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.projectHeader}>
                      <h3 className={styles.projectTitle} title={project.title}>{project.title}</h3>
                      <button 
                        className={styles.deleteBtn}
                        onClick={(e) => handleDelete(project.id, e)}
                        title="Xóa dự án"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className={styles.projectMeta}>
                      <div className={styles.metaItem}>
                        <Calendar size={13} />
                        <span>{new Date(project.updatedAt).toLocaleDateString('vi-VN')}</span>
                      </div>
                      <div className={styles.metaItem}>
                        <FileText size={13} />
                        <span>{project.totalPages} trang truyện</span>
                      </div>
                    </div>

                    <div className={styles.progressContainer}>
                      <div className={styles.progressText}>
                        <span>Tiến độ chuyển đổi</span>
                        <span style={{ color: '#c5a880', fontWeight: '600' }}>
                          {project.progress}%
                        </span>
                      </div>
                      <div className={styles.progressBarBg}>
                        <div 
                          className={styles.progressBarFill} 
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className={styles.cardFooter}>
                      <button 
                        className="btn-secondary" 
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/reader?id=${project.id}`);
                        }}
                        disabled={project.completedPages === 0}
                        style={{ flex: 1, padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }}
                      >
                        Đọc Truyện
                      </button>
                      <button 
                        className="btn-primary" 
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/studio?id=${project.id}`);
                        }}
                        style={{ flex: 1, padding: '6px 12px', fontSize: '12px', borderRadius: '4px' }}
                      >
                        <Play size={10} fill="currentColor" style={{ marginRight: '2px' }} />
                        Vào Studio
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

// Simple inline style helpers matching our theme
const stylesHelper = {
  errorAlert: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    borderRadius: '6px',
    padding: '10px 14px',
    color: '#ef4444',
    fontSize: '13px',
    marginBottom: '16px',
    animation: 'fadeIn 0.3s ease'
  },
  loaderArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '30px 10px',
    textAlign: 'center',
    color: '#94a3b8'
  }
};

if (typeof Object !== 'undefined') {
  Object.assign(styles, stylesHelper);
}
