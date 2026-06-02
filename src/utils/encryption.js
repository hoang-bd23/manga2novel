import crypto from 'crypto';

// Get encryption key from environment variable
// Self-healing: if the key is not set or not 32 bytes, we derive a stable 32-byte key using SHA-256
const getSecretKey = () => {
  const envKey = process.env.ENCRYPTION_KEY || 'manga2novel-default-development-secret-key-32chars!';
  return crypto.createHash('sha256').update(envKey).digest();
};

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes is standard for GCM

/**
 * Encrypts a plain text string using AES-256-GCM
 * @param {string} text - The text to encrypt
 * @returns {string} The encrypted string in format 'iv:authTag:encryptedText'
 */
export function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getSecretKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Format: iv:authTag:encryptedContent
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Mã hóa dữ liệu thất bại. Vui lòng kiểm tra cấu hình ENCRYPTION_KEY.');
  }
}

/**
 * Decrypts a cipher text string using AES-256-GCM
 * @param {string} encryptedData - The encrypted string in format 'iv:authTag:encryptedText'
 * @returns {string} The decrypted plain text
 */
export function decrypt(encryptedData) {
  if (!encryptedData) return '';
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Định dạng dữ liệu mã hóa không hợp lệ');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    const key = getSecretKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Giải mã dữ liệu thất bại. Khóa mã hóa không hợp lệ hoặc dữ liệu bị hỏng.');
  }
}
