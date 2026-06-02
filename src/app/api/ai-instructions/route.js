import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Read ai_instructions.txt from project root directory
    const filePath = path.join(process.cwd(), 'ai_instructions.txt');
    
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return NextResponse.json({ instructions: content });
    }
    
    return NextResponse.json({ instructions: '' });
  } catch (error) {
    console.error('Error reading ai_instructions.txt:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
