'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import styles from './page.module.css';
import { getProject, getPagesForProject } from '@/utils/db';
import { 
  Play, Pause, Square, Volume2, Type, FileText, 
  Printer, Download, ChevronLeft, ChevronRight, ArrowLeft, Loader2 
} from 'lucide-react';

function ReaderContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('id');

  const [project, setProject] = useState(null);
  const [pages, setPages] = useState([]);
  const [completedPages, setCompletedPages] = useState([]);
  const [loading, setLoading] = useState(true);

  // Styling Customization State
  const [fontFamily, setFontFamily] = useState('serif'); // 'serif' | 'sans'
  const [fontSize, setFontSize] = useState('md'); // 'sm' | 'md' | 'lg' | 'xl'
  const [lineHeight, setLineHeight] = useState('standard'); // 'dense' | 'standard' | 'loose'
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  const [paragraphs, setParagraphs] = useState([]);

  // Fetch project and completed pages
  useEffect(() => {
    if (!projectId) {
      router.push('/');
      return;
    }

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
        setPages(pageList);

        const completed = pageList.filter(p => p.status === 'completed' && p.novelText.trim().length > 0)
                                  .map(p => ({ ...p, novelText: p.novelText.normalize('NFC') }));
        setCompletedPages(completed);

        // Segment text into paragraphs for reading highlights
        const allParagraphs = [];
        completed.forEach((page) => {
          const pgText = page.novelText.trim();
          if (pgText) {
            // Split page content by double newlines or single newlines that look like paragraphs
            const textBlocks = pgText.split(/\n\s*\n/).filter(block => block.trim().length > 0);
            textBlocks.forEach((block, blockIdx) => {
              allParagraphs.push({
                pageNumber: page.pageNumber,
                text: block.trim(),
                id: `${page.id}-${blockIdx}`
              });
            });
          }
        });
        setParagraphs(allParagraphs);
        setCurrentPageIndex(0);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load reader data:', err);
        router.push('/');
      }
    };

    loadData();
  }, [projectId, router]);



  // Exporters
  const exportAsTXT = () => {
    const title = project?.title || 'Tieu_Thuyet_Manga';
    const textContent = completedPages
      .map(p => `--- TRANG ${p.pageNumber} ---\n\n${p.novelText}`)
      .join('\n\n\n');
    
    downloadFile(textContent, `${title.replace(/\s+/g, '_')}.txt`, 'text/plain;charset=utf-8');
  };

  const exportAsMarkdown = () => {
    const title = project?.title || 'Tieu_Thuyet_Manga';
    const markdownContent = `# ${project?.title}\n\n*Tiểu thuyết chuyển đổi bằng MangaScribe AI*\n\n---\n\n` + 
      completedPages
        .map(p => `## Trang ${p.pageNumber}\n\n${p.novelText}`)
        .join('\n\n---\n\n');

    downloadFile(markdownContent, `${title.replace(/\s+/g, '_')}.md`, 'text/markdown;charset=utf-8');
  };

  const exportAsHTML = () => {
    const title = project?.title || 'Tiểu thuyết Manga';
    const novelBody = completedPages
      .map(p => `
        <section class="chapter">
          <div class="chapter-title">Trang ${p.pageNumber}</div>
          <div class="chapter-content">
            ${p.novelText.split('\n').map(para => `<p>${para}</p>`).join('')}
          </div>
        </section>
      `).join('<hr class="divider"/>');

    const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Outfit:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07050f;
      --text: #f3f4f6;
      --accent: #8b5cf6;
      --divider-color: rgba(139, 92, 246, 0.15);
      --card-bg: rgba(22, 18, 44, 0.6);
    }
    body.light-theme {
      --bg: #f9fafb;
      --text: #111827;
      --accent: #6d28d9;
      --divider-color: rgba(109, 40, 217, 0.15);
      --card-bg: #ffffff;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Lora', Georgia, serif;
      line-height: 2;
      margin: 0;
      padding: 0;
      transition: all 0.3s ease;
    }
    .container {
      max-width: 750px;
      margin: 0 auto;
      padding: 60px 20px;
    }
    header {
      font-family: 'Outfit', sans-serif;
      text-align: center;
      margin-bottom: 50px;
      position: relative;
    }
    h1 {
      font-size: 36px;
      margin-bottom: 12px;
    }
    .meta {
      color: #9ca3af;
      font-size: 14px;
    }
    .theme-toggle {
      font-family: 'Outfit', sans-serif;
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--card-bg);
      border: 1px solid var(--divider-color);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 20px;
      cursor: pointer;
      box-shadow: 0 4px 10px rgba(0,0,0,0.1);
      font-weight: 600;
    }
    .chapter {
      margin-bottom: 40px;
    }
    .chapter-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--accent);
      margin-bottom: 20px;
      border-bottom: 1px solid var(--divider-color);
      padding-bottom: 8px;
    }
    p {
      margin-bottom: 1.5em;
      text-align: justify;
      text-indent: 1.5em;
    }
    .divider {
      border: 0;
      height: 1px;
      background: var(--divider-color);
      margin: 50px 0;
    }
  </style>
