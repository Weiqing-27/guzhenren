const express = require('express');
const { encryptStorage, decryptStorage } = require('../../utils/journalCrypto');
const {
  getDb,
  fail,
  ok,
  unwrapRequest,
  resolveSpace,
  rejectExpiredScope,
  toEntryDto,
} = require('./helpers');

const router = express.Router();
router.use(unwrapRequest);

/**
 * 【功能描述】
 * 安全解密库内字段，失败时返回空串避免 500 泄露。
 *
 * 【业务逻辑】
 * 存储密文损坏时按空内容处理。
 *
 * 【技术实现】
 * - 涉及方法：decryptStorage
 * - 涉及知识点：解密容错
 */
function safeDecryptField(cipher, space) {
  if (!cipher) return '';
  try {
    return decryptStorage(cipher, space);
  } catch (error) {
    console.error('存储解密失败:', error.message);
    return '';
  }
}

/**
 * 【功能描述】
 * 分页列出当前空间日记，强制 space_type 过滤。
 *
 * 【业务逻辑】
 * 1. 无内层令牌只查 public；
 * 2. 支持心情/分类/收藏/归档/日期筛选；
 * 3. 按 diary_date、updated_at 倒序。
 *
 * 【技术实现】
 * - 涉及方法：supabase range/order/eq
 * - 涉及知识点：空间隔离查询、分页
 */
router.get('/', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const db = getDb(req);
  const user = req.journalUser;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;
  const { mood, category, favorite, archived, dateFrom, dateTo } = req.query;

  try {
    let query = db
      .from('journal_entries')
      .select(
        'id, mood, category, diary_date, is_favorite, is_archived, title_cipher, content_cipher, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('user_id', user.id)
      .eq('space_type', space)
      .order('diary_date', { ascending: false })
      .order('updated_at', { ascending: false });

    if (mood) query = query.eq('mood', mood);
    if (category) query = query.eq('category', category);
    if (favorite === 'true' || favorite === '1') query = query.eq('is_favorite', true);
    if (archived === 'true' || archived === '1') {
      query = query.eq('is_archived', true);
    } else if (archived !== 'all') {
      query = query.eq('is_archived', false);
    }
    if (dateFrom) query = query.gte('diary_date', dateFrom);
    if (dateTo) query = query.lte('diary_date', dateTo);

    const { data, count, error } = await query.range(offset, offset + limit - 1);
    if (error) {
      console.error('列日记失败:', error.message);
      return fail(res, 500, '获取列表失败');
    }

    const list = (data || []).map((row) =>
      toEntryDto(row, safeDecryptField(row.title_cipher, space), safeDecryptField(row.content_cipher, space))
    );

    return ok(res, {
      list,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('列日记异常:', error.message);
    return fail(res, 500, '获取列表失败');
  }
});

/**
 * 【功能描述】
 * 读取当前空间草稿。
 *
 * 【业务逻辑】
 * 按 user_id + space_type 取唯一草稿；无则返回空。
 *
 * 【技术实现】
 * - 涉及方法：maybeSingle
 * - 涉及知识点：草稿按空间隔离
 */
router.get('/draft', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const db = getDb(req);
  try {
    const { data, error } = await db
      .from('journal_drafts')
      .select('title_cipher, content_cipher, mood, category, diary_date, updated_at')
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space)
      .maybeSingle();
    if (error) {
      return fail(res, 500, '读取草稿失败');
    }
    if (!data) {
      return ok(res, null);
    }
    return ok(res, {
      title: safeDecryptField(data.title_cipher, space),
      content: safeDecryptField(data.content_cipher, space),
      mood: data.mood || '',
      category: data.category || '',
      diaryDate: data.diary_date,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error('读草稿异常:', error.message);
    return fail(res, 500, '读取草稿失败');
  }
});

/**
 * 【功能描述】
 * 保存当前空间草稿（自动保存）。
 *
 * 【业务逻辑】
 * upsert 唯一 (user_id, space_type)，标题正文加密存储。
 *
 * 【技术实现】
 * - 涉及方法：encryptStorage、upsert
 * - 涉及知识点：防误关丢失
 */
router.put('/draft', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const { title, content, mood, category, diaryDate } = req.body || {};
  const db = getDb(req);
  const row = {
    user_id: req.journalUser.id,
    space_type: space,
    title_cipher: encryptStorage(title || '', space),
    content_cipher: encryptStorage(content || '', space),
    mood: mood || null,
    category: category || null,
    diary_date: diaryDate || null,
    updated_at: new Date().toISOString(),
  };
  try {
    const { error } = await db
      .from('journal_drafts')
      .upsert(row, { onConflict: 'user_id,space_type' });
    if (error) {
      console.error('存草稿失败:', error.message);
      return fail(res, 500, '保存草稿失败');
    }
    return ok(res, true, '已保存');
  } catch (error) {
    console.error('存草稿异常:', error.message);
    return fail(res, 500, '保存草稿失败');
  }
});

/**
 * 【功能描述】
 * 清空当前空间草稿。
 *
 * 【业务逻辑】
 * 发布成功后删除对应空间草稿，不影响另一空间。
 *
 * 【技术实现】
 * - 涉及方法：delete eq user_id+space_type
 * - 涉及知识点：草稿隔离
 */
router.delete('/draft', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const db = getDb(req);
  try {
    await db
      .from('journal_drafts')
      .delete()
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space);
    return ok(res, true);
  } catch (error) {
    return fail(res, 500, '操作失败');
  }
});

