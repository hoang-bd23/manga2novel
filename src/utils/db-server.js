import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { encrypt, decrypt } from './encryption';

const DB_FILE = path.join(process.cwd(), 'server_db.json');
const DB_TEMP_FILE = path.join(process.cwd(), 'server_db.tmp.json');

// We import 'pg' dynamically to avoid crashing if the user hasn't run 'npm i pg' yet
let pgPool = null;
let isPostgres = false;

// Initialize Database connection
async function initDb() {
  if (pgPool) return { isPostgres, pgPool };

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      console.log('[Database] DATABASE_URL detected, attempting to connect to PostgreSQL...');
      const pg = await import('pg');
      const { Pool } = pg.default || pg;
      
      pgPool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('supabase') || dbUrl.includes('neon') || dbUrl.includes('amazonaws')
          ? { rejectUnauthorized: false }
          : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      // Test connection and auto-migrate
      const client = await pgPool.connect();
      try {
        console.log('[Database] Connected to PostgreSQL. Running self-healing migrations...');
        await migrate(client);
        isPostgres = true;
        console.log('[Database] PostgreSQL database is ready and fully migrated.');
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[Database] Failed to connect to PostgreSQL or load pg driver:', error.message);
      console.warn('[Database] FALLBACK: Reverting to local file-based database (server_db.json).');
      pgPool = null;
      isPostgres = false;
    }
  } else {
    console.log('[Database] No DATABASE_URL found. Using local file-based database (server_db.json).');
    isPostgres = false;
  }
  return { isPostgres, pgPool };
}

// Database schema migration
async function migrate(client) {
  // 1. Users table
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      image TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Projects table (with foreign key to users)
  await client.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      manga_url TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  // 3. Pages table (with foreign key to projects)
  await client.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id VARCHAR(255) PRIMARY KEY,
      project_id VARCHAR(255) REFERENCES projects(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      image_src TEXT NOT NULL,
      image_type VARCHAR(50) DEFAULT 'file',
      novel_text TEXT DEFAULT '',
      status VARCHAR(50) DEFAULT 'pending',
      logs TEXT DEFAULT ''
    );
  `);

  // 4. User API Keys table (with foreign key to users)
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      configs TEXT NOT NULL, -- Encrypted or serialized configuration JSON
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Add storage_configs column if it doesn't exist (Self-healing migration)
  await client.query(`
    ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS storage_configs TEXT;
  `);
}

// ==========================================
// LOCAL FILE DATABASE HELPER (FALLBACK MODE)
// ==========================================
const HARDCODED_CONFIGS = [
  {
    "id": "ff048d5b-3a35-4e2f-9243-ae021828bdf8",
    "name": "Grok Key 1",
    "apiKey": "xai-dummy-placeholder-key-please-replace-in-settings",
    "provider": "grok",
    "model": "grok-4.3",
    "baseUrl": "https://api.x.ai/v1"
  }
];

const DEFAULT_DB = {
  projects: [],
  pages: [],
  configs: { 
    configs: HARDCODED_CONFIGS, 
    activeConfigId: 'ff048d5b-3a35-4e2f-9243-ae021828bdf8', 
    useApiPool: true, 
    poolConfigIds: HARDCODED_CONFIGS.map(c => c.id) 
  }
};

async function readLocalDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      await fs.promises.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
      return structuredClone(DEFAULT_DB);
    }
    const data = await fs.promises.readFile(DB_FILE, 'utf8');
    if (!data || !data.trim()) {
      return structuredClone(DEFAULT_DB);
    }
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading local file DB:', error);
    return structuredClone(DEFAULT_DB);
  }
}

async function writeLocalDb(data) {
  try {
    const serialized = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(DB_TEMP_FILE, serialized, 'utf8');
    await fs.promises.rename(DB_TEMP_FILE, DB_FILE);
  } catch (error) {
    console.error('Error writing local file DB:', error);
  }
}

// ==========================================
// CORE DATABASE FUNCTIONS (EXPORTED APIs)
// ==========================================

// Global Default User ID for local development or guest sessions
const DEFAULT_USER_ID = 'dev-guest-user';

/**
 * Sync Google profile into PostgreSQL users table
 */
export async function upsertUser({ id, name, email, image }) {
  const { isPostgres, pgPool } = await initDb();
  if (isPostgres) {
    await pgPool.query(
      `INSERT INTO users (id, name, email, image) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (id) 
       DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image`,
      [id, name, email, image]
    );
  }
  return { id, name, email, image };
}

export async function createProject(title, mangaUrl = '', userId = DEFAULT_USER_ID) {
  const { isPostgres, pgPool } = await initDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  if (isPostgres) {
    // Make sure the default user exists in Postgres
    if (userId === DEFAULT_USER_ID) {
      await upsertUser({ id: DEFAULT_USER_ID, name: 'Guest Developer', email: 'guest@manga2novel.local', image: '' });
    }

    await pgPool.query(
      `INSERT INTO projects (id, user_id, title, manga_url, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, title, mangaUrl, now, now]
    );
    return { id, user_id: userId, title, mangaUrl, createdAt: now, updatedAt: now };
  } else {
    const db = await readLocalDb();
    const newProject = { id, title, mangaUrl, createdAt: now, updatedAt: now };
    db.projects.push(newProject);
    await writeLocalDb(db);
    return newProject;
  }
}

