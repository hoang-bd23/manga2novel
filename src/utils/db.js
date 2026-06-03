// Centralized Server-Side Database RPC Client
// Preserves 100% of previous IndexedDB method signatures but routes data through Next.js server
// to enable seamless sharing of projects, history, and keys across multiple devices on the network.

async function callDbApi(action, params = {}) {
  try {
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, params })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.result;
  } catch (error) {
    console.error(`Database Central RPC Error [${action}]:`, error);
    throw error;
  }
}

// Helper functions for Projects
export async function createProject(title, mangaUrl = '') {
  return await callDbApi('createProject', { title, mangaUrl });
}

export async function getProjects() {
  return await callDbApi('getProjects');
}

export async function getProject(id) {
  return await callDbApi('getProject', { id });
}

export async function deleteProject(id) {
  return await callDbApi('deleteProject', { id });
}

export async function updateProject(id, updates) {
  return await callDbApi('updateProject', { id, updates });
}

// Helper functions for Pages
export async function addPage(projectId, pageNumber, imageSrc, imageType = 'file') {
  return await callDbApi('addPage', { projectId, pageNumber, imageSrc, imageType });
}

export async function getPagesForProject(projectId) {
  return await callDbApi('getPagesForProject', { projectId });
}

export async function updatePage(pageId, updates) {
  return await callDbApi('updatePage', { pageId, updates });
}

export async function deletePage(pageId) {
  return await callDbApi('deletePage', { pageId });
}

// Global API configs sync
export async function getApiConfigs() {
  return await callDbApi('getApiConfigs');
}

export async function saveApiConfigs(configs, activeConfigId, useApiPool, poolConfigIds) {
  return await callDbApi('saveApiConfigs', { configs, activeConfigId, useApiPool, poolConfigIds });
}

// User S3 Cloud Storage configs sync
export async function getStorageConfigs() {
  return await callDbApi('getStorageConfigs');
}

export async function saveStorageConfigs(storageConfigs) {
  return await callDbApi('saveStorageConfigs', storageConfigs);
}

export async function testS3Connection(storageConfigs) {
  return await callDbApi('testS3Connection', storageConfigs);
}

// ==========================================
// AI POST-PROCESSING — Character Analysis & Honorific Refinement
// ==========================================

/**
 * Analyzes all translated pages to identify characters and relationships.
 * Saves results to project.characterAnalysis and auto-fills project.glossary.pronouns.
 */
export async function analyzeCharacters(projectId) {
  const res = await fetch('/api/analyze-characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * Rewrites all translated pages to ensure consistent Vietnamese honorifics.
 * Uses parallel key distribution with 2s delay per key for rate-limit safety.
 */
export async function refineHonorifics(projectId) {
  const res = await fetch('/api/refine-honorifics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}
