const express = require("express");
const router = express.Router();

// 上传图片接口
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

// 获取图片列表接口
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

// 删除图片接口
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