export async function getProjects(userId = DEFAULT_USER_ID) {
  const { isPostgres, pgPool } = await initDb();
  if (isPostgres) {
    const res = await pgPool.query(
      `SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map(row => ({
      id: row.id,
      title: row.title,
      mangaUrl: row.manga_url,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      userId: row.user_id
    }));
  } else {
    const db = await readLocalDb();
    return [...db.projects].sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export async function getProject(id, userId = DEFAULT_USER_ID) {
  const { isPostgres, pgPool } = await initDb();
  if (isPostgres) {
    const res = await pgPool.query(
      `SELECT * FROM projects WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      title: row.title,
      mangaUrl: row.manga_url,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      userId: row.user_id
    };
  } else {
    const db = await readLocalDb();
    return db.projects.find(p => p.id === id) || null;
  }
}

export async function deleteProject(id, userId = DEFAULT_USER_ID) {
  const { isPostgres, pgPool } = await initDb();
  if (isPostgres) {
    await pgPool.query(
      `DELETE FROM projects WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return { success: true };
  } else {
    const db = await readLocalDb();
    db.projects = db.projects.filter(p => p.id !== id);
    db.pages = db.pages.filter(p => p.projectId !== id);
    await writeLocalDb(db);
    return { success: true };
  }
}

export async function updateProject(id, updates, userId = DEFAULT_USER_ID) {
  const { isPostgres, pgPool } = await initDb();
  const now = Date.now();

  if (isPostgres) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (updates.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(updates.title);
    }
    if (updates.mangaUrl !== undefined) {
      fields.push(`manga_url = $${idx++}`);
      values.push(updates.mangaUrl);
    }
    fields.push(`updated_at = $${idx++}`);
    values.push(now);

    values.push(id);
    values.push(userId);

    const query = `
      UPDATE projects 
      SET ${fields.join(', ')} 
      WHERE id = $${idx++} AND user_id = $${idx}
      RETURNING *
    `;

    const res = await pgPool.query(query, values);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      title: row.title,
      mangaUrl: row.manga_url,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      userId: row.user_id
    };
  } else {
    const db = await readLocalDb();
    db.projects = db.projects.map(p => {
      if (p.id === id) {
        return { ...p, ...updates, updatedAt: now };
      }
      return p;
    });
    await writeLocalDb(db);
    return db.projects.find(p => p.id === id) || null;
  }
}

export async function addPage({ projectId, pageNumber, imageSrc, imageType = 'file' }) {
  const { isPostgres, pgPool } = await initDb();
  const id = crypto.randomUUID();

  if (isPostgres) {
    await pgPool.query(
      `INSERT INTO pages (id, project_id, page_number, image_src, image_type, novel_text, status, logs) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, projectId, parseInt(pageNumber, 10), imageSrc, imageType, '', 'pending', '']
    );
    return { id, projectId, pageNumber, imageSrc, imageType, novelText: '', status: 'pending', logs: '' };
  } else {
    const db = await readLocalDb();
    const newPage = {
      id,
      projectId,
      pageNumber: parseInt(pageNumber, 10),
      imageSrc,
      imageType,
      novelText: '',
      status: 'pending',
      logs: ''
    };
    db.pages.push(newPage);
    await writeLocalDb(db);
    return newPage;
  }
}

