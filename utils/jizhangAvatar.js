/**
 * 【功能描述】
 * 将 Base64 头像上传至 Supabase Storage，失败时回退为内联 data URL。
 *
 * 【业务逻辑】
 * 1. 校验图片格式与大小（最大 2MB）。
 * 2. 优先上传至 jizhang-avatars 桶并返回公开 URL；无 service key 或上传失败时保留 Base64。
 * 3. 内联回退时限制 200KB 以内，避免数据库字段过大。
 *
 * 【技术实现】
 * - 涉及方法：uploadAvatarFromBase64
 * - 涉及知识点：Base64 解析、Supabase Storage upload/getPublicUrl、Buffer 大小校验
 */
async function uploadAvatarFromBase64(userId, base64Data) {
  const matches = String(base64Data).match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    throw new Error('无效的图片格式，请重新选择');
  }

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');

  if (buffer.length > 2 * 1024 * 1024) {
    throw new Error('图片不能超过 2MB');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    if (buffer.length > 200 * 1024) {
      throw new Error('图片过大，请压缩后重试');
    }
    return base64Data;
  }

  const { createClient } = require('@supabase/supabase-js');
  const admin = createClient(process.env.SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const path = `${userId}/avatar.${ext}`;
  const { error } = await admin.storage
    .from('jizhang-avatars')
    .upload(path, buffer, {
      contentType: `image/${matches[1]}`,
      upsert: true,
    });

  if (error) {
    console.warn('头像上传 Storage 失败，使用内联存储:', error.message);
    if (buffer.length > 200 * 1024) {
      throw new Error('头像上传失败，请压缩图片或配置 Storage 桶 jizhang-avatars');
    }
    return base64Data;
  }

  const { data } = admin.storage.from('jizhang-avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/**
 * 【功能描述】
 * 校验用户昵称长度，允许微信常见特殊字符。
 *
 * 【业务逻辑】
 * 1. 去除首尾空白后长度须在 1–32 字符之间。
 * 2. 不做字符集限制，兼容微信昵称中的 ·、@ 等符号。
 *
 * 【技术实现】
 * - 涉及方法：validateNickname
 * - 涉及知识点：字符串 trim、长度边界校验、统一返回 { ok, message/value }
 */
function validateNickname(nickname) {
  const name = String(nickname || '').trim();
  if (name.length < 1 || name.length > 32) {
    return { ok: false, message: '昵称长度为 1-32 个字符' };
  }
  // 允许微信昵称中的特殊符号（· @ 等），仅做长度校验
  return { ok: true, value: name };
}

module.exports = { uploadAvatarFromBase64, validateNickname };
