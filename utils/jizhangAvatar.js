/**
 * 头像上传至 Supabase Storage，失败时回退为 data URL
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

function validateNickname(nickname) {
  const name = String(nickname || '').trim();
  if (name.length < 2 || name.length > 20) {
    return { ok: false, message: '昵称长度为 2-20 个字符' };
  }
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+$/.test(name)) {
    return { ok: false, message: '昵称仅支持中文、字母、数字、下划线和空格' };
  }
  return { ok: true, value: name };
}

module.exports = { uploadAvatarFromBase64, validateNickname };