export async function getPagesForProject(projectId) {
  const { isPostgres, pgPool } = await initDb();
  if (isPostgres) {
    const res = await pgPool.query(
      `SELECT * FROM pages WHERE project_id = $1 ORDER BY page_number ASC`,
      [projectId]
    );
    return res.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      pageNumber: row.page_number,
      imageSrc: row.image_src,
      imageType: row.image_type,
      novelText: row.novel_text,
      status: row.status,
      logs: row.logs
    }));
  } else {
    const db = await readLocalDb();
    return db.pages
      .filter(p => p.projectId === projectId)
      .sort((a, b) => a.pageNumber - b.pageNumber);
  }
}

/**
 * Automatically uploads page image and novel text to user's S3 bucket when page is completed.
 * Modifies 'updates' object in-place so database fields are updated with public S3 URLs.
 */
/**
 * Automatically uploads page image and novel text to selected cloud/server/device storage when page is completed.
 * Modifies 'updates' object in-place so database fields are updated with direct static/cloud URLs.
 */
async function handleStorageUploadHook(pageId, updates, isPostgres, pgPool) {
  if (updates.status !== 'completed') return;

  try {
    let projectId = null;
    let pageNumber = null;
    let imageSrc = null;
    let imageType = null;
    let userId = DEFAULT_USER_ID;

    // 1. Fetch current page details
    if (isPostgres) {
      const pageRes = await pgPool.query('SELECT project_id, page_number, image_src, image_type FROM pages WHERE id = $1', [pageId]);
      if (pageRes.rows.length === 0) return;
      const page = pageRes.rows[0];
      projectId = page.project_id;
      pageNumber = page.page_number;
      imageSrc = page.image_src;
      imageType = page.image_type;

      // Find user_id from projects table
      const projRes = await pgPool.query('SELECT user_id FROM projects WHERE id = $1', [projectId]);
      if (projRes.rows.length > 0) {
        userId = projRes.rows[0].user_id;
      }
    } else {
      const db = await readLocalDb();
      const page = db.pages.find(p => p.id === pageId);
      if (!page) return;
      projectId = page.projectId;
      pageNumber = page.pageNumber;
      imageSrc = page.imageSrc;
      imageType = page.imageType;
    }

    // 2. Fetch Storage configurations
    const storageConfigs = await getStorageConfigs(userId, true);
    const storageType = storageConfigs.type || 'device'; // default to 'device'

    // ==========================================
    // STRATEGY A: SELF-HOSTED VPS STORAGE (SERVER LOCAL DISK / NFS / REMOTE API)
    // ==========================================
    if (storageType === 'server') {
      const isRemote = storageConfigs.endpoint && (storageConfigs.endpoint.startsWith('http://') || storageConfigs.endpoint.startsWith('https://'));
      
      if (isRemote) {
        console.log(`[Storage Hook] Strategy: Server VPS (Remote). Uploading assets to Remote VPS Storage at ${storageConfigs.endpoint}...`);
        
        let mimeType = 'image/jpeg';
        let base64Image = null;
        
        if (imageSrc.startsWith('data:')) {
          base64Image = imageSrc;
        } else {
          // Convert remote image URL to base64 so we can push it
          const response = await fetch(imageSrc);
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            mimeType = response.headers.get('content-type') || 'image/jpeg';
            base64Image = `data:${mimeType};base64,${buffer.toString('base64')}`;
          }
        }
        
        if (base64Image) {
          // Call Remote Storage API
          const payload = {
            projectId,
            pageNumber,
            pageId,
            imageBase64: base64Image,
            novelText: updates.novelText || '',
            secretToken: storageConfigs.secretAccessKey // Automatically decrypted on server-side
          };
          
          const uploadResponse = await fetch(storageConfigs.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
          });
          
          if (uploadResponse.ok) {
            const resData = await uploadResponse.json();
            // The Remote VPS Storage API should return the public URL where the asset is served
            if (resData.imageSrc) {
              updates.imageSrc = resData.imageSrc;
              updates.imageType = 'url';
              console.log(`[Storage Hook] Remote VPS upload succeeded! Public URL: ${updates.imageSrc}`);
            }
          } else {
            const errorMsg = await uploadResponse.text();
            throw new Error(`Remote VPS storage server returned error: ${errorMsg}`);
          }
        }
        return;
      }
      
      // Default to Local/NFS Storage (Case 3.1)
      console.log(`[Storage Hook] Strategy: Server VPS (Local/NFS). Saving page assets locally on VPS App Server...`);
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'projects', projectId);
      const pagesDir = path.join(uploadDir, 'pages');
      const novelsDir = path.join(uploadDir, 'novels');

      await fs.promises.mkdir(pagesDir, { recursive: true });
      await fs.promises.mkdir(novelsDir, { recursive: true });

      let mimeType = 'image/jpeg';
      let buffer = null;

      if (imageSrc.startsWith('data:')) {
        const parts = imageSrc.split(',');
        buffer = Buffer.from(parts[1], 'base64');
        mimeType = imageSrc.match(/data:(.*?);/)?.[1] || 'image/jpeg';
      } else {
        const response = await fetch(imageSrc);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
          mimeType = response.headers.get('content-type') || 'image/jpeg';
        }
      }

      if (buffer) {
        const ext = mimeType.split('/')[1] || 'jpg';
        const pageFileName = `page_${pageNumber}_${pageId}.${ext}`;
        const pageFilePath = path.join(pagesDir, pageFileName);
        await fs.promises.writeFile(pageFilePath, buffer);

        // Save novel text as file
        if (updates.novelText) {
          const textFilePath = path.join(novelsDir, `page_${pageNumber}_${pageId}.txt`);
          await fs.promises.writeFile(textFilePath, updates.novelText);
        }

        // Set static URL served by Next.js
        updates.imageSrc = `/uploads/projects/${projectId}/pages/${pageFileName}`;
        updates.imageType = 'url';
        console.log(`[Storage Hook] Server local/NFS upload completed successfully! URL: ${updates.imageSrc}`);
      }
      return;
    }

    // ==========================================
    // STRATEGY B: BRING YOUR OWN STORAGE (CLOUD S3/R2)
    // ==========================================
    if (storageType === 'cloud') {
      const { isS3ConfigValid, uploadToUserS3 } = await import('./s3');
      if (!isS3ConfigValid(storageConfigs)) {
        console.log('[Storage Hook] Strategy: Cloud Storage. S3 configurations are not set. Skipping Cloud S3 upload.');
        return;
      }

      const isAlreadyUploaded = imageSrc && imageSrc.includes(storageConfigs.bucketName);
      let finalS3ImageUrl = imageSrc;

      if (!isAlreadyUploaded) {
        console.log(`[Storage Hook] Uploading manga page ${pageNumber} image to user's Cloud Storage...`);
        let buffer = null;
        let mimeType = 'image/jpeg';

        if (imageSrc.startsWith('data:')) {
          const parts = imageSrc.split(',');
          buffer = Buffer.from(parts[1], 'base64');
          mimeType = imageSrc.match(/data:(.*?);/)?.[1] || 'image/jpeg';
        } else {
          const response = await fetch(imageSrc);
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
            mimeType = response.headers.get('content-type') || 'image/jpeg';
          }
        }

        if (buffer) {
          const ext = mimeType.split('/')[1] || 'jpg';
          const s3ImageKey = `manga2novel/projects/${projectId}/pages/page_${pageNumber}_${pageId}.${ext}`;
          finalS3ImageUrl = await uploadToUserS3(buffer, s3ImageKey, mimeType, storageConfigs);
          
          updates.imageSrc = finalS3ImageUrl;
          updates.imageType = 'url';
        }
      }

      if (updates.novelText) {
        console.log(`[Storage Hook] Uploading page ${pageNumber} novel text to user's Cloud Storage...`);
        const textBuffer = Buffer.from(updates.novelText);
        const s3TextKey = `manga2novel/projects/${projectId}/novels/page_${pageNumber}_${pageId}.txt`;
        await uploadToUserS3(textBuffer, s3TextKey, 'text/plain', storageConfigs);
      }
      return;
    }

    // ==========================================
    // STRATEGY C: LOCAL DEVICE STORAGE (DEVICE)
    // ==========================================
    if (storageType === 'device') {
      console.log(`[Storage Hook] Strategy: Device local storage. Skipping S3/Server write. Files will be managed in-browser.`);
      return;
    }

  } catch (err) {
    console.error('[Storage Hook] Failed to execute storage upload background task:', err.message);
  }
}

