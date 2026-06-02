'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession, signIn, signOut } from 'next-auth/react';
import { BookOpen, Settings, AlertTriangle, CheckCircle, ArrowLeft, LogIn, LogOut } from 'lucide-react';

export default function Header({ projectTitle, showBack = false }) {
  const { data: session } = useSession();
  const [hasApiKey, setHasApiKey] = useState(true);
  const [activeConfigName, setActiveConfigName] = useState('');

  // Check API key configuration on load and dynamically
  const checkApiKey = () => {
    if (typeof window !== 'undefined') {
      try {
        const activeId = localStorage.getItem('manga2novel_active_config_id');
        const configs = JSON.parse(localStorage.getItem('manga2novel_api_configs') || '[]');
        const activeConfig = configs.find(c => c.id === activeId);
        
        if (activeConfig) {
          setHasApiKey(!!activeConfig.apiKey && activeConfig.apiKey.trim().length > 0);
          setActiveConfigName(activeConfig.name);
          return;
        }
      } catch (e) {
        console.error('Error loading config in Header:', e);
      }

      // Legacy fallback
      const key = localStorage.getItem('manga2novel_api_key');
      setHasApiKey(!!key && key.trim().length > 0);
      setActiveConfigName(key ? 'Gemini Legacy' : '');
    }
  };

  useEffect(() => {
    checkApiKey();
    const interval = setInterval(checkApiKey, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="app-header">
      <div className="container" style={styles.headerContainer}>
        <div style={styles.leftSection}>
          {showBack ? (
            <Link href="/" style={styles.backBtn} title="Quay lại Trang chủ">
              <ArrowLeft size={16} />
            </Link>
          ) : null}
          
          <Link href="/" className="app-logo">
            <BookOpen size={22} />
            <span className="gradient-title" style={{ fontSize: '18px', fontWeight: '700' }}>
              MangaScribe AI
            </span>
          </Link>

          {projectTitle && (
            <div style={styles.projectDivider}>
              <span style={styles.dividerText}>/</span>
              <span style={styles.projectTitleText}>{(projectTitle || '').normalize('NFC')}</span>
            </div>
          )}
        </div>

        <div style={styles.rightSection}>
          {/* API Key Status Badge (Links to Settings for convenience) */}
          <Link 
            href="/settings"
            style={{
              ...styles.statusBadge,
              backgroundColor: hasApiKey ? 'rgba(179, 146, 101, 0.08)' : 'rgba(239, 68, 68, 0.05)',
              borderColor: hasApiKey ? 'rgba(179, 146, 101, 0.25)' : 'rgba(239, 68, 68, 0.2)',
              color: hasApiKey ? 'var(--accent-gold)' : '#ef4444',
              textDecoration: 'none'
            }}
          >
            {hasApiKey ? (
              <>
                <CheckCircle size={12} />
                <span style={styles.badgeText}>
                  {activeConfigName ? `API: ${activeConfigName}` : 'API Active'}
                </span>
              </>
            ) : (
              <>
                <AlertTriangle size={12} />
                <span style={styles.badgeText}>Chưa cấu hình API Key</span>
              </>
            )}
          </Link>

          <Link 
            href="/settings"
            className="btn-secondary" 
            style={{ ...styles.settingsBtn, textDecoration: 'none' }}
          >
            <Settings size={15} />
            <span className="hide-mobile" style={{ fontSize: '13px' }}>Cài đặt</span>
          </Link>

          {/* User Auth Section */}
          {session ? (
            <div style={styles.userProfile}>
              <img 
                src={session.user.image || 'https://www.gravatar.com/avatar/?d=mp'} 
                alt={session.user.name} 
                style={styles.avatar}
                title={session.user.name}
              />
              <span className="hide-mobile" style={styles.userName}>
                {session.user.name?.split(' ')[0] || 'User'}
              </span>
              <button 
                onClick={() => signOut()} 
                style={styles.logoutBtn} 
                title="Đăng xuất"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button 
              onClick={() => signIn('google')} 
              style={styles.loginBtn}
              title="Đăng nhập Google"
            >
              <LogIn size={13} />
              <span className="hide-mobile" style={{ fontSize: '12px', fontWeight: '600' }}>Đăng nhập</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

const styles = {
  headerContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%'
  },
  leftSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px'
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: '1px solid var(--border-light)',
    borderRadius: '6px',
    padding: '7px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textDecoration: 'none',
    '&:hover': {
      color: 'var(--text-primary)',
      borderColor: 'var(--accent-gold)',
      background: 'rgba(179, 146, 101, 0.02)'
    }
  },
  projectDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  dividerText: {
    color: 'var(--border-light)',
    fontSize: '16px',
    fontWeight: '300'
  },
  projectTitleText: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    fontWeight: '500',
    maxWidth: '200px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  rightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 12px',
    borderRadius: '15px',
    border: '1px solid',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  badgeText: {
    fontSize: '10px',
    letterSpacing: '0.1px',
    textTransform: 'uppercase'
  },
  settingsBtn: {
    padding: '7px 12px',
    borderRadius: '6px',
    gap: '6px'
  },
  userProfile: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(179, 146, 101, 0.06)',
    border: '1px solid rgba(179, 146, 101, 0.2)',
    padding: '4px 10px 4px 6px',
    borderRadius: '20px',
    height: '32px'
  },
  avatar: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '1px solid rgba(179, 146, 101, 0.4)'
  },
  userName: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-secondary)'
  },
  logoutBtn: {
    background: 'transparent',
    border: 'none',
    color: '#ef4444',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    borderRadius: '50%',
    marginLeft: '2px',
    transition: 'all 0.2s',
    '&:hover': {
      background: 'rgba(239, 68, 68, 0.08)'
    }
  },
  loginBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 12px',
    borderRadius: '20px',
    cursor: 'pointer',
    border: '1px solid rgba(179, 146, 101, 0.25)',
    background: 'rgba(179, 146, 101, 0.08)',
    color: 'var(--accent-gold)',
    transition: 'all 0.2s',
    '&:hover': {
      background: 'rgba(179, 146, 101, 0.15)',
      boxShadow: '0 2px 8px rgba(179, 146, 101, 0.1)'
    }
  }
};