</head>
<body>
  <button class="theme-toggle" onclick="document.body.classList.toggle('light-theme')">Đổi Giao Diện</button>
  <div class="container">
    <header>
      <h1>${title}</h1>
      <div class="meta">Tiểu thuyết chuyển đổi bằng MangaScribe AI</div>
    </header>
    ${novelBody}
  </div>
</body>
</html>`;

    downloadFile(htmlContent, `${title.replace(/\s+/g, '_')}.html`, 'text/html;charset=utf-8');
  };

  const downloadFile = (content, filename, contentType) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleScrollToPage = (pageId) => {
    const pageIndex = completedPages.findIndex(page => `page-${page.id}` === pageId);
    if (pageIndex >= 0) {
      setCurrentPageIndex(pageIndex);
    }
    const el = document.getElementById(pageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handlePreviousPage = () => {
    if (completedPages.length === 0) return;
    const nextIndex = Math.max(0, currentPageIndex - 1);
    setCurrentPageIndex(nextIndex);
    handleScrollToPage(`page-${completedPages[nextIndex].id}`);
  };

  const handleNextPage = () => {
    if (completedPages.length === 0) return;
    const nextIndex = Math.min(completedPages.length - 1, currentPageIndex + 1);
    setCurrentPageIndex(nextIndex);
    handleScrollToPage(`page-${completedPages[nextIndex].id}`);
  };

  if (loading) {
    return (
      <div style={stylesHelper.loadingScreen} suppressHydrationWarning>
        <Loader2 size={48} className="animate-spin" color="#8b5cf6" />
        <p style={{ marginTop: '20px', fontSize: '16px', fontWeight: '600' }}>
          Đang chuẩn bị trang đọc tiểu thuyết...
        </p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }} suppressHydrationWarning>
      <Header projectTitle={project?.title} showBack={true} />

      <div className={styles.readerLayout}>
        {/* Left Sidebar: Chapters Index */}
        <aside className={styles.sidebar}>
          <span className={styles.sidebarTitle}>Mục lục chương</span>
          <div className={styles.indexList}>
            {completedPages.map((page) => (
              <div
                key={page.id}
                className={styles.indexItem}
                onClick={() => handleScrollToPage(`page-${page.id}`)}
              >
                Trang {page.pageNumber}
              </div>
            ))}
            {completedPages.length === 0 && (
              <p style={{ fontSize: '13px', color: '#6b7280' }}>Chưa có trang nào chuyển đổi hoàn tất.</p>
            )}
          </div>
        </aside>

        {/* Right workspace: Reading core */}
        <div className={styles.readingWorkspace}>
          {/* Top reader controls bar */}
          <div className={styles.controlsBar}>
            {/* Style typography controls */}
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Trình bày</span>
              
              {/* Font selector */}
              <button 
                className={`${styles.controlBtn} ${fontFamily === 'serif' ? styles.controlBtnActive : ''}`}
                onClick={() => setFontFamily('serif')}
                title="Font Serif (Tiểu thuyết)"
              >
                Serif
              </button>
              <button 
                className={`${styles.controlBtn} ${fontFamily === 'sans' ? styles.controlBtnActive : ''}`}
                onClick={() => setFontFamily('sans')}
                title="Font Sans-Serif (Hiện đại)"
              >
                Sans
              </button>

              {/* Font Size */}
              <button 
                className={styles.controlBtn}
                onClick={() => {
                  const sizes = ['sm', 'md', 'lg', 'xl'];
                  const nextIdx = (sizes.indexOf(fontSize) + 1) % sizes.length;
                  setFontSize(sizes[nextIdx]);
                }}
                title="Thay đổi cỡ chữ"
              >
                <Type size={14} />
                Cỡ {fontSize.toUpperCase()}
              </button>
            </div>

            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Điều hướng</span>
              <button
                className={styles.controlBtn}
                onClick={handlePreviousPage}
                disabled={completedPages.length === 0 || currentPageIndex === 0}
                title="Trang truyện trước đó"
              >
                <ChevronLeft size={14} />
                Trước
              </button>
              <button
                className={styles.controlBtn}
                onClick={handleNextPage}
                disabled={completedPages.length === 0 || currentPageIndex >= completedPages.length - 1}
                title="Trang truyện kế tiếp"
              >
                Tiếp
                <ChevronRight size={14} />
              </button>
              <span className={styles.controlLabel} style={{ textTransform: 'none' }}>
                {completedPages.length > 0 ? `Trang ${currentPageIndex + 1}/${completedPages.length}` : '0 trang'}
              </span>
            </div>



            {/* Exporting & Print utilities */}
            <div className={styles.controlGroup} style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px', marginLeft: 'auto' }}>
              <button className={styles.controlBtn} onClick={handlePrint} title="In truyện hoặc Xuất file PDF trình duyệt cực đẹp">
                <Printer size={14} />
                <span>Xuất PDF</span>
              </button>

              <div style={styles.exportDropdownContainer}>
                <button className={styles.controlBtn}>
                  <Download size={14} />
                  <span>Tải Về</span>
                </button>
                <div style={styles.exportDropdown}>
                  <div style={styles.dropdownItem} onClick={exportAsTXT}>Tệp văn bản (.TXT)</div>
                  <div style={styles.dropdownItem} onClick={exportAsMarkdown}>Tệp Markdown (.MD)</div>
                  <div style={styles.dropdownItem} onClick={exportAsHTML}>Website độc lập (.HTML)</div>
                </div>
              </div>
            </div>
          </div>

          {/* Core Novel Book rendering */}
          <div className={styles.bookContainer}>
            <h1 className={styles.bookTitle}>{project?.title}</h1>
            <p className={styles.bookMeta}>Tiểu thuyết chuyển đổi bằng MangaScribe AI • {completedPages.length} chương hoàn thành</p>

            {completedPages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>
                <FileText size={48} style={{ margin: '0 auto 16px', display: 'block', color: '#6b7280' }} />
                <h3>Chưa có trang tiểu thuyết nào</h3>
                <p style={{ fontSize: '14px', marginTop: '6px' }}>Vui lòng quay lại Studio và bấm Phân tích trang truyện tranh để xem kết quả sáng tác tại đây.</p>
                <button 
                  className="btn-primary" 
                  onClick={() => router.push(`/studio?id=${projectId}`)}
                  style={{ marginTop: '20px', display: 'inline-flex' }}
                >
                  <ArrowLeft size={16} />
                  Quay lại Studio
                </button>
              </div>
            ) : (
              /* Render paragraphs sequentially */
              <div>
                {completedPages.map((page) => {
                  // Find all paragraphs corresponding to this page
                  const pageParas = paragraphs.filter(p => p.pageNumber === page.pageNumber);
                  
                  return (
                    <div 
                      key={page.id} 
                      id={`page-${page.id}`} 
                      className={styles.pageSection}
                    >
                      <h3 className={styles.pageHeader}>
                        <span>Chương {page.pageNumber}</span>
                        <span className={styles.pageHeaderIndex}>Trang {page.pageNumber} Manga gốc</span>
                      </h3>

                      {pageParas.map((para) => {
                        return (
                          <div
                            key={para.id}
                            className={`
                              ${styles.novelParagraph} 
                              ${fontFamily === 'sans' ? styles.fontSans : styles.fontSerif}
                              ${fontSize === 'sm' ? styles.fontSizeSm : fontSize === 'md' ? styles.fontSizeMd : fontSize === 'lg' ? styles.fontSizeLg : styles.fontSizeXl}
                              ${lineHeight === 'dense' ? styles.spacingDense : lineHeight === 'standard' ? styles.spacingStandard : styles.spacingLoose}
                            `}
                          >
                            {para.text}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  speedSelect: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#9ca3af',
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '12px',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    outline: 'none'
  },
  exportDropdownContainer: {
    position: 'relative',
    display: 'inline-block',
    '&:hover div': {
      display: 'block'
    }
  },
  exportDropdown: {
    display: 'none',
    position: 'absolute',
    right: 0,
    backgroundColor: '#0d0a1b',
    minWidth: '180px',
    boxShadow: '0px 8px 16px 0px rgba(0,0,0,0.5)',
    borderRadius: '10px',
    border: '1px solid rgba(139, 92, 246, 0.15)',
    zIndex: 100,
    padding: '6px 0',
    marginTop: '4px'
  },
  dropdownItem: {
    color: '#9ca3af',
    padding: '10px 16px',
    textDecoration: 'none',
    display: 'block',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    transition: 'all 0.2s',
    '&:hover': {
      backgroundColor: 'rgba(139, 92, 246, 0.12)',
      color: '#fff'
    }
  }
};

Object.assign(styles, stylesHelper);

export default function Reader() {
  return (
    <Suspense fallback={
      <div style={stylesHelper.loadingScreen} suppressHydrationWarning>
        <Loader2 size={48} className="animate-spin" color="#8b5cf6" />
        <p style={{ marginTop: '20px', fontSize: '16px', fontWeight: '600' }}>
          Đang tải trình đọc tiểu thuyết...
        </p>
      </div>
    }>
      <ReaderContent />
    </Suspense>
  );
}