export async function updatePage(pageId, updates) {
  const { isPostgres, pgPool } = await initDb();
  
  // Trigger dynamic storage upload hook if page translation is completed
  await handleStorageUploadHook(pageId, updates, isPostgres, pgPool);
  
  let projectId = null;

  if (isPostgres) {
    // Find project ID first to touch the project's updatedAt
    const pageRes = await pgPool.query('SELECT project_id FROM pages WHERE id = $1', [pageId]);
    if (pageRes.rows.length > 0) {
      projectId = pageRes.rows[0].project_id;
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (updates.pageNumber !== undefined) {
      fields.push(`page_number = $${idx++}`);
      values.push(parseInt(updates.pageNumber, 10));
    }
    if (updates.imageSrc !== undefined) {
      fields.push(`image_src = $${idx++}`);
      values.push(updates.imageSrc);
    }
    if (updates.imageType !== undefined) {
      fields.push(`image_type = $${idx++}`);
      values.push(updates.imageType);
    }
    if (updates.novelText !== undefined) {
      fields.push(`novel_text = $${idx++}`);
      values.push(updates.novelText);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.logs !== undefined) {
      fields.push(`logs = $${idx++}`);
      values.push(updates.logs);
    }

    values.push(pageId);

    const query = `
      UPDATE pages 
      SET ${fields.join(', ')} 
      WHERE id = $${idx}
      RETURNING *
    `;

    const res = await pgPool.query(query, values);
    
    // Touch project's updatedAt
    if (projectId) {
      await pgPool.query('UPDATE projects SET updated_at = $1 WHERE id = $2', [Date.now(), projectId]);
    }

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      projectId: row.project_id,
      pageNumber: row.page_number,
      imageSrc: row.image_src,
      imageType: row.image_type,
      novelText: row.novel_text,
      status: row.status,
      logs: row.logs
    };
  } else {
    const db = await readLocalDb();
    db.pages = db.pages.map(p => {
      if (p.id === pageId) {
        projectId = p.projectId;
        return { ...p, ...updates };
      }
      return p;
    });

    if (projectId) {
      db.projects = db.projects.map(p => {
        if (p.id === projectId) {
          return { ...p, updatedAt: Date.now() };
        }
        return p;
      });
    }

    await writeLocalDb(db);
    return db.pages.find(p => p.id === pageId) || null;
  }
}

