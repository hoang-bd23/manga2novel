import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/utils/auth';
import * as db from '@/utils/db-server';

export async function POST(req) {
  try {
    const { action, params } = await req.json();
    
    // Retrieve NextAuth user session
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id || 'dev-guest-user';

    let result = null;

    switch (action) {
      case 'createProject': {
        const { title, mangaUrl } = params;
        result = await db.createProject(title, mangaUrl, userId);
        break;
      }
      case 'getProjects': {
        result = await db.getProjects(userId);
        break;
      }
      case 'getProject': {
        const { id } = params;
        result = await db.getProject(id, userId);
        break;
      }
      case 'deleteProject': {
        const { id } = params;
        result = await db.deleteProject(id, userId);
        break;
      }
      case 'updateProject': {
        const { id, updates } = params;
        result = await db.updateProject(id, updates, userId);
        break;
      }
      case 'addPage': {
        const { projectId, pageNumber, imageSrc, imageType } = params;
        result = await db.addPage({ projectId, pageNumber, imageSrc, imageType });
        break;
      }
      case 'getPagesForProject': {
        const { projectId } = params;
        result = await db.getPagesForProject(projectId);
        break;
      }
      case 'updatePage': {
        const { pageId, updates } = params;
        result = await db.updatePage(pageId, updates);
        break;
      }
      case 'deletePage': {
        const { pageId } = params;
        result = await db.deletePage(pageId);
        break;
      }
      case 'getApiConfigs': {
        // Return masked API configs to the frontend UI
        result = await db.getApiConfigs(userId, false);
        break;
      }
      case 'saveApiConfigs': {
        const { configs, activeConfigId, useApiPool, poolConfigIds } = params;
        result = await db.saveApiConfigs(userId, { configs, activeConfigId, useApiPool, poolConfigIds });
        break;
      }
      case 'getStorageConfigs': {
        // Return masked S3 configurations to the frontend UI
        result = await db.getStorageConfigs(userId, false);
        break;
      }
      case 'saveStorageConfigs': {
        result = await db.saveStorageConfigs(userId, params);
        break;
      }
      case 'testS3Connection': {
        const { testS3Connection } = await import('@/utils/s3');
        let storageConfigs = params;
        if (!storageConfigs.accessKeyId || storageConfigs.accessKeyId.includes('•')) {
          storageConfigs = await db.getStorageConfigs(userId, true);
        }
        result = await testS3Connection(storageConfigs);
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error('Error in Database API endpoint:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
