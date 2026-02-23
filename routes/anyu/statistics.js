const express = require("express");
const router = express.Router();

// 月度统计
router.get("/monthly", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.query;

  try {
    // 获取指定月份的所有账单
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // 月末日期

    const { data: bills, error } = await supabase
      .from("bills")
      .select("amount, type, category_id, date")
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      console.error("获取账单数据错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取统计数据失败",
        error: error.message
      });
    }

    // 计算总收入和总支出
    let totalIncome = 0;
    let totalOutcome = 0;
    const categoryStats = {};
    const dailyStats = {};

    bills.forEach(bill => {
      const amount = parseFloat(bill.amount);
      
      if (bill.type === 'income') {
        totalIncome += amount;
      } else {
        totalOutcome += amount;
      }

      // 分类统计
      if (bill.category_id) {
        if (!categoryStats[bill.category_id]) {
          categoryStats[bill.category_id] = {
            categoryId: bill.category_id,
            amount: 0
          };
        }
        categoryStats[bill.category_id].amount += amount;
      }

      // 日统计
      const dateStr = bill.date;
      if (!dailyStats[dateStr]) {
        dailyStats[dateStr] = { date: dateStr, income: 0, outcome: 0 };
      }
      
      if (bill.type === 'income') {
        dailyStats[dateStr].income += amount;
      } else {
        dailyStats[dateStr].outcome += amount;
      }
    });

    // 获取分类名称
    const categoryIds = Object.keys(categoryStats);
    if (categoryIds.length > 0) {
      const { data: categories, error: categoryError } = await supabase
        .from("categories")
        .select("id, name")
        .in('id', categoryIds);

      if (!categoryError && categories) {
        categories.forEach(cat => {
          if (categoryStats[cat.id]) {
            categoryStats[cat.id].categoryName = cat.name;
            categoryStats[cat.id].percentage = ((categoryStats[cat.id].amount / totalOutcome) * 100).toFixed(2);
          }
        });
      }
    }

    const netBalance = totalIncome - totalOutcome;
    const categoryStatsArray = Object.values(categoryStats)
      .sort((a, b) => b.amount - a.amount);

    const dailyStatsArray = Object.values(dailyStats)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.status(200).json({
      code: 200,
      message: "获取月度统计成功",
      data: {
        year: parseInt(year),
        month: parseInt(month),
        totalIncome: parseFloat(totalIncome.toFixed(2)),
        totalOutcome: parseFloat(totalOutcome.toFixed(2)),
        netBalance: parseFloat(netBalance.toFixed(2)),
        categoryStats: categoryStatsArray,
        dailyStats: dailyStatsArray
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

// 年度统计
router.get("/yearly", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { year = new Date().getFullYear() } = req.query;

  try {
    // 获取全年账单数据
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const { data: bills, error } = await supabase
      .from("bills")
      .select("amount, type, category_id, date")
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      console.error("获取年度账单数据错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取年度统计数据失败",
        error: error.message
      });
    }

    // 按月份统计
    const monthlySummary = {};
    const categoryStats = {};

    // 初始化12个月
    for (let i = 1; i <= 12; i++) {
      const monthKey = String(i).padStart(2, '0');
      monthlySummary[monthKey] = {
        month: i,
        income: 0,
        outcome: 0,
        balance: 0
      };
    }

    bills.forEach(bill => {
      const amount = parseFloat(bill.amount);
      const billMonth = bill.date.split('-')[1];

      if (bill.type === 'income') {
        monthlySummary[billMonth].income += amount;
      } else {
        monthlySummary[billMonth].outcome += amount;
      }

      monthlySummary[billMonth].balance = 
        monthlySummary[billMonth].income - monthlySummary[billMonth].outcome;

      // 分类统计
      if (bill.category_id && bill.type === 'outcome') {
        if (!categoryStats[bill.category_id]) {
          categoryStats[bill.category_id] = {
            categoryId: bill.category_id,
            amount: 0
          };
        }
        categoryStats[bill.category_id].amount += amount;
      }
    });

    // 获取分类名称
    const categoryIds = Object.keys(categoryStats);
    let topCategories = [];
    
    if (categoryIds.length > 0) {
      const { data: categories, error: categoryError } = await supabase
        .from("categories")
        .select("id, name")
        .in('id', categoryIds);

      if (!categoryError && categories) {
        categories.forEach(cat => {
          if (categoryStats[cat.id]) {
            categoryStats[cat.id].categoryName = cat.name;
          }
        });
      }

      // 计算总支出用于百分比计算
      const totalOutcome = Object.values(categoryStats)
        .reduce((sum, cat) => sum + cat.amount, 0);

      topCategories = Object.values(categoryStats)
        .map(cat => ({
          categoryName: cat.categoryName,
          amount: parseFloat(cat.amount.toFixed(2)),
          percentage: totalOutcome > 0 ? ((cat.amount / totalOutcome) * 100).toFixed(2) : 0
        }))
        .sort((a, b) => b.amount - a.amount);
    }

    const monthlySummaryArray = Object.values(monthlySummary);

    res.status(200).json({
      code: 200,
      message: "获取年度统计成功",
      data: {
        year: parseInt(year),
        monthlySummary: monthlySummaryArray,
        topCategories: topCategories.slice(0, 10)
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