export async function deletePage(pageId) {
  const { isPostgres, pgPool } = await initDb();
  if (isPostgres) {
    const pageRes = await pgPool.query('SELECT project_id FROM pages WHERE id = $1', [pageId]);
    if (pageRes.rows.length === 0) return { success: true };
    const projectId = pageRes.rows[0].project_id;

    // Delete the page
    await pgPool.query('DELETE FROM pages WHERE id = $1', [pageId]);

    // Reorder pages
    const pagesRes = await pgPool.query('SELECT id FROM pages WHERE project_id = $1 ORDER BY page_number ASC', [projectId]);
    for (let i = 0; i < pagesRes.rows.length; i++) {
      await pgPool.query('UPDATE pages SET page_number = $1 WHERE id = $2', [i + 1, pagesRes.rows[i].id]);
    }

    // Touch project
    await pgPool.query('UPDATE projects SET updated_at = $1 WHERE id = $2', [Date.now(), projectId]);
    return { success: true };
  } else {
    const db = await readLocalDb();
    const targetPage = db.pages.find(p => p.id === pageId);
    if (targetPage) {
      const projectId = targetPage.projectId;
      db.pages = db.pages.filter(p => p.id !== pageId);
      
      const projectPages = db.pages
        .filter(p => p.projectId === projectId)
        .sort((a, b) => a.pageNumber - b.pageNumber);
      
      projectPages.forEach((p, idx) => {
        p.pageNumber = idx + 1;
      });

      db.pages = db.pages.map(p => {
        const reordered = projectPages.find(rp => rp.id === p.id);
        return reordered ? reordered : p;
      });

      db.projects = db.projects.map(p => {
        if (p.id === projectId) {
          return { ...p, updatedAt: Date.now() };
        }
        return p;
      });

      await writeLocalDb(db);
    }
    return { success: true };
  }
}