/**
 * 【功能描述】
 * 列出当前空间分类。
 *
 * 【业务逻辑】
 * 仅返回当前 space_type 下的分类名称。
 *
 * 【技术实现】
 * - 涉及方法：select order
 * - 涉及知识点：分类空间隔离
 */
router.get('/categories', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const db = getDb(req);
  try {
    const { data, error } = await db
      .from('journal_categories')
      .select('id, name')
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space)
      .order('created_at', { ascending: true });
    if (error) {
      return fail(res, 500, '获取分类失败');
    }
    return ok(res, data || []);
  } catch (error) {
    return fail(res, 500, '获取分类失败');
  }
});

/**
 * 【功能描述】
 * 新增当前空间分类。
 *
 * 【业务逻辑】
 * 名称去空格，同空间不可重名。
 *
 * 【技术实现】
 * - 涉及方法：insert
 * - 涉及知识点：UNIQUE (user_id, space_type, name)
 */
router.post('/categories', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const name = String((req.body && req.body.name) || '').trim().slice(0, 50);
  if (!name) {
    return fail(res, 400, '分类名称不能为空');
  }
  const db = getDb(req);
  try {
    const { data, error } = await db
      .from('journal_categories')
      .insert({ user_id: req.journalUser.id, space_type: space, name })
      .select('id, name')
      .single();
    if (error) {
      if (String(error.message || '').includes('duplicate')) {
        return fail(res, 400, '分类已存在');
      }
      return fail(res, 500, '添加失败');
    }
    return ok(res, data, '已添加', 201);
  } catch (error) {
    return fail(res, 500, '添加失败');
  }
});

/**
 * 【功能描述】
 * 按日期聚合当前空间日记数量（时间回溯日历）。
 *
 * 【业务逻辑】
 * 只统计当前空间未归档条目，返回 date -> count。
 *
 * 【技术实现】
 * - 涉及方法：select diary_date
 * - 涉及知识点：日历热力数据
 */
router.get('/calendar', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const month = String(req.query.month || '').slice(0, 7);
  const db = getDb(req);
  try {
    let query = db
      .from('journal_entries')
      .select('diary_date')
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space)
      .eq('is_archived', false);
    if (/^\d{4}-\d{2}$/.test(month)) {
      query = query.gte('diary_date', `${month}-01`).lte('diary_date', `${month}-31`);
    }
    const { data, error } = await query;
    if (error) {
      return fail(res, 500, '获取失败');
    }
    const map = {};
    (data || []).forEach((row) => {
      const key = row.diary_date;
      map[key] = (map[key] || 0) + 1;
    });
    return ok(res, map);
  } catch (error) {
    return fail(res, 500, '获取失败');
  }
});

/**
 * 【功能描述】
 * 创建一篇日记，标题正文加密后按当前空间写入。
 *
 * 【业务逻辑】
 * 校验标题；密文落库；默认今天日期。
 *
 * 【技术实现】
 * - 涉及方法：encryptStorage、insert
 * - 涉及知识点：存储加密、space_type 写入
 */
router.post('/', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const { title, content, mood, category, diaryDate, isFavorite } = req.body || {};
  if (!title || !String(title).trim()) {
    return fail(res, 400, '请填写标题');
  }
  const db = getDb(req);
  try {
    const { data, error } = await db
      .from('journal_entries')
      .insert({
        user_id: req.journalUser.id,
        space_type: space,
        title_cipher: encryptStorage(String(title).trim(), space),
        content_cipher: encryptStorage(content || '', space),
        mood: mood || null,
        category: category || null,
        diary_date: diaryDate || new Date().toISOString().slice(0, 10),
        is_favorite: !!isFavorite,
      })
      .select('id, mood, category, diary_date, is_favorite, is_archived, created_at, updated_at')
      .single();
    if (error) {
      console.error('创建日记失败:', error.message);
      return fail(res, 500, '保存失败');
    }
    return ok(
      res,
      toEntryDto(data, String(title).trim(), content || ''),
      '已保存',
      201
    );
  } catch (error) {
    console.error('创建日记异常:', error.message);
    return fail(res, 500, '保存失败');
  }
});

