const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const getSupabase = (req) => req.app.get('supabaseAdmin');
const toMonthDate = (month) => `${month}-01`;
const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function formatRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    salaryMonth: record.salary_month.slice(0, 7),
    employeeName: record.employee_name || '',
    currency: record.currency || 'CNY',
    status: record.status || 'draft',
    expectedAttendanceDays: record.expected_attendance_days,
    actualAttendanceDays: record.actual_attendance_days,
    grossAmount: toNumber(record.gross_amount),
    netAmount: toNumber(record.net_amount),
    note: record.note || '',
    items: (record.salary_items || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        id: item.id,
        name: item.item_name,
        type: item.item_type,
        amount: toNumber(item.amount),
        percentage: item.percentage === null ? null : toNumber(item.percentage),
        valueText: item.value_text || '',
        includedInTotal: item.included_in_total !== false,
        note: item.note || '',
        sortOrder: item.sort_order,
      })),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function validateMonth(req, res, next) {
  if (!MONTH_PATTERN.test(req.params.month)) {
    return res.status(400).json({ code: 400, msg: '月份格式应为 YYYY-MM' });
  }
  next();
}

router.get('/', authenticate, async (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  if (!/^\d{4}$/.test(year)) {
    return res.status(400).json({ code: 400, msg: '年份格式应为 YYYY' });
  }

  const { data, error } = await getSupabase(req)
    .from('salary_records')
    .select('id, salary_month, employee_name, currency, status, expected_attendance_days, actual_attendance_days, gross_amount, net_amount, note, created_at, updated_at, salary_items(*)')
    .eq('user_id', req.user.userId)
    .gte('salary_month', `${year}-01-01`)
    .lte('salary_month', `${year}-12-01`)
    .order('salary_month', { ascending: true });

  if (error) {
    console.error('获取年度薪资失败:', error);
    return res.status(500).json({ code: 500, msg: '获取薪资统计失败', details: error.message });
  }

  return res.json({ code: 200, message: '获取薪资统计成功', data: (data || []).map(formatRecord) });
});

router.get('/:month', authenticate, validateMonth, async (req, res) => {
  const { data, error } = await getSupabase(req)
    .from('salary_records')
    .select('id, salary_month, employee_name, currency, status, expected_attendance_days, actual_attendance_days, gross_amount, net_amount, note, created_at, updated_at, salary_items(*)')
    .eq('user_id', req.user.userId)
    .eq('salary_month', toMonthDate(req.params.month))
    .maybeSingle();

  if (error) {
    console.error('获取月度薪资失败:', error);
    return res.status(500).json({ code: 500, msg: '获取月度工资单失败', details: error.message });
  }

  return res.json({ code: 200, message: data ? '获取工资单成功' : '本月暂无工资单', data: formatRecord(data) });
});

router.put('/:month', authenticate, validateMonth, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];

  if (!items.length || items.some((item) => !String(item.name || '').trim())) {
    return res.status(400).json({ code: 400, msg: '请至少提供一项有名称的工资明细' });
  }
  if (items.some((item) => !['earning', 'deduction'].includes(item.type))) {
    return res.status(400).json({ code: 400, msg: '工资明细类型只能是 earning 或 deduction' });
  }

  const payload = {
    user_id: req.user.userId,
    salary_month: toMonthDate(req.params.month),
    employee_name: String(body.employeeName || '').trim(),
    currency: String(body.currency || 'CNY').trim().toUpperCase().slice(0, 3),
    status: body.status === 'confirmed' ? 'confirmed' : 'draft',
    expected_attendance_days: body.expectedAttendanceDays === '' ? null : body.expectedAttendanceDays,
    actual_attendance_days: body.actualAttendanceDays === '' ? null : body.actualAttendanceDays,
    gross_amount: toNumber(body.grossAmount),
    net_amount: toNumber(body.netAmount),
    note: String(body.note || '').trim(),
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabase(req);
  const { data: record, error: recordError } = await supabase
    .from('salary_records')
    .upsert(payload, { onConflict: 'user_id,salary_month' })
    .select('id')
    .single();

  if (recordError) {
    console.error('保存工资单失败:', recordError);
    return res.status(500).json({ code: 500, msg: '保存工资单失败', details: recordError.message });
  }

  const { error: deleteError } = await supabase.from('salary_items').delete().eq('salary_record_id', record.id);
  if (deleteError) {
    return res.status(500).json({ code: 500, msg: '更新工资明细失败', details: deleteError.message });
  }

  const itemPayload = items.map((item, index) => ({
    salary_record_id: record.id,
    item_name: String(item.name).trim(),
    item_type: item.type,
    amount: toNumber(item.amount),
    percentage: item.percentage === '' || item.percentage === null || item.percentage === undefined ? null : toNumber(item.percentage),
    value_text: String(item.valueText || '').trim(),
    included_in_total: item.includedInTotal !== false,
    note: String(item.note || '').trim(),
    sort_order: Number.isInteger(item.sortOrder) ? item.sortOrder : index,
  }));
  const { error: insertError } = await supabase.from('salary_items').insert(itemPayload);
  if (insertError) {
    return res.status(500).json({ code: 500, msg: '保存工资明细失败', details: insertError.message });
  }

  const { data: saved, error: fetchError } = await supabase
    .from('salary_records')
    .select('id, salary_month, employee_name, currency, status, expected_attendance_days, actual_attendance_days, gross_amount, net_amount, note, created_at, updated_at, salary_items(*)')
    .eq('id', record.id)
    .single();

  if (fetchError) {
    return res.status(500).json({ code: 500, msg: '工资单已保存，但读取结果失败', details: fetchError.message });
  }

  return res.json({ code: 200, message: '工资单保存成功', data: formatRecord(saved) });
});

router.delete('/:month', authenticate, validateMonth, async (req, res) => {
  const { error } = await getSupabase(req)
    .from('salary_records')
    .delete()
    .eq('user_id', req.user.userId)
    .eq('salary_month', toMonthDate(req.params.month));

  if (error) {
    return res.status(500).json({ code: 500, msg: '删除工资单失败', details: error.message });
  }
  return res.json({ code: 200, message: '工资单已删除', data: null });
});

module.exports = router;