/**
 * Helper to check if a string is encrypted using AES-256-GCM format 'iv:authTag:encryptedText'
 */
function isEncrypted(str) {
  if (!str) return false;
  const parts = str.split(':');
  return parts.length === 3 && parts[0].length === 24 && parts[1].length === 32;
}

/**
 * Retrieve User API Configurations
 */
export async function getApiConfigs(userId = DEFAULT_USER_ID, returnRawDecrypted = false) {
  const { isPostgres, pgPool } = await initDb();
  let dbConfigs = null;

  if (isPostgres) {
    const res = await pgPool.query(
      `SELECT configs FROM user_api_keys WHERE user_id = $1`,
      [userId]
    );
    if (res.rows.length > 0) {
      try {
        dbConfigs = JSON.parse(res.rows[0].configs);
      } catch (e) {
        console.error('Failed to parse API configs JSON from Postgres:', e);
      }
    }
  } else {
    const db = await readLocalDb();
    dbConfigs = db.configs;
  }

  // If no config exists, return default
  if (!dbConfigs || !dbConfigs.configs) {
    dbConfigs = structuredClone(DEFAULT_DB.configs);
  }

  // Deep clone to avoid mutating original arrays
  const resultConfigs = structuredClone(dbConfigs);

  // Process apiKeys (decrypt or mask)
  resultConfigs.configs = resultConfigs.configs.map(config => {
    let key = config.apiKey || '';
    let decryptedKey = key;

    if (isEncrypted(key)) {
      try {
        decryptedKey = decrypt(key);
      } catch (e) {
        console.error(`Failed to decrypt key for config ${config.id}:`, e.message);
        decryptedKey = ''; // set to empty if decryption fails
      }
    }

    if (returnRawDecrypted) {
      return { ...config, apiKey: decryptedKey };
    } else {
      // Return masked key for UI display
      return { ...config, apiKey: decryptedKey ? '••••••••••••' : '' };
    }
  });

  return resultConfigs;
}

/**
 * Save User API Configurations
 */
export async function saveApiConfigs(userId = DEFAULT_USER_ID, { configs, activeConfigId, useApiPool, poolConfigIds }) {
  const { isPostgres, pgPool } = await initDb();
  
  // 1. Fetch old configs WITH raw decrypted keys
  const oldConfigs = await getApiConfigs(userId, true);
  
  // 2. Process each new config
  const processedConfigs = configs.map(config => {
    const matchedOld = oldConfigs.configs?.find(oc => oc.id === config.id);
    let finalKey = config.apiKey || '';

    // Check if new key is masked
    const isMasked = finalKey.includes('•') || !finalKey;

    if (isMasked) {
      // Keep old decrypted key
      finalKey = matchedOld ? matchedOld.apiKey : '';
    }

    // Now encrypt the final key if it exists and is not already encrypted
    let encryptedKey = '';
    if (finalKey) {
      encryptedKey = isEncrypted(finalKey) ? finalKey : encrypt(finalKey);
    }

    return {
      ...config,
      apiKey: encryptedKey
    };
  });

  const configsObj = { 
    configs: processedConfigs, 
    activeConfigId, 
    useApiPool, 
    poolConfigIds 
  };
  const serialized = JSON.stringify(configsObj);

  if (isPostgres) {
    const id = crypto.randomUUID();
    await pgPool.query(
      `INSERT INTO user_api_keys (id, user_id, configs, updated_at) 
       VALUES ($1, $2, $3, NOW()) 
       ON CONFLICT (user_id) 
       DO UPDATE SET configs = EXCLUDED.configs, updated_at = NOW()`,
      [id, userId, serialized]
    );
  } else {
    const db = await readLocalDb();
    db.configs = configsObj;
    await writeLocalDb(db);
  }

  // Return masked version for safety
  return await getApiConfigs(userId, false);
}

/**
 * Retrieve User Cloud Storage Configurations (S3)
 */
export async function getStorageConfigs(userId = DEFAULT_USER_ID, returnRawDecrypted = false) {
  const { isPostgres, pgPool } = await initDb();
  let storageSerialized = null;

  if (isPostgres) {
    const res = await pgPool.query(
      `SELECT storage_configs FROM user_api_keys WHERE user_id = $1`,
      [userId]
    );
    if (res.rows.length > 0) {
      storageSerialized = res.rows[0].storage_configs;
    }
  } else {
    const db = await readLocalDb();
    storageSerialized = db.storageConfigs;
  }

  if (!storageSerialized) {
    return { endpoint: '', region: '', bucketName: '', accessKeyId: '', secretAccessKey: '' };
  }

  let configsObj = {};
  try {
    configsObj = JSON.parse(storageSerialized);
  } catch (e) {
    console.error('Failed to parse Storage configs JSON:', e);
    return { endpoint: '', region: '', bucketName: '', accessKeyId: '', secretAccessKey: '' };
  }

  // Decrypt sensitive credentials
  const decryptedConfigs = { ...configsObj };
  if (decryptedConfigs.accessKeyId && isEncrypted(decryptedConfigs.accessKeyId)) {
    try { decryptedConfigs.accessKeyId = decrypt(decryptedConfigs.accessKeyId); } catch (e) { decryptedConfigs.accessKeyId = ''; }
  }
  if (decryptedConfigs.secretAccessKey && isEncrypted(decryptedConfigs.secretAccessKey)) {
    try { decryptedConfigs.secretAccessKey = decrypt(decryptedConfigs.secretAccessKey); } catch (e) { decryptedConfigs.secretAccessKey = ''; }
  }

  if (returnRawDecrypted) {
    return decryptedConfigs;
  } else {
    // Mask sensitive keys for UI display
    return {
      ...decryptedConfigs,
      accessKeyId: decryptedConfigs.accessKeyId ? '••••••••••••' : '',
      secretAccessKey: decryptedConfigs.secretAccessKey ? '••••••••••••' : ''
    };
  }
}

/**
 * Save User Cloud Storage Configurations (S3)
 */
export async function saveStorageConfigs(userId = DEFAULT_USER_ID, storageConfigs) {
  const { isPostgres, pgPool } = await initDb();
  
  // 1. Fetch old credentials to check for masking
  const oldConfigs = await getStorageConfigs(userId, true);

  let accessKeyId = storageConfigs.accessKeyId || '';
  let secretAccessKey = storageConfigs.secretAccessKey || '';

  // Keep old credentials if new input is masked
  if (accessKeyId.includes('•') || !accessKeyId) {
    accessKeyId = oldConfigs.accessKeyId || '';
  }
  if (secretAccessKey.includes('•') || !secretAccessKey) {
    secretAccessKey = oldConfigs.secretAccessKey || '';
  }

  // Encrypt keys
  const encryptedAccessKey = accessKeyId ? (isEncrypted(accessKeyId) ? accessKeyId : encrypt(accessKeyId)) : '';
  const encryptedSecretAccessKey = secretAccessKey ? (isEncrypted(secretAccessKey) ? secretAccessKey : encrypt(secretAccessKey)) : '';

  const configsObj = {
    type: storageConfigs.type || 'device',
    endpoint: storageConfigs.endpoint || '',
    region: storageConfigs.region || '',
    bucketName: storageConfigs.bucketName || '',
    accessKeyId: encryptedAccessKey,
    secretAccessKey: encryptedSecretAccessKey
  };

  const serialized = JSON.stringify(configsObj);

  if (isPostgres) {
    const id = crypto.randomUUID();
    await pgPool.query(
      `INSERT INTO user_api_keys (id, user_id, configs, storage_configs, updated_at) 
       VALUES ($1, $2, '{"configs":[],"activeConfigId":"","useApiPool":false,"poolConfigIds":[]}', $3, NOW()) 
       ON CONFLICT (user_id) 
       DO UPDATE SET storage_configs = EXCLUDED.storage_configs, updated_at = NOW()`,
      [id, userId, serialized]
    );
  } else {
    const db = await readLocalDb();
    db.storageConfigs = serialized;
    await writeLocalDb(db);
  }

  // Return masked version for safety
  return await getStorageConfigs(userId, false);
}
