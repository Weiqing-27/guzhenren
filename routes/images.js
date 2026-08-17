const express = require("express");
const router = express.Router();

/**
 * 【功能描述】
 * 接收 Base64 格式图片并上传至 Supabase 存储，同时写入 images 表记录。
 *
 * 【业务逻辑】
 * 1. 校验请求体中 image_data 是否存在。
 * 2. 解析 data URL 或纯 Base64，转换为 Buffer 并确定 MIME 类型。
 * 3. 生成或使用传入的文件名，按 folder_path 确定存储路径。
 * 4. 上传至 images 存储桶，获取公共 URL 后写入数据库。
 * 5. 若数据库写入失败，回滚已上传的存储文件。
 *
 * 【技术实现】
 * - 涉及方法：router.post、Buffer.from、supabase.storage.upload、getPublicUrl、supabase.from().insert
 * - 涉及知识点：Base64 解码、Supabase Storage、补偿性删除（上传回滚）
 */
router.post("/images", async (req, res) => {
  const { 
    image_data,     // base64格式的图片数据
    file_name,      // 文件名
    folder_path,    // 存储文件夹路径（可选）
    user_id         // 用户ID（可选，根据项目规范）
  } = req.body;
  
  const supabase = req.app.get('supabase');
  
  // 验证必要参数
  if (!image_data) {
    return res.status(400).json({ 
      code: 400, 
      message: "缺少图片数据",
      error: "image_data is required" 
    });
  }

  try {
    // 解析base64数据
    let imageData = image_data;
    let mimeType = "image/jpeg";
    
    // 如果是data URL格式，需要提取实际的base64数据和MIME类型
    if (image_data.startsWith("data:")) {
      const matches = image_data.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        imageData = matches[2];
      }
    }
    
    // 将base64转换为Buffer
    const imageBuffer = Buffer.from(imageData, 'base64');
    
    // 生成文件名（如果没有提供）
    let fileName = file_name;
    if (!fileName) {
      const extension = mimeType.split("/")[1] || "jpg";
      fileName = `${Date.now()}_${Math.floor(Math.random() * 1000000)}.${extension}`;
    }
    
    // 确定存储路径
    const storagePath = folder_path ? `${folder_path}/${fileName}` : fileName;
    
    // 上传到Supabase存储
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('images')  // 使用images存储桶
      .upload(storagePath, imageBuffer, {
        contentType: mimeType,
        upsert: false
      });

    if (uploadError) {
      console.error("图片上传错误:", uploadError);
      return res.status(500).json({ 
        code: 500, 
        message: "图片上传失败",
        error: uploadError.message 
      });
    }
    
    // 获取公共URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('images')
      .getPublicUrl(storagePath);
    
    // 准备要存储到数据库的记录
    const imageRecord = {
      file_name: fileName,
      file_path: storagePath,
      url: publicUrl,
      mime_type: mimeType,
      file_size: imageBuffer.length
    };
    
    // 如果提供了用户ID，则添加到记录中
    if (user_id) {
      imageRecord.user_id = user_id;
    }
    
    // 将图片信息保存到数据库
    const { data, error: dbError } = await supabase
      .from("images")
      .insert([imageRecord])
      .select();

    if (dbError) {
      console.error("图片信息保存错误:", dbError);
      // 如果数据库保存失败，尝试删除已上传的文件
      await supabase.storage.from('images').remove([storagePath]);
      
      return res.status(500).json({ 
        code: 500, 
        message: "图片信息保存失败",
        error: dbError.message 
      });
    }

    res.status(201).json({
      code: 201,
      message: "图片上传成功",
      data: {
        id: data[0].id,
        url: publicUrl,
        file_name: fileName,
        file_path: storagePath
      }
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      error: error.message 
    });
  }
});

/**
 * 【功能描述】
 * 获取 images 表中所有图片记录，按创建时间倒序排列。
 *
 * 【业务逻辑】
 * 1. 从 Supabase 查询 images 表全部字段。
 * 2. 按 created_at 降序返回列表。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().order
 * - 涉及知识点：Supabase PostgREST 查询、Express 异步路由
 */
router.get("/images", async (req, res) => {
  const supabase = req.app.get('supabase');
  
  try {
    const { data, error } = await supabase
      .from("images")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("获取图片列表错误:", error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取图片列表失败",
        error: error.message 
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取图片列表成功",
      data: data
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      error: error.message 
    });
  }
});

/**
 * 【功能描述】
 * 根据 ID 删除图片，同时清理 Supabase 存储中的文件及数据库记录。
 *
 * 【业务逻辑】
 * 1. 根据 id 查询 images 表获取 file_path。
 * 2. 若记录不存在则返回 404。
 * 3. 从 images 存储桶删除对应文件。
 * 4. 从 images 表删除数据库记录。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.storage.remove、supabase.from().delete
 * - 涉及知识点：存储与数据库双删、Supabase Storage remove API
 */
router.delete("/images/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');
  
  try {
    // 先获取图片信息
    const { data: imageData, error: fetchError } = await supabase
      .from("images")
      .select("file_path")
      .eq("id", id)
      .single();

    if (fetchError || !imageData) {
      return res.status(404).json({ 
        code: 404, 
        message: "图片不存在",
        error: "Image not found" 
      });
    }

    // 从存储中删除文件
    const { error: deleteError } = await supabase
      .storage
      .from('images')
      .remove([imageData.file_path]);

    if (deleteError) {
      console.error("删除图片文件错误:", deleteError);
      return res.status(500).json({ 
        code: 500, 
        message: "删除图片文件失败",
        error: deleteError.message 
      });
    }

    // 从数据库中删除记录
    const { error: dbError } = await supabase
      .from("images")
      .delete()
      .eq("id", id);

    if (dbError) {
      console.error("删除图片记录错误:", dbError);
      return res.status(500).json({ 
        code: 500, 
        message: "删除图片记录失败",
        error: dbError.message 
      });
    }

    res.status(200).json({
      code: 200,
      message: "图片删除成功"
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      error: error.message 
    });
  }
});

module.exports = router;
