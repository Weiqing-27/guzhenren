const express = require("express");
const router = express.Router();

// 小说训练内容提交接口
router.post("/train", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { title, description, content, userId } = req.body;

  // 验证输入
  if (!title || !content) {
    return res.status(400).json({ 
      code: 400, 
      message: "参数不合法: 需要提供小说标题和内容",
      data: null
    });
  }

  try {
    // 分块处理大文件，每次处理1000字符
    const chunkSize = 1000;
    const totalChunks = Math.ceil(content.length / chunkSize);
    
    let trainingResults = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, content.length);
      const chunk = content.substring(start, end);
      
      // 检查数据库中是否已存在相似内容的AI响应
      const { data: existingResponses, error: selectError } = await supabase
        .from("ai_novel_responses")
        .select("*")
        .eq("title", title)
        .like("content", `%${chunk.substring(0, Math.min(100, chunk.length))}%`);
      
      if (selectError) {
        console.error("查询已存在的AI响应错误:", selectError);
        // 继续处理而不是中断，因为这只是一个优化
      }
      
      let aiResponse;
      
      // 如果找到了相似内容，则直接使用已有的AI响应
      if (existingResponses && existingResponses.length > 0) {
        aiResponse = existingResponses[0];
      } else {
        // 模拟调用AI接口（实际项目中需要替换为真实的AI API调用）
        const fakeAIResponse = `这是AI对小说"${title}"第${i+1}部分的分析结果。内容摘要：${chunk.substring(0, 100)}...`;
        
        // 保存AI响应到数据库
        const { data: insertedResponse, error: insertError } = await supabase
          .from("ai_novel_responses")
          .insert([
            {
              title,
              description: description || '',
              content: chunk,
              ai_response: fakeAIResponse,
              user_id: userId || null
            }
          ])
          .select();
        
        if (insertError) {
          console.error("保存AI响应错误:", insertError);
          // 即使保存失败也继续处理
        }
        
        aiResponse = insertedResponse ? insertedResponse[0] : { ai_response: fakeAIResponse };
      }
      
      trainingResults.push({
        chunkIndex: i + 1,
        totalChunks,
        progress: Math.round(((i + 1) / totalChunks) * 100),
        aiResponse: aiResponse.ai_response
      });
    }
    
    res.status(200).json({
      code: 200,
      message: "小说训练完成",
      data: {
        title,
        totalChunks,
        results: trainingResults
      }
    });
  } catch (error) {
    console.error("服务器异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误", 
      data: null,
      details: error.message 
    });
  }
});

// 获取历史AI响应接口
router.get("/responses", async (req, res) => {
  const supabase = req.app.get('supabase');
  
  try {
    const { title, limit = 10, offset = 0 } = req.query;
    
    let query = supabase
      .from("ai_novel_responses")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (title) {
      query = query.ilike("title", `%${title}%`);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error("获取AI响应历史错误:", error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取AI响应历史失败", 
        data: null,
        details: error.message 
      });
    }
    
    // 查询总记录数
    const { count } = await supabase
      .from("ai_novel_responses")
      .select("*", { count: "exact", head: true });
    
    res.status(200).json({
      code: 200,
      message: "获取AI响应历史成功",
      data: {
        responses: data,
        pagination: {
          total: count || 0,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      }
    });
  } catch (error) {
    console.error("服务器异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误", 
      data: null,
      details: error.message 
    });
  }
});

module.exports = router;