/**
 * 【功能描述】
 * 批量删除当前空间日记。
 *
 * 【业务逻辑】
 * ids 必须属于当前用户且 space_type 匹配，避免跨空间误删。
 *
 * 【技术实现】
 * - 涉及方法：delete in
 * - 涉及知识点：批量操作、空间隔离
 */
router.post('/batch-delete', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  if (!ids.length) {
    return fail(res, 400, '未选择内容');
  }
  const db = getDb(req);
  try {
    const { error } = await db
      .from('journal_entries')
      .delete()
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space)
      .in('id', ids);
    if (error) {
      return fail(res, 500, '删除失败');
    }
    return ok(res, true, '已删除');
  } catch (error) {
    return fail(res, 500, '删除失败');
  }
});

/**
 * 【功能描述】
 * 获取单篇日记详情；跨空间或无权限一律 404。
 *
 * 【业务逻辑】
 * 同时匹配 id、user_id、space_type，不存在则当未找到，避免探测 secret id。
 *
 * 【技术实现】
 * - 涉及方法：maybeSingle
 * - 涉及知识点：不泄露另一空间资源
 */
router.get('/:id', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const db = getDb(req);
  try {
    const { data, error } = await db
      .from('journal_entries')
      .select('id, mood, category, diary_date, is_favorite, is_archived, title_cipher, content_cipher, created_at, updated_at')
      .eq('id', req.params.id)
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space)
      .maybeSingle();
    if (error) {
      return fail(res, 500, '获取失败');
    }
    if (!data) {
      return fail(res, 404, '未找到');
    }
    return ok(
      res,
      toEntryDto(data, safeDecryptField(data.title_cipher, space), safeDecryptField(data.content_cipher, space))
    );
  } catch (error) {
    return fail(res, 500, '获取失败');
  }
});

/**
 * 【功能描述】
 * 更新当前空间日记。
 *
 * 【业务逻辑】
 * 只更新传入字段；标题正文重新加密存储。
 *
 * 【技术实现】
 * - 涉及方法：encryptStorage、update
 * - 涉及知识点：二次编辑、密文覆盖
 */
router.put('/:id', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const { title, content, mood, category, diaryDate, isFavorite, isArchived } = req.body || {};
  const db = getDb(req);
  const patch = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title_cipher = encryptStorage(String(title).trim(), space);
  if (content !== undefined) patch.content_cipher = encryptStorage(content || '', space);
  if (mood !== undefined) patch.mood = mood || null;
  if (category !== undefined) patch.category = category || null;
  if (diaryDate !== undefined) patch.diary_date = diaryDate;
  if (typeof isFavorite === 'boolean') patch.is_favorite = isFavorite;
  if (typeof isArchived === 'boolean') patch.is_archived = isArchived;

  try {
    const { data, error } = await db
      .from('journal_entries')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space)
      .select('id, mood, category, diary_date, is_favorite, is_archived, title_cipher, content_cipher, created_at, updated_at')
      .maybeSingle();
    if (error) {
      return fail(res, 500, '更新失败');
    }
    if (!data) {
      return fail(res, 404, '未找到');
    }
    return ok(
      res,
      toEntryDto(data, safeDecryptField(data.title_cipher, space), safeDecryptField(data.content_cipher, space)),
      '已更新'
    );
  } catch (error) {
    return fail(res, 500, '更新失败');
  }
});

/**
 * 【功能描述】
 * 删除当前空间一篇日记。
 *
 * 【业务逻辑】
 * 条件与详情一致：user + space + id，避免误删另一空间。
 *
 * 【技术实现】
 * - 涉及方法：delete select
 * - 涉及知识点：隔离删除
 */
router.delete('/:id', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const db = getDb(req);
  try {
    const { data, error } = await db
      .from('journal_entries')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.journalUser.id)
      .eq('space_type', space)
      .select('id')
      .maybeSingle();
    if (error) {
      return fail(res, 500, '删除失败');
    }
    if (!data) {
      return fail(res, 404, '未找到');
    }
    return ok(res, true, '已删除');
  } catch (error) {
    return fail(res, 500, '删除失败');
  }
});

module.exports = router;
