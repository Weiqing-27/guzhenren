const express = require("express");
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

// 应用认证中间件到所有路由
router.use(authenticate);

// 获取月度统计 - 只统计当前用户的数据
router.get("/monthly", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { year, month } = req.query;

  // 验证参数
  if (!year || !month) {
    return res.status(400).json({
      code: 400,
      message: "年份和月份都是必填参数"
    });
  }

  const yearNum = parseInt(year);
  const monthNum = parseInt(month);

  if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return res.status(400).json({
      code: 400,
      message: "年份和月份必须是有效的数字"
    });
  }

  try {
    // 构造日期范围
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(yearNum, monthNum, 0).toISOString().split('T')[0]; // 月末日期

    // 查询收入总额
    const { data: incomeData, error: incomeError } = await supabase
      .from("bills")
      .select("amount")
      .eq("type", "income")
      .eq("user_id", req.user.userId)
      .gte("date", startDate)
      .lte("date", endDate);

    if (incomeError) {
      console.error("查询收入统计错误:", incomeError);
      return res.status(500).json({
        code: 500,
        message: "查询收入统计失败",
        error: incomeError.message
      });
    }

    // 查询支出总额
    const { data: outcomeData, error: outcomeError } = await supabase
      .from("bills")
      .select("amount")
      .eq("type", "outcome")
      .eq("user_id", req.user.userId)
      .gte("date", startDate)
      .lte("date", endDate);

    if (outcomeError) {
      console.error("查询支出统计错误:", outcomeError);
      return res.status(500).json({
        code: 500,
        message: "查询支出统计失败",
        error: outcomeError.message
      });
    }

    // 计算总额
    const totalIncome = incomeData ? incomeData.reduce((sum, bill) => sum + bill.amount, 0) : 0;
    const totalOutcome = outcomeData ? outcomeData.reduce((sum, bill) => sum + bill.amount, 0) : 0;
    const netAmount = totalIncome - totalOutcome;

    // 按分类统计支出
    const { data: categoryStats, error: categoryError } = await supabase
      .from("bills")
      .select(`
        amount,
        category:categories(id, name, icon, color)
      `)
      .eq("type", "outcome")
      .eq("user_id", req.user.userId)
      .gte("date", startDate)
      .lte("date", endDate);

    if (categoryError) {
      console.error("查询分类统计错误:", categoryError);
      return res.status(500).json({
        code: 500,
        message: "查询分类统计失败",
        error: categoryError.message
      });
    }

    // 按分类分组统计
    const categorySummary = {};
    if (categoryStats) {
      categoryStats.forEach(bill => {
        const categoryId = bill.category.id;
        if (!categorySummary[categoryId]) {
          categorySummary[categoryId] = {
            id: categoryId,
            name: bill.category.name,
            icon: bill.category.icon,
            color: bill.category.color,
            amount: 0
          };
        }
        categorySummary[categoryId].amount += bill.amount;
      });
    }

    const categoryList = Object.values(categorySummary).sort((a, b) => b.amount - a.amount);

    res.status(200).json({
      code: 200,
      message: "获取月度统计成功",
      data: {
        period: {
          year: yearNum,
          month: monthNum,
          start_date: startDate,
          end_date: endDate
        },
        summary: {
          total_income: parseFloat(totalIncome.toFixed(2)),
          total_outcome: parseFloat(totalOutcome.toFixed(2)),
          net_amount: parseFloat(netAmount.toFixed(2))
        },
        category_breakdown: categoryList
      }
    });
  } catch (error) {
    console.error("获取月度统计异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 获取年度统计 - 只统计当前用户的数据
router.get("/yearly", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { year } = req.query;

  // 验证参数
  if (!year) {
    return res.status(400).json({
      code: 400,
      message: "年份是必填参数"
    });
  }

  const yearNum = parseInt(year);
  if (isNaN(yearNum)) {
    return res.status(400).json({
      code: 400,
      message: "年份必须是有效的数字"
    });
  }

  try {
    // 构造日期范围
    const startDate = `${yearNum}-01-01`;
    const endDate = `${yearNum}-12-31`;

    // 查询全年收入和支出
    const { data: bills, error } = await supabase
      .from("bills")
      .select("amount, type, date")
      .eq("user_id", req.user.userId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });

    if (error) {
      console.error("查询年度统计错误:", error);
      return res.status(500).json({
        code: 500,
        message: "查询年度统计失败",
        error: error.message
      });
    }

    // 按月分组统计
    const monthlyStats = {};
    const categoryStats = {};

    // 初始化12个月的数据
    for (let i = 1; i <= 12; i++) {
      const monthKey = String(i).padStart(2, '0');
      monthlyStats[monthKey] = {
        month: i,
        income: 0,
        outcome: 0,
        net: 0
      };
    }

    // 统计数据
    if (bills) {
      bills.forEach(bill => {
        const billMonth = bill.date.substring(5, 7); // 提取月份
        if (bill.type === 'income') {
          monthlyStats[billMonth].income += bill.amount;
        } else {
          monthlyStats[billMonth].outcome += bill.amount;
          
          // 统计分类数据（这里简化处理，实际应该关联分类表）
          // 在实际应用中，这里应该查询具体的分类信息
        }
        monthlyStats[billMonth].net = monthlyStats[billMonth].income - monthlyStats[billMonth].outcome;
      });
    }

    // 转换为数组格式
    const monthlyList = Object.values(monthlyStats);

    // 计算年度总览
    const totalIncome = monthlyList.reduce((sum, month) => sum + month.income, 0);
    const totalOutcome = monthlyList.reduce((sum, month) => sum + month.outcome, 0);
    const netAmount = totalIncome - totalOutcome;

    res.status(200).json({
      code: 200,
      message: "获取年度统计成功",
      data: {
        year: yearNum,
        summary: {
          total_income: parseFloat(totalIncome.toFixed(2)),
          total_outcome: parseFloat(totalOutcome.toFixed(2)),
          net_amount: parseFloat(netAmount.toFixed(2))
        },
        monthly_data: monthlyList.map(month => ({
          ...month,
          income: parseFloat(month.income.toFixed(2)),
          outcome: parseFloat(month.outcome.toFixed(2)),
          net: parseFloat(month.net.toFixed(2))
        }))
      }
    });
  } catch (error) {
    console.error("获取年度统计异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

module.exports